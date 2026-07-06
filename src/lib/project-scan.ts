import {
  AccountNotFoundError,
  GitHubDataUnavailableError,
  GitHubRateLimitError,
  parseReadmeFeatures,
} from "./github";
import {
  getGitHubAuthTokens,
  githubHeaders,
  reportGitHubTokenFailure,
  reportGitHubTokenSuccess,
  type GitHubAuthToken,
} from "./github-token-pool";
import { logRatio, clampScore } from "./score";

const GITHUB_API = "https://api.github.com";
const README_LIMIT = 512 * 1024;

export type ProjectBand = "S+" | "S" | "A+" | "A" | "B+" | "B" | "C+" | "C";

export interface ProjectContributorScan {
  login: string;
  avatar_url: string | null;
  html_url: string | null;
  contributions: number;
  role: "owner" | "maintainer" | "contributor";
}

export interface ProjectScoreBreakdown {
  activity: number;
  quality: number;
  collaboration: number;
  impact: number;
  authenticity: number;
}

export interface ProjectScanResult {
  owner: string;
  repo: string;
  full_name: string;
  html_url: string;
  owner_avatar_url: string | null;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics: string[];
  license: string | null;
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;
  size: number;
  default_branch: string;
  created_at: string | null;
  pushed_at: string | null;
  latest_release_at: string | null;
  contributors: ProjectContributorScan[];
  languages: { name: string; size: number }[];
  readme: {
    length: number;
    heading_count: number;
    content_depth_score: number;
    placeholder_score: number;
    prompt_summary: string;
  } | null;
  score: number;
  band: ProjectBand;
  breakdown: ProjectScoreBreakdown;
  roast_line: { zh: string; en: string };
  resolved_from_repository: {
    full_name: string;
    html_url: string;
    source_url: string;
    kind: "source_url" | "homepage" | "description";
  } | null;
  scanned_at: number;
}

interface RestOwner {
  login?: string;
  avatar_url?: string | null;
}

interface RestRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics?: string[];
  license?: { spdx_id?: string | null; name?: string | null } | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  size: number;
  default_branch: string;
  created_at: string | null;
  pushed_at: string | null;
  fork?: boolean;
  archived?: boolean;
  owner?: RestOwner | null;
}

interface RestContributor {
  login?: string;
  avatar_url?: string | null;
  html_url?: string | null;
  contributions?: number;
}

interface RestRelease {
  published_at?: string | null;
  created_at?: string | null;
}

interface RestReadme {
  size?: number;
  content?: string;
  encoding?: string;
  download_url?: string | null;
}

interface RestContentFile {
  type?: string;
  content?: string;
  encoding?: string;
  download_url?: string | null;
}

async function restGetWithHeaders<T>(path: string): Promise<{ data: T | null; headers: Headers }> {
  const request = (token: GitHubAuthToken | null) =>
    fetch(`${GITHUB_API}/${path}`, {
      headers: githubHeaders(token?.token),
      cache: "no-store",
    });
  const tokens = await getGitHubAuthTokens(5);
  const attempts: (GitHubAuthToken | null)[] = [...tokens, null];
  let sawRateLimit = false;
  let sawUnavailable = false;

  for (const token of attempts) {
    let res: Response;
    try {
      res = await request(token);
    } catch {
      sawUnavailable = true;
      await reportGitHubTokenFailure(token, "network_error", 60_000);
      continue;
    }
    if (res.status === 404) throw new AccountNotFoundError();
    if (res.status === 401) {
      sawUnavailable = true;
      await reportGitHubTokenFailure(token, "unauthorized", 60 * 60_000);
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      sawRateLimit = sawRateLimit || remaining === "0" || res.status === 429;
      await reportGitHubTokenFailure(
        token,
        sawRateLimit ? "rate_limited" : `github_http_${res.status}`,
        sawRateLimit ? 30 * 60_000 : 10 * 60_000,
      );
      continue;
    }
    if (!res.ok) {
      sawUnavailable = true;
      await reportGitHubTokenFailure(token, `github_http_${res.status}`, 5 * 60_000);
      continue;
    }
    await reportGitHubTokenSuccess(token);
    try {
      return { data: (await res.json()) as T, headers: res.headers };
    } catch {
      return { data: null, headers: res.headers };
    }
  }
  if (sawRateLimit) throw new GitHubRateLimitError();
  if (sawUnavailable) throw new GitHubDataUnavailableError("GitHub REST request failed.");
  throw new GitHubDataUnavailableError("GitHub REST request failed.");
}

async function restGet<T>(path: string): Promise<T | null> {
  const { data } = await restGetWithHeaders<T>(path);
  return data;
}

function daysSince(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((now - ts) / (24 * 60 * 60 * 1000)));
}

export function parseProjectInput(input: unknown): { owner: string; repo: string } | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  const urlMatch = raw.match(/github\.com\/([^/\s?#]+)\/([^/\s?#]+)/i);
  const pairMatch = raw.match(/^([^/\s?#]+)\/([^/\s?#]+)$/);
  const [, ownerRaw, repoRaw] = urlMatch ?? pairMatch ?? [];
  const owner = ownerRaw?.trim();
  const repo = repoRaw?.replace(/\.git$/i, "").trim();
  const nameRe = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repo || !nameRe.test(owner) || !nameRe.test(repo)) return null;
  return { owner, repo };
}

function parseGitHubRepoUrl(input: string | null | undefined): {
  owner: string;
  repo: string;
  url: string;
} | null {
  if (!input) return null;
  const match = input.match(/(?:https?:\/\/)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)/i);
  if (!match) return null;
  const owner = match[1]?.trim();
  const repo = match[2]?.replace(/(?:\.git)?[),.\]]*$/i, "").trim();
  const nameRe = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repo || !nameRe.test(owner) || !nameRe.test(repo)) return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

export function parseOrganizationInput(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  const urlMatch = raw.match(/github\.com\/([^/\s?#]+)/i);
  const org = (urlMatch?.[1] ?? raw).replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(org)) return null;
  return org;
}

export interface OrganizationRepoSummary {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  pushed_at: string | null;
  fork: boolean;
  archived: boolean;
}

function parseNextPage(link: string | null): number | null {
  if (!link) return null;
  const next = link
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="next"/.test(part));
  if (!next) return null;
  const page = next.match(/[?&]page=(\d+)/)?.[1];
  return page ? Number(page) : null;
}

export async function listOrganizationRepos(options: {
  org: string;
  page?: number;
  perPage?: number;
  includeForks?: boolean;
  includeArchived?: boolean;
}): Promise<{ org: string; repos: OrganizationRepoSummary[]; nextPage: number | null }> {
  const org = parseOrganizationInput(options.org);
  if (!org) throw new AccountNotFoundError();
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const perPage = Math.max(1, Math.min(100, Math.floor(options.perPage ?? 30)));
  const { data, headers } = await restGetWithHeaders<RestRepo[]>(
    `orgs/${encodeURIComponent(org)}/repos?type=public&sort=pushed&direction=desc&per_page=${perPage}&page=${page}`,
  );
  const repos = (data ?? [])
    .filter((repo) => options.includeForks || !repo.fork)
    .filter((repo) => options.includeArchived || !repo.archived)
    .map((repo): OrganizationRepoSummary => ({
      name: repo.name,
      full_name: repo.full_name,
      html_url: repo.html_url,
      description: repo.description,
      language: repo.language,
      topics: (repo.topics ?? []).slice(0, 12),
      stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
      pushed_at: repo.pushed_at,
      fork: Boolean(repo.fork),
      archived: Boolean(repo.archived),
    }));
  return { org, repos, nextPage: parseNextPage(headers.get("link")) };
}

async function fetchRepoTextFile(owner: string, repo: string, path: string): Promise<string | null> {
  const file = await restGet<RestContentFile>(
    `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`,
  ).catch(() => null);
  if (!file || file.type !== "file") return null;
  try {
    if (file.content && file.encoding === "base64") {
      return Buffer.from(file.content.replace(/\s+/g, ""), "base64").toString("utf-8");
    }
    if (file.download_url) {
      const res = await fetch(file.download_url, {
        headers: { "User-Agent": "ghsphere", Range: "bytes=0-4095" },
        cache: "no-store",
      });
      if (res.ok) return res.text();
    }
  } catch {
    return null;
  }
  return null;
}

async function resolveSourceRepository(
  repo: RestRepo,
): Promise<{
  owner: string;
  repo: string;
  url: string;
  kind: "source_url" | "homepage" | "description";
} | null> {
  const owner = repo.owner?.login ?? repo.full_name.split("/")[0] ?? "";
  const current = `${owner}/${repo.name}`.toLowerCase();
  const sourceUrl = await fetchRepoTextFile(owner, repo.name, "SOURCE_URL");
  const candidates: { kind: "source_url" | "homepage" | "description"; value: string | null }[] = [
    { kind: "source_url", value: sourceUrl },
    { kind: "homepage", value: repo.homepage },
    { kind: "description", value: repo.description },
  ];
  for (const candidate of candidates) {
    const parsed = parseGitHubRepoUrl(candidate.value);
    if (!parsed) continue;
    if (`${parsed.owner}/${parsed.repo}`.toLowerCase() === current) continue;
    return { ...parsed, kind: candidate.kind };
  }
  return null;
}

function projectBand(score: number): ProjectBand {
  if (score >= 92) return "S+";
  if (score >= 84) return "S";
  if (score >= 76) return "A+";
  if (score >= 68) return "A";
  if (score >= 58) return "B+";
  if (score >= 48) return "B";
  if (score >= 36) return "C+";
  return "C";
}

async function fetchReadme(owner: string, repo: string): Promise<ProjectScanResult["readme"]> {
  const meta = await restGet<RestReadme>(`repos/${owner}/${repo}/readme`).catch(() => null);
  if (!meta) return null;
  let markdown = "";
  try {
    if (meta.content && meta.encoding === "base64" && (meta.size ?? 0) <= README_LIMIT) {
      markdown = Buffer.from(meta.content.replace(/\s+/g, ""), "base64").toString("utf-8");
    } else if (meta.download_url) {
      const res = await fetch(meta.download_url, {
        headers: { "User-Agent": "ghsphere", Range: `bytes=0-${README_LIMIT - 1}` },
        cache: "no-store",
      });
      if (res.ok) markdown = await res.text();
    }
  } catch {
    return null;
  }
  if (!markdown) return null;
  const features = parseReadmeFeatures(markdown);
  return {
    length: features.length,
    heading_count: features.heading_count,
    content_depth_score: features.content_depth_score,
    placeholder_score: features.placeholder_score,
    prompt_summary: features.prompt_summary,
  };
}

function scoreProject(input: {
  repo: RestRepo;
  contributors: ProjectContributorScan[];
  languages: { name: string; size: number }[];
  readme: ProjectScanResult["readme"];
  latestReleaseAt: string | null;
}): { score: number; band: ProjectBand; breakdown: ProjectScoreBreakdown } {
  const { repo, contributors, languages, readme, latestReleaseAt } = input;
  const pushDays = daysSince(repo.pushed_at);
  const releaseDays = daysSince(latestReleaseAt);
  const repoAgeDays = daysSince(repo.created_at);

  const activity = clampScore(
    (pushDays === null ? 0 : pushDays <= 7 ? 9 : pushDays <= 30 ? 7 : pushDays <= 120 ? 4 : 1) +
      (releaseDays === null ? 0 : releaseDays <= 90 ? 5 : releaseDays <= 365 ? 3 : 1) +
      Math.min(6, logRatio(repo.open_issues_count + repo.forks_count, 2000) * 6),
  );

  const quality = clampScore(
    (readme?.content_depth_score ?? 0) * 8 +
      (readme ? Math.max(0, 1 - readme.placeholder_score) * 3 : 0) +
      (repo.license ? 3 : 0) +
      (repo.topics?.length ? Math.min(3, repo.topics.length * 0.75) : 0) +
      (languages.length ? 3 : 0),
  );

  const collaboration = clampScore(
    logRatio(contributors.length, 120) * 9 +
      logRatio(repo.forks_count, 5000) * 5 +
      (repo.open_issues_count > 0 ? Math.min(6, logRatio(repo.open_issues_count, 5000) * 6) : 1),
  );

  const impact = clampScore(
    logRatio(repo.stargazers_count, 50000) * 15 +
      logRatio(repo.forks_count, 12000) * 6 +
      logRatio(repo.watchers_count, 5000) * 4,
  );

  let authenticity = 14;
  if (repo.stargazers_count >= 100 && repo.forks_count <= Math.max(1, repo.stargazers_count * 0.006)) {
    authenticity -= 4;
  }
  if ((readme?.placeholder_score ?? 0) >= 0.6) authenticity -= 4;
  if (repoAgeDays !== null && repoAgeDays < 14 && repo.stargazers_count >= 1000) authenticity -= 3;
  if (pushDays !== null && pushDays > 900) authenticity -= 3;

  const breakdown = {
    activity: Math.round(activity * 100) / 100,
    quality: Math.round(quality * 100) / 100,
    collaboration: Math.round(collaboration * 100) / 100,
    impact: Math.round(impact * 100) / 100,
    authenticity: Math.max(0, Math.round(authenticity * 100) / 100),
  };
  const total = clampScore(
    breakdown.activity +
      breakdown.quality +
      breakdown.collaboration +
      breakdown.impact +
      breakdown.authenticity,
  );
  return { score: total, band: projectBand(total), breakdown };
}

export type ProjectSafetyLevel = "A" | "B" | "C" | "D";

export interface ProjectSafetyAssessment {
  level: ProjectSafetyLevel;
  notes: { zh: string[]; en: string[] };
}

export function assessProjectSafety(project: ProjectScanResult): ProjectSafetyAssessment {
  let risk = 0;
  const notes = { zh: [] as string[], en: [] as string[] };
  const pushDays = daysSince(project.pushed_at);
  if (pushDays === null || pushDays > 365) {
    risk += 2;
    notes.zh.push("长期未维护");
    notes.en.push("stale maintenance signal");
  } else if (pushDays > 120) {
    risk += 1;
    notes.zh.push("近期维护偏弱");
    notes.en.push("low recent maintenance");
  }
  if ((project.readme?.placeholder_score ?? 0) >= 0.55 || (project.readme?.content_depth_score ?? 0) < 0.35) {
    risk += 1;
    notes.zh.push("文档信号不足");
    notes.en.push("weak documentation signal");
  }
  if (project.contributors.length <= 1) {
    risk += 1;
    notes.zh.push("贡献者较少");
    notes.en.push("small contributor base");
  }
  if (project.breakdown.authenticity < 8) {
    risk += 2;
    notes.zh.push("公开信号可信度偏低");
    notes.en.push("lower public-signal authenticity");
  }
  if (project.open_issues > 100 && project.contributors.length <= 2) {
    risk += 1;
    notes.zh.push("issue 压力偏高");
    notes.en.push("high issue load");
  }

  if (notes.zh.length === 0) {
    notes.zh.push("公开维护信号健康");
    notes.en.push("healthy public maintenance signals");
  }

  return {
    level: risk >= 5 ? "D" : risk >= 3 ? "C" : risk >= 1 ? "B" : "A",
    notes,
  };
}

function roastLine(result: {
  repo: RestRepo;
  score: number;
  band: ProjectBand;
  contributors: ProjectContributorScan[];
  readme: ProjectScanResult["readme"];
}): { zh: string; en: string } {
  const full = result.repo.full_name;
  if (result.score >= 84) {
    return {
      zh: `${full} 不是普通仓库，是开发者围着它形成生态的引力井。`,
      en: `${full} is less a repo than a gravity well that pulls an ecosystem around it.`,
    };
  }
  if (result.score >= 68) {
    return {
      zh: `${full} 已经有项目圈子的样子，差的是把协作和文档继续磨厚。`,
      en: `${full} has the shape of a real project circle; docs and collaboration depth decide the next tier.`,
    };
  }
  if ((result.readme?.placeholder_score ?? 0) >= 0.55) {
    return {
      zh: `${full} 的星球还没凝实，README 看着比工程本体更努力。`,
      en: `${full} has not fully formed yet; the README is working harder than the engineering signal.`,
    };
  }
  return {
    zh: `${full} 现在更像一颗小行星：能被发现，但还需要更多持续贡献把轨道撑起来。`,
    en: `${full} is more asteroid than planet for now: visible, but it needs sustained contributors to hold an orbit.`,
  };
}

export async function scanProject(
  owner: string,
  repo: string,
  options: { followSource?: boolean } = {},
): Promise<ProjectScanResult> {
  const [repoData, contributorsData, languagesData, releasesData, readme] = await Promise.all([
    restGet<RestRepo>(`repos/${owner}/${repo}`),
    restGet<RestContributor[]>(`repos/${owner}/${repo}/contributors?per_page=30`).catch(() => []),
    restGet<Record<string, number>>(`repos/${owner}/${repo}/languages`).catch(() => ({})),
    restGet<RestRelease[]>(`repos/${owner}/${repo}/releases?per_page=5`).catch(() => []),
    fetchReadme(owner, repo),
  ]);
  if (!repoData) throw new AccountNotFoundError();
  const ownerLogin = repoData.owner?.login ?? owner;
  if (options.followSource !== false) {
    const source = await resolveSourceRepository(repoData).catch(() => null);
    if (source) {
      try {
        const resolved = await scanProject(source.owner, source.repo, { followSource: false });
        return {
          ...resolved,
          resolved_from_repository: {
            full_name: repoData.full_name,
            html_url: repoData.html_url,
            source_url: source.url,
            kind: source.kind,
          },
        };
      } catch {
        // If the advertised source repository is unavailable, fall back to the
        // registry/index repository instead of failing the whole organization batch.
      }
    }
  }
  const contributors = (contributorsData ?? [])
    .filter((c): c is Required<Pick<RestContributor, "login">> & RestContributor => Boolean(c.login))
    .map((c): ProjectContributorScan => ({
      login: c.login,
      avatar_url: c.avatar_url ?? null,
      html_url: c.html_url ?? `https://github.com/${c.login}`,
      contributions: Math.max(0, Number(c.contributions) || 0),
      role: c.login.toLowerCase() === ownerLogin.toLowerCase() ? "owner" : "contributor",
    }));
  const languages = Object.entries(languagesData ?? {})
    .map(([name, size]) => ({ name, size: Number(size) || 0 }))
    .sort((a, b) => b.size - a.size);
  const latestReleaseAt =
    releasesData?.[0]?.published_at ?? releasesData?.[0]?.created_at ?? null;
  const scored = scoreProject({
    repo: repoData,
    contributors,
    languages,
    readme,
    latestReleaseAt,
  });
  return {
    owner: ownerLogin,
    repo: repoData.name,
    full_name: repoData.full_name,
    html_url: repoData.html_url,
    owner_avatar_url: repoData.owner?.avatar_url ?? null,
    description: repoData.description,
    homepage: repoData.homepage,
    language: repoData.language,
    topics: (repoData.topics ?? []).slice(0, 12),
    license: repoData.license?.spdx_id || repoData.license?.name || null,
    stars: repoData.stargazers_count ?? 0,
    forks: repoData.forks_count ?? 0,
    watchers: repoData.watchers_count ?? 0,
    open_issues: repoData.open_issues_count ?? 0,
    size: repoData.size ?? 0,
    default_branch: repoData.default_branch,
    created_at: repoData.created_at,
    pushed_at: repoData.pushed_at,
    latest_release_at: latestReleaseAt,
    contributors,
    languages,
    readme,
    score: scored.score,
    band: scored.band,
    breakdown: scored.breakdown,
    roast_line: roastLine({ repo: repoData, ...scored, contributors, readme }),
    resolved_from_repository: null,
    scanned_at: Date.now(),
  };
}
