import type { ChatMessage } from "./llm";
import type { ImpactRepo, ScanResult, TopRepo } from "./types";
import type { ProfileSnapshotView } from "./db";

export interface BilingualText {
  zh: string;
  en: string;
}

export interface CommunityProfileDraft {
  working_on: BilingualText;
  want_to_meet: BilingualText;
  contact_method: BilingualText;
  chat_topics: BilingualText;
  no_recommend_for: BilingualText;
  ai_card?: BilingualText & { generated_at?: number };
}

export interface DraftSource {
  login: string;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  topRepos: TopRepo[];
  impactRepos: ImpactRepo[];
  pinnedRepos: string[];
  organizations: string[];
  metrics?: {
    followers?: number;
    public_repos?: number;
    total_stars?: number;
    merged_pr_count?: number;
    impact_pr_count?: number;
    last_year_contributions?: number;
  };
}

const FIELD_LIMIT = 500;

function cleanText(value: string | null | undefined, max = 120): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

function unique(values: (string | null | undefined)[], limit: number): string[] {
  return Array.from(new Set(values.map((v) => cleanText(v, 40)).filter(Boolean))).slice(0, limit);
}

function repoLabel(repo: TopRepo | ImpactRepo): string {
  return "repo" in repo
    ? repo.repo
    : repo.name_with_owner ?? `${repo.owner_login ?? ""}/${repo.name}`.replace(/^\//, "");
}

function topLanguages(repos: TopRepo[]): string[] {
  const weights = new Map<string, number>();
  for (const repo of repos) {
    for (const lang of repo.languages ?? []) {
      weights.set(lang.name, (weights.get(lang.name) ?? 0) + lang.size);
    }
    if (repo.language && !(repo.languages?.length)) {
      weights.set(repo.language, (weights.get(repo.language) ?? 0) + Math.max(repo.size, 1));
    }
  }
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 4);
}

function topTopics(repos: TopRepo[]): string[] {
  const counts = new Map<string, number>();
  for (const topic of repos.flatMap((repo) => repo.topics ?? [])) {
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([topic]) => topic)
    .slice(0, 6);
}

function inferFocus(source: DraftSource): { zh: string; en: string } {
  const text = [
    source.bio,
    ...source.topRepos.map((repo) => `${repo.name} ${repo.description ?? ""} ${(repo.topics ?? []).join(" ")}`),
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(ai|llm|agent|rag|machine learning|ml|model|deep learning|openai)\b/.test(text)) {
    return { zh: "AI 应用与开发者工具", en: "AI applications and developer tools" };
  }
  if (/\b(frontend|react|next|vue|svelte|ui|ux|design system)\b/.test(text)) {
    return { zh: "前端体验与产品工程", en: "frontend experience and product engineering" };
  }
  if (/\b(rust|go|infra|database|kernel|compiler|runtime|distributed|kubernetes)\b/.test(text)) {
    return { zh: "基础设施、系统与工程效率", en: "infrastructure, systems, and engineering productivity" };
  }
  if (/\b(data|analytics|vector|search|etl|warehouse)\b/.test(text)) {
    return { zh: "数据、搜索与后端工程", en: "data, search, and backend engineering" };
  }
  return { zh: "开源项目与软件工程", en: "open source projects and software engineering" };
}

function sentenceJoin(parts: string[], lang: "zh" | "en"): string {
  const filtered = parts.map((p) => p.trim()).filter(Boolean);
  if (lang === "zh") return filtered.join("；");
  return filtered.join("; ");
}

function clampField(value: BilingualText): BilingualText {
  return {
    zh: cleanText(value.zh, FIELD_LIMIT),
    en: cleanText(value.en, FIELD_LIMIT),
  };
}

function sourceFromScan(scan: ScanResult): DraftSource {
  return {
    login: scan.metrics.username,
    name: scan.metrics.name,
    bio: scan.metrics.bio,
    company: scan.metrics.company,
    topRepos: scan.top_repos ?? [],
    impactRepos: scan.impact_repos ?? [],
    pinnedRepos: scan.pinned_repos ?? [],
    organizations: scan.organizations ?? [],
    metrics: scan.metrics,
  };
}

export function sourceFromSnapshot(
  login: string,
  snapshot: ProfileSnapshotView,
  name?: string | null,
): DraftSource {
  return {
    login,
    name,
    bio: snapshot.bio,
    company: snapshot.company,
    topRepos: snapshot.top_repos,
    impactRepos: snapshot.impact_repos,
    pinnedRepos: snapshot.pinned_repos,
    organizations: snapshot.organizations,
    metrics: snapshot.metrics,
  };
}

export function buildCommunityProfileDraft(source: DraftSource): CommunityProfileDraft {
  const languages = topLanguages(source.topRepos);
  const topics = topTopics(source.topRepos);
  const focus = inferFocus(source);
  const repos = unique(
    [
      ...source.pinnedRepos,
      ...source.topRepos.slice(0, 3).map(repoLabel),
      ...source.impactRepos.slice(0, 2).map(repoLabel),
    ],
    4,
  );
  const orgs = unique(source.organizations, 3);
  const languageText = languages.length ? languages.join(" / ") : "GitHub";
  const topicText = topics.length ? topics.join(" / ") : focus.en;
  const zhRepos = repos.length ? `代表项目：${repos.join("、")}` : "";
  const enRepos = repos.length ? `Representative projects: ${repos.join(", ")}` : "";
  const zhOrgs = orgs.length ? `常出没组织：${orgs.join("、")}` : "";
  const enOrgs = orgs.length ? `Often around orgs: ${orgs.join(", ")}` : "";

  return {
    working_on: clampField({
      zh: sentenceJoin([`主要关注${focus.zh}`, languages.length ? `常用 ${languages.join(" / ")}` : "", zhRepos], "zh"),
      en: sentenceJoin([`Focused on ${focus.en}`, languages.length ? `mostly using ${languageText}` : "", enRepos], "en"),
    }),
    want_to_meet: clampField({
      zh: sentenceJoin(
        [
          `想认识同样关注${focus.zh}的开发者`,
          "愿意认真做项目、写文档、维护长期价值的开源伙伴",
          zhOrgs,
        ],
        "zh",
      ),
      en: sentenceJoin(
        [
          `Looking to meet developers into ${focus.en}`,
          "open-source collaborators who care about real projects, docs, and long-term maintenance",
          enOrgs,
        ],
        "en",
      ),
    }),
    contact_method: clampField({
      zh: "优先通过 GitHub 主页、Issue 或公开讨论联系；请说明具体项目或话题。",
      en: "Prefer GitHub profile, issues, or public discussions; please include a concrete project or topic.",
    }),
    chat_topics: clampField({
      zh: sentenceJoin([`可以聊 ${topicText}`, repos.length ? `也可以交流 ${repos.slice(0, 2).join("、")}` : ""], "zh"),
      en: sentenceJoin([`Good to chat about ${topicText}`, repos.length ? `and projects like ${repos.slice(0, 2).join(", ")}` : ""], "en"),
    }),
    no_recommend_for: clampField({
      zh: "不建议用于无上下文私信、批量推销或与公开项目无关的请求。",
      en: "Not a fit for context-free DMs, bulk sales outreach, or requests unrelated to public projects.",
    }),
    ai_card: {
      zh: `${source.login} 的社区档案基于公开 GitHub 项目自动生成，适合先作为草稿再由本人确认。`,
      en: `${source.login}'s community profile was drafted from public GitHub projects and should be reviewed by the owner.`,
      generated_at: Date.now(),
    },
  };
}

export function buildCommunityProfileDraftFromScan(scan: ScanResult): CommunityProfileDraft {
  return buildCommunityProfileDraft(sourceFromScan(scan));
}

function compactRepo(repo: TopRepo): Record<string, unknown> {
  return {
    name: repo.name_with_owner ?? repo.name,
    language: repo.language,
    topics: (repo.topics ?? []).slice(0, 8),
    stars: repo.stars,
    description: cleanText(repo.description, 180),
    readme: cleanText(repo.readme?.features?.prompt_summary ?? repo.readme_excerpt, 260),
  };
}

export function buildCommunityProfileAiMessages(source: DraftSource): ChatMessage[] {
  const payload = {
    login: source.login,
    name: cleanText(source.name, 80),
    bio: cleanText(source.bio, 180),
    company: cleanText(source.company, 120),
    languages: topLanguages(source.topRepos),
    topics: topTopics(source.topRepos),
    pinned_repos: source.pinnedRepos.slice(0, 6),
    organizations: source.organizations.slice(0, 8),
    top_repos: source.topRepos.slice(0, 6).map(compactRepo),
    impact_repos: source.impactRepos.slice(0, 6),
    metrics: source.metrics,
  };

  return [
    {
      role: "system",
      content:
        "You generate concise bilingual community profiles from public GitHub data. Return JSON only. Do not invent private contact info, employment status, location, or personal identity claims. Prefer option-like, reusable wording over long prose.",
    },
    {
      role: "user",
      content: `Create a community profile draft for this GitHub user.

Return exactly this JSON shape:
{
  "working_on": {"zh": "...", "en": "..."},
  "want_to_meet": {"zh": "...", "en": "..."},
  "contact_method": {"zh": "...", "en": "..."},
  "chat_topics": {"zh": "...", "en": "..."},
  "no_recommend_for": {"zh": "...", "en": "..."},
  "ai_card": {"zh": "...", "en": "..."}
}

Rules:
- Each zh/en field must be under 220 characters.
- Use factual signals from repos, languages, topics, orgs, and public bio.
- contact_method must default to GitHub profile/issues/public discussion unless the data explicitly contains public contact info.
- no_recommend_for should be conservative and protect the user from spam.
- Make it useful for finding friends/collaborators, not just ranking.

Public GitHub summary:
${JSON.stringify(payload)}`,
    },
  ];
}

export function parseCommunityProfileDraft(raw: string): CommunityProfileDraft | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<CommunityProfileDraft>;
    const read = (field: keyof CommunityProfileDraft): BilingualText | null => {
      const value = parsed[field] as BilingualText | undefined;
      if (!value || typeof value.zh !== "string" || typeof value.en !== "string") return null;
      return clampField(value);
    };
    const working_on = read("working_on");
    const want_to_meet = read("want_to_meet");
    const contact_method = read("contact_method");
    const chat_topics = read("chat_topics");
    const no_recommend_for = read("no_recommend_for");
    if (!working_on || !want_to_meet || !contact_method || !chat_topics || !no_recommend_for) {
      return null;
    }
    const aiCard = read("ai_card");
    return {
      working_on,
      want_to_meet,
      contact_method,
      chat_topics,
      no_recommend_for,
      ai_card: aiCard ? { ...aiCard, generated_at: Date.now() } : undefined,
    };
  } catch {
    return null;
  }
}
