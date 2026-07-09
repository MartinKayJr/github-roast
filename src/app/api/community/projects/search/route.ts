import { NextRequest, NextResponse } from "next/server";
import {
  estimateDiscoverySearchTokens,
  resolveAiDiscoveryLlmMode,
} from "@/lib/discovery";
import {
  getProjectCircleDomainsBySlugs,
  getProjectCircleSearchCatalog,
  searchProjectCircleDomains,
  type ProjectCircleSearchCatalogItem,
} from "@/lib/db";
import {
  LlmQuotaError,
  LlmTimeoutError,
  defaultLlmConfig,
  fallbackLlmConfig,
  getCompletionWithFallback,
  type LlmConfig,
} from "@/lib/llm";
import { checkRadarRateLimit, isRedisConfigured } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = "no-store";
const AI_DISCOVERY_LLM_MODE = resolveAiDiscoveryLlmMode(
  process.env.AI_DISCOVERY_LLM_MODE,
);

interface ByoKey {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

interface SearchBody {
  query?: string;
  lang?: string;
  byoKey?: ByoKey;
}

interface AiProjectPick {
  slug?: string;
  reason?: string;
}

interface AiProjectPlan {
  summary?: string;
  projects?: AiProjectPick[];
}

function clampQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 240);
}

function hasByoKey(byo?: ByoKey): boolean {
  return Boolean(byo?.apiKey && byo.baseURL && byo.model);
}

function resolveLlmConfigs(byo?: ByoKey): LlmConfig[] {
  if (byo?.apiKey && byo.baseURL && byo.model) {
    return [{ baseURL: byo.baseURL, apiKey: byo.apiKey, model: byo.model }];
  }
  if (AI_DISCOVERY_LLM_MODE !== "server") return [];
  const primary = defaultLlmConfig();
  if (!primary) return [];
  const fallback = fallbackLlmConfig();
  return fallback ? [primary, fallback] : [primary];
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "0.0.0.0";
}

function parseJsonObject(raw: string): AiProjectPlan {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as AiProjectPlan;
  } catch {
    return {};
  }
}

function buildMessages({
  query,
  lang,
  catalog,
}: {
  query: string;
  lang: string;
  catalog: ProjectCircleSearchCatalogItem[];
}) {
  const localeRule =
    lang === "en"
      ? "Write summary and reasons in concise English."
      : "summary 和 reason 使用简洁中文。";
  const compactCatalog = catalog.map((item) => ({
    slug: item.slug,
    name: lang === "en" ? item.name.en || item.name.zh : item.name.zh,
    description:
      lang === "en"
        ? item.description?.en || item.description?.zh || ""
        : item.description?.zh || item.description?.en || "",
    tags: item.tags.slice(0, 6),
    members: item.member_count,
    heat: Math.round(item.heat_score),
    search: item.search_text.slice(0, 280),
  }));

  return [
    {
      role: "system" as const,
      content: `You are the AI project-circle searcher for a GitHub community galaxy.

The visitor describes project categories, goals, or constraints. Choose matching project circles from the provided catalog.

Hard rules:
- Return JSON only. No Markdown, no code fence.
- Pick 1-12 projects.
- Every project slug MUST be copied exactly from the catalog.
- Prefer exact goal/category matches over popularity.
- If the query asks for a specific ecosystem, prioritize projects whose tags/description/search text mention it.
- ${localeRule}

JSON shape:
{"summary":"...","projects":[{"slug":"exact catalog slug","reason":"..."}]}`,
    },
    {
      role: "user" as const,
      content: JSON.stringify({ query, catalog: compactCatalog }, null, 2),
    },
  ];
}

function validateProjectSlugs(
  picks: AiProjectPick[] | undefined,
  catalog: ProjectCircleSearchCatalogItem[],
): string[] {
  if (!Array.isArray(picks)) return [];
  const allowed = new Set(catalog.map((item) => item.slug));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pick of picks) {
    const slug = typeof pick.slug === "string" ? pick.slug.trim() : "";
    if (!slug || !allowed.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= 12) break;
  }
  return out;
}

async function keywordFallbackResponse({
  query,
  estimatedTokens,
  error,
}: {
  query: string;
  estimatedTokens: { min: number; max: number };
  error?: string;
}) {
  const domains = await searchProjectCircleDomains(query, { limit: 12 });
  return NextResponse.json(
    { query, mode: "fallback", error, estimatedTokens, summary: "", domains },
    { headers: { "Cache-Control": NO_STORE } },
  );
}

export async function POST(req: NextRequest) {
  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const query = clampQuery(body.query ?? "");
  if (!query) return NextResponse.json({ error: "empty_query" }, { status: 400 });

  const lang = body.lang === "en" ? "en" : "zh";
  const estimatedTokens = estimateDiscoverySearchTokens(query, 90);
  if (!hasByoKey(body.byoKey) && AI_DISCOVERY_LLM_MODE !== "server") {
    return NextResponse.json(
      {
        error: "byo_required",
        estimatedTokens,
        message: "AI project search requires the visitor's own model key.",
      },
      { status: 402, headers: { "Cache-Control": NO_STORE } },
    );
  }

  const serverMode = !hasByoKey(body.byoKey) && AI_DISCOVERY_LLM_MODE === "server";
  if (serverMode) {
    const redisConfigured = isRedisConfigured();
    if (!redisConfigured && process.env.NODE_ENV === "production") {
      return keywordFallbackResponse({
        query,
        estimatedTokens,
        error: "service_unavailable",
      });
    }
    if (redisConfigured) {
      const { success, unavailable } = await checkRadarRateLimit(clientIp(req));
      if (!success) {
        return keywordFallbackResponse({
          query,
          estimatedTokens,
          error: unavailable ? "service_unavailable" : "rate_limited",
        });
      }
    }
  }

  const catalog = await getProjectCircleSearchCatalog(query, { limit: 90 });
  if (catalog.length === 0) {
    return NextResponse.json(
      { query, mode: "fallback", estimatedTokens, summary: "", domains: [] },
      { headers: { "Cache-Control": NO_STORE } },
    );
  }

  const llmConfigs = resolveLlmConfigs(body.byoKey);
  let mode: "ai" | "fallback" = "ai";
  let plan: AiProjectPlan = {};
  let slugs: string[] = [];
  let error: string | undefined;

  try {
    if (llmConfigs.length === 0) throw new Error("no_llm_configured");
    const text = await getCompletionWithFallback(
      llmConfigs,
      buildMessages({ query, lang, catalog }),
      {
        temperature: 0.15,
        connectTimeoutMs: 12_000,
        idleTimeoutMs: 14_000,
        deadlineMs: Date.now() + 27_000,
        attemptBudgetMs: 22_000,
      },
    );
    plan = parseJsonObject(text);
    slugs = validateProjectSlugs(plan.projects, catalog);
  } catch (e) {
    mode = "fallback";
    if (e instanceof LlmQuotaError) error = "llm_quota";
    else if (e instanceof LlmTimeoutError) error = "llm_timeout";
    else if (e instanceof Error && e.message === "no_llm_configured") error = "no_llm_configured";
    else error = "llm_failed";
  }

  const domains =
    slugs.length > 0
      ? await getProjectCircleDomainsBySlugs(slugs, { limit: 12 })
      : await searchProjectCircleDomains(query, { limit: 12 });
  if (slugs.length === 0) mode = "fallback";

  return NextResponse.json(
    {
      query,
      mode,
      error,
      estimatedTokens,
      summary: plan.summary ?? "",
      domains,
    },
    { headers: { "Cache-Control": NO_STORE } },
  );
}
