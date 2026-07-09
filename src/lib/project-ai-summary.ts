import type { ProjectSafetyAssessment, ProjectScanResult } from "./project-scan";
import {
  defaultLlmConfig,
  fallbackLlmConfig,
  getCompletionWithFallback,
  type LlmConfig,
} from "./llm";

export interface ProjectAiSummary {
  zh: {
    summary: string;
    target: string;
    use_case: string;
    safety: string;
    roast: string;
  };
  en: {
    summary: string;
    target: string;
    use_case: string;
    safety: string;
    roast: string;
  };
  keywords: string[];
  category_hints: string[];
  source: "llm" | "deterministic";
  generated_at: number;
}

function compact(value: string | null | undefined, limit = 240): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function uniq(values: (string | null | undefined)[], limit = 16): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = compact(raw, 64);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function inferCategoryHints(project: ProjectScanResult): string[] {
  const haystack = [
    project.full_name,
    project.description,
    project.homepage,
    project.language,
    ...project.topics,
    project.readme?.prompt_summary,
    ...(project.commit_evidence?.keywords ?? []),
    ...(project.source_evidence?.keywords ?? []),
    ...(project.source_evidence?.signals ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hints: string[] = [];
  if (/\bxposed\b|lsposed|zygisk|magisk|hook/.test(haystack)) hints.push("Xposed module");
  if (/android|kotlin|java|gradle|apk/.test(haystack)) hints.push("Android");
  if (/ai|llm|agent|rag|prompt|model/.test(haystack)) hints.push("AI application");
  if (/security|privacy|permission|crypto|auth|sandbox/.test(haystack)) hints.push("Security");
  if (/cli|terminal|sdk|developer tool|debug/.test(haystack)) hints.push("Developer tool");
  if (/frontend|react|vue|next|web|ui/.test(haystack)) hints.push("Frontend");
  return uniq([project.language, ...project.topics, ...hints], 12);
}

export function deterministicProjectAiSummary(
  project: ProjectScanResult,
  safety?: ProjectSafetyAssessment | null,
): ProjectAiSummary {
  const summary = compact(
    project.description || project.readme?.prompt_summary || project.roast_line.zh,
    260,
  );
  const enSummary = compact(
    project.description || project.readme?.prompt_summary || project.roast_line.en,
    260,
  );
  const categories = inferCategoryHints(project);
  const target = categories.includes("Xposed module")
    ? "想快速挑选 Xposed / Android Hook 模块的用户"
    : "想按项目用途筛选开源工具的开发者";
  const targetEn = categories.includes("Xposed module")
    ? "Users browsing Xposed / Android hook modules"
    : "Developers filtering open-source tools by use case";
  const safetyText =
    safety?.notes.zh.join("；") || (project.score >= 68 ? "公开维护信号较健康" : "建议安装或使用前自行复核");
  const safetyTextEn =
    safety?.notes.en.join("; ") || (project.score >= 68 ? "healthy public maintenance signals" : "review before installing or adopting");

  return {
    zh: {
      summary: summary || `${project.full_name} 是一个已扫描的开源项目。`,
      target,
      use_case: compact(project.readme?.prompt_summary || project.description || "适合从项目列表中进一步查看用途。", 180),
      safety: safetyText,
      roast: project.roast_line.zh,
    },
    en: {
      summary: enSummary || `${project.full_name} is a scanned open-source project.`,
      target: targetEn,
      use_case: compact(project.readme?.prompt_summary || project.description || "Open the project to inspect its use case.", 180),
      safety: safetyTextEn,
      roast: project.roast_line.en,
    },
    keywords: uniq([
      project.full_name,
      project.language,
      project.license,
      ...project.topics,
      ...project.languages.map((l) => l.name),
      ...categories,
      project.resolved_from_repository?.full_name,
    ]),
    category_hints: categories,
    source: "deterministic",
    generated_at: Date.now(),
  };
}

function parseProjectAiSummary(raw: string): Omit<ProjectAiSummary, "source" | "generated_at"> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Omit<ProjectAiSummary, "source" | "generated_at">;
    if (!parsed?.zh?.summary || !parsed?.en?.summary) return null;
    return parsed;
  } catch {
    return null;
  }
}

function llmConfigs(): LlmConfig[] {
  const primary = defaultLlmConfig();
  if (!primary) return [];
  const fallback = fallbackLlmConfig();
  return fallback ? [primary, fallback] : [primary];
}

export async function generateProjectAiSummary(
  project: ProjectScanResult,
  safety?: ProjectSafetyAssessment | null,
): Promise<ProjectAiSummary> {
  const fallback = deterministicProjectAiSummary(project, safety);
  const configs = llmConfigs();
  if (configs.length === 0) return fallback;

  const payload = {
    full_name: project.full_name,
    description: project.description,
    homepage: project.homepage,
    language: project.language,
    topics: project.topics,
    license: project.license,
    stars: project.stars,
    forks: project.forks,
    open_issues: project.open_issues,
    pushed_at: project.pushed_at,
    score: project.score,
    band: project.band,
    roast_line: project.roast_line,
    readme_summary: project.readme?.prompt_summary ?? null,
    commit_evidence: project.commit_evidence,
    source_evidence: project.source_evidence,
    safety,
    resolved_from_repository: project.resolved_from_repository,
  };

  try {
    const text = await getCompletionWithFallback(
      configs,
      [
        {
          role: "system",
          content: `You summarize GitHub projects for a discovery/list UI.

Return JSON only. No Markdown.
The summary must help users search precisely by category, target, and goal, especially install/browse decisions for module ecosystems such as Xposed.
Be concrete about what the project appears to do from public signals. Do not invent private facts.

JSON shape:
{
  "zh":{"summary":"...","target":"...","use_case":"...","safety":"...","roast":"..."},
  "en":{"summary":"...","target":"...","use_case":"...","safety":"...","roast":"..."},
  "keywords":["..."],
  "category_hints":["..."]
}`,
        },
        {
          role: "user",
          content: JSON.stringify(payload, null, 2),
        },
      ],
      {
        temperature: 0.25,
        connectTimeoutMs: 10_000,
        idleTimeoutMs: 10_000,
        deadlineMs: Date.now() + 18_000,
        attemptBudgetMs: 12_000,
      },
    );
    const parsed = parseProjectAiSummary(text);
    if (!parsed) return fallback;
    return {
      zh: {
        summary: compact(parsed.zh.summary, 320),
        target: compact(parsed.zh.target, 180),
        use_case: compact(parsed.zh.use_case, 220),
        safety: compact(parsed.zh.safety, 220),
        roast: compact(parsed.zh.roast || project.roast_line.zh, 220),
      },
      en: {
        summary: compact(parsed.en.summary, 320),
        target: compact(parsed.en.target, 180),
        use_case: compact(parsed.en.use_case, 220),
        safety: compact(parsed.en.safety, 220),
        roast: compact(parsed.en.roast || project.roast_line.en, 220),
      },
      keywords: uniq([...(parsed.keywords ?? []), ...fallback.keywords], 20),
      category_hints: uniq([...(parsed.category_hints ?? []), ...fallback.category_hints], 16),
      source: "llm",
      generated_at: Date.now(),
    };
  } catch {
    return fallback;
  }
}

export function parseStoredProjectAiSummary(raw: unknown): ProjectAiSummary | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as ProjectAiSummary;
    if (!parsed?.zh?.summary || !parsed?.en?.summary) return null;
    return parsed;
  } catch {
    return null;
  }
}
