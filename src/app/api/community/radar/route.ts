import { NextRequest, NextResponse } from "next/server";
import {
  getFacetCatalogForAiSearch,
  searchFacetCategoriesForDirectory,
} from "@/lib/developers";
import {
  estimateDiscoverySearchTokens,
  resolveAiDiscoveryLlmMode,
  type DiscoveryFacetRef,
} from "@/lib/discovery";
import type { FacetSearchResult } from "@/lib/db";
import { getCommunityEntriesByFacets } from "@/lib/db";
import type { FacetType } from "@/lib/facets";
import {
  LlmQuotaError,
  LlmTimeoutError,
  type LlmConfig,
  chatStreamEventsWithFallback,
  defaultLlmConfig,
  fallbackLlmConfig,
} from "@/lib/llm";
import { checkRadarRateLimit, getCachedRadarResult, isRedisConfigured, setCachedRadarResult } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FACET_TYPES: FacetType[] = ["language", "repo", "org"];
const AI_DISCOVERY_LLM_MODE = resolveAiDiscoveryLlmMode(
  process.env.AI_DISCOVERY_LLM_MODE,
);

interface RadarBody {
  query?: string;
  lang?: string;
  byoKey?: ByoKey;
}

interface ByoKey {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

interface AiFacetPick {
  type?: string;
  value?: string;
  reason?: string;
}

interface AiRadarPlan {
  summary?: string;
  facets?: AiFacetPick[];
}

function clampQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 200);
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "0.0.0.0";
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

function parseJsonObject(raw: string): AiRadarPlan {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as AiRadarPlan;
  } catch {
    return {};
  }
}

async function collectAiText(
  messages: Parameters<typeof chatStreamEventsWithFallback>[1],
  configs: LlmConfig[],
): Promise<string> {
  let text = "";
  for await (const ev of chatStreamEventsWithFallback(configs, messages, {
    temperature: 0.2,
    connectTimeoutMs: 10_000,
    idleTimeoutMs: 10_000,
    deadlineMs: Date.now() + 20_000,
  })) {
    if (ev.type !== "content") continue;
    text += ev.text;
    if (text.length >= 6000) break;
  }
  return text;
}

async function buildCatalog(query: string): Promise<Record<FacetType, FacetSearchResult[]>> {
  const [languages, repos, orgs, lexical] = await Promise.all([
    getFacetCatalogForAiSearch("language"),
    getFacetCatalogForAiSearch("repo"),
    getFacetCatalogForAiSearch("org"),
    searchFacetCategoriesForDirectory(query, { limit: 24 }),
  ]);
  const base: Record<FacetType, FacetSearchResult[]> = {
    language: languages.map((c) => ({ ...c, type: "language" })),
    repo: repos.map((c) => ({ ...c, type: "repo" })),
    org: orgs.map((c) => ({ ...c, type: "org" })),
  };
  for (const item of lexical) {
    const bucket = base[item.type];
    if (!bucket.some((c) => c.value.toLowerCase() === item.value.toLowerCase())) {
      bucket.unshift(item);
    }
  }
  return base;
}

function buildMessages({
  query,
  lang,
  catalog,
}: {
  query: string;
  lang: string;
  catalog: Record<FacetType, FacetSearchResult[]>;
}) {
  const localeRule =
    lang === "en"
      ? "Write the summary and reasons in concise English."
      : "summary 和 reason 使用简洁中文。";
  const compactCatalog = Object.fromEntries(
    FACET_TYPES.map((type) => [
      type,
      catalog[type].map((c) => ({
        value: c.value,
        count: c.count,
      })),
    ]),
  );

  return [
    {
      role: "system" as const,
      content: `You are the AI radar for a GitHub developer circle.

Your job: understand what kind of GitHub people the visitor wants to meet, then choose matching discovery facets from the provided catalog.

Hard rules:
- Return JSON only. No Markdown, no code fence.
- Pick 1-6 facets total.
- Every facet value MUST be copied exactly from the catalog.
- Prefer project and organization facets when the query describes a community, product area, ecosystem, or circle.
- Prefer language facets when the query asks for a tech stack.
- ${localeRule}

JSON shape:
{"summary":"...","facets":[{"type":"language|repo|org","value":"exact catalog value","reason":"..."}]}`,
    },
    {
      role: "user" as const,
      content: JSON.stringify({ query, catalog: compactCatalog }, null, 2),
    },
  ];
}

function validateFacets(
  picks: AiFacetPick[] | undefined,
  catalog: Record<FacetType, FacetSearchResult[]>,
): DiscoveryFacetRef[] {
  if (!Array.isArray(picks)) return [];
  const allowed = new Map<string, FacetSearchResult>();
  for (const type of FACET_TYPES) {
    for (const c of catalog[type]) allowed.set(`${type}:${c.value.toLowerCase()}`, c);
  }
  const seen = new Set<string>();
  const out: DiscoveryFacetRef[] = [];
  for (const pick of picks) {
    const type = FACET_TYPES.find((t) => t === pick.type);
    const value = typeof pick.value === "string" ? pick.value.trim() : "";
    if (!type || !value) continue;
    const key = `${type}:${value.toLowerCase()}`;
    const hit = allowed.get(key);
    if (!hit || seen.has(key)) continue;
    seen.add(key);
    out.push({
      type,
      value: hit.value,
      reason: typeof pick.reason === "string" ? pick.reason.slice(0, 160) : "",
    });
    if (out.length >= 6) break;
  }
  return out;
}

async function fallbackFacetSearch(query: string): Promise<DiscoveryFacetRef[]> {
  const results = await searchFacetCategoriesForDirectory(query, { limit: 6 });
  return results.map((r) => ({ type: r.type, value: r.value }));
}

export async function POST(req: NextRequest) {
  let body: RadarBody;
  try {
    body = (await req.json()) as RadarBody;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const query = clampQuery(body.query ?? "");
  if (!query) return NextResponse.json({ error: "empty_query" }, { status: 400 });

  const lang = body.lang === "en" ? "en" : "zh";
  const estimatedTokens = estimateDiscoverySearchTokens(query);
  if (!hasByoKey(body.byoKey) && AI_DISCOVERY_LLM_MODE !== "server") {
    return NextResponse.json(
      { error: "byo_required", estimatedTokens },
      { status: 402, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!hasByoKey(body.byoKey) && AI_DISCOVERY_LLM_MODE === "server") {
    if (!isRedisConfigured()) {
      return NextResponse.json(
        { error: "service_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const ip = clientIp(req);
    const { success, unavailable } = await checkRadarRateLimit(ip);
    if (!success) {
      return NextResponse.json(
        { error: unavailable ? "service_unavailable" : "rate_limited" },
        { status: unavailable ? 503 : 429, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // Only server-mode reads and writes the shared cache; BYO requests always call their own model.
  const serverMode = !hasByoKey(body.byoKey) && AI_DISCOVERY_LLM_MODE === "server";
  const cached = serverMode ? await getCachedRadarResult(lang, query) : null;
  if (cached) {
    const entries = await getCommunityEntriesByFacets(cached.facets as DiscoveryFacetRef[], 36);
    return NextResponse.json(
      { query, mode: "ai", estimatedTokens, summary: cached.summary, facets: cached.facets, entries },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const catalog = await buildCatalog(query);
  const llmConfigs = resolveLlmConfigs(body.byoKey);
  let mode: "ai" | "fallback" = "ai";
  let plan: AiRadarPlan = {};
  let facets: DiscoveryFacetRef[] = [];
  let error: string | undefined;

  try {
    if (llmConfigs.length === 0) throw new Error("no_llm_configured");
    const text = await collectAiText(buildMessages({ query, lang, catalog }), llmConfigs);
    plan = parseJsonObject(text);
    facets = validateFacets(plan.facets, catalog);
  } catch (e) {
    mode = "fallback";
    if (e instanceof LlmQuotaError) error = "llm_quota";
    else if (e instanceof LlmTimeoutError) error = "llm_timeout";
    else if (e instanceof Error && e.message === "no_llm_configured") error = "no_llm_configured";
    else error = "llm_failed";
  }

  if (facets.length === 0) {
    mode = mode === "ai" ? "fallback" : mode;
    facets = await fallbackFacetSearch(query);
  }

  if (mode === "ai" && facets.length > 0 && serverMode) {
    setCachedRadarResult(lang, query, { summary: plan.summary ?? "", facets }).catch(() => {});
  }

  const entries = await getCommunityEntriesByFacets(facets, 36);

  return NextResponse.json(
    {
      query,
      mode,
      error,
      estimatedTokens,
      summary: plan.summary ?? "",
      facets,
      entries,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
