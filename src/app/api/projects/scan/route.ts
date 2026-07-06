import { NextRequest, NextResponse } from "next/server";
import {
  AccountNotFoundError,
  GitHubDataUnavailableError,
  GitHubRateLimitError,
} from "@/lib/github";
import { getScoreBrief, recordProfileSnapshot, recordProjectScan, recordScore } from "@/lib/db";
import { checkRateLimit, coalesceScan, rateLimitHeaders } from "@/lib/redis";
import { parseProjectInput, scanProject, type ProjectScanResult } from "@/lib/project-scan";
import { buildScanResult, scanErrorResponse } from "@/lib/scan-core";
import { spamBotScore } from "@/lib/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMPTY_TAGS = { zh: [], en: [] };
const EMPTY_ROAST_LINE = { zh: "", en: "" };
const AUTO_SCAN_CONTRIBUTOR_LIMIT = 3;

interface ProjectScanBody {
  repo?: unknown;
}

type AutoContributorProfileResult = {
  login: string;
  status: "existing" | "recorded" | "skipped" | "failed";
  error?: string;
};

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
}

function errorResponse(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers });
}

async function autoRecordTopContributorProfiles(
  contributors: ProjectScanResult["contributors"],
): Promise<AutoContributorProfileResult[]> {
  if (!process.env.TURSO_DATABASE_URL) return [];
  if (!process.env.GITHUB_TOKEN) {
    return contributors.slice(0, AUTO_SCAN_CONTRIBUTOR_LIMIT).map((c) => ({
      login: c.login,
      status: "skipped" as const,
      error: "github_token_missing",
    }));
  }

  const seen = new Set<string>();
  const top = contributors
    .filter((c) => {
      const login = c.login.trim().toLowerCase();
      if (!login || seen.has(login)) return false;
      seen.add(login);
      return true;
    })
    .slice(0, AUTO_SCAN_CONTRIBUTOR_LIMIT);
  const results: AutoContributorProfileResult[] = [];

  for (const contributor of top) {
    const login = contributor.login.toLowerCase();
    try {
      const existing = await getScoreBrief(login);
      if (existing) {
        results.push({ login, status: "existing" });
        continue;
      }

      const scan = await coalesceScan(login, () => buildScanResult(login));
      const scannedAt = Date.now();
      await recordScore({
        username: scan.metrics.username,
        display_name: scan.metrics.name,
        avatar_url: scan.metrics.avatar_url,
        profile_url: scan.metrics.profile_url,
        final_score: scan.scoring.final_score,
        tier: scan.scoring.tier,
        tags: EMPTY_TAGS,
        roast_line: EMPTY_ROAST_LINE,
        bot_score: spamBotScore(scan.metrics),
        sub_scores: scan.scoring.sub_scores,
        scanned_at: scannedAt,
      });
      await recordProfileSnapshot(scan);
      results.push({ login, status: "recorded" });
    } catch (e) {
      const mapped = scanErrorResponse(e);
      results.push({ login, status: "failed", error: mapped.error });
    }
  }

  return results;
}

export async function POST(req: NextRequest) {
  let body: ProjectScanBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_body", 400);
  }

  const parsed = parseProjectInput(body.repo);
  if (!parsed) return errorResponse("invalid_project", 400);

  const limit = await checkRateLimit(clientIp(req));
  const rlHeaders = rateLimitHeaders(limit);
  if (!limit.success) {
    return errorResponse("rate_limited", 429, rlHeaders);
  }

  try {
    const project = await scanProject(parsed.owner, parsed.repo);
    const autoScannedContributors = await autoRecordTopContributorProfiles(project.contributors);
    await recordProjectScan(project);
    return NextResponse.json(
      {
        project,
        href: `/projects/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}`,
        autoScannedContributors,
      },
      { headers: rlHeaders },
    );
  } catch (e) {
    if (e instanceof AccountNotFoundError) {
      return errorResponse("project_not_found", 404, rlHeaders);
    }
    if (e instanceof GitHubRateLimitError) {
      return errorResponse("github_rate_limited", 503, { ...rlHeaders, "Retry-After": "60" });
    }
    if (e instanceof GitHubDataUnavailableError) {
      return errorResponse("github_unavailable", 503, { ...rlHeaders, "Retry-After": "60" });
    }
    console.error("project scan failed:", e);
    return errorResponse("project_scan_failed", 500, rlHeaders);
  }
}
