import { NextRequest, NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import {
  recordOrganizationProjectCatalog,
  recordProjectScan,
} from "@/lib/db";
import {
  AccountNotFoundError,
  GitHubDataUnavailableError,
  GitHubRateLimitError,
} from "@/lib/github";
import {
  assessProjectSafety,
  listOrganizationRepos,
  parseOrganizationInput,
  scanProject,
} from "@/lib/project-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ScanOrgProjectsBody {
  org?: unknown;
  page?: unknown;
  batchSize?: unknown;
  minStars?: unknown;
  includeForks?: unknown;
  includeArchived?: unknown;
}

function num(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function mapScanError(e: unknown): string {
  if (e instanceof AccountNotFoundError) return "project_not_found";
  if (e instanceof GitHubRateLimitError) return "github_rate_limited";
  if (e instanceof GitHubDataUnavailableError) return "github_unavailable";
  return e instanceof Error ? e.message : String(e);
}

export async function POST(req: NextRequest) {
  const access = await getAdminAccess();
  if (!access.ok) {
    return errorResponse(access.reason, access.reason === "unauthorized" ? 401 : 403);
  }

  let body: ScanOrgProjectsBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid_body", 400);
  }

  const org = parseOrganizationInput(body.org);
  if (!org) return errorResponse("invalid_org", 400);

  const page = Math.max(1, Math.floor(num(body.page, 1)));
  const batchSize = Math.max(1, Math.min(30, Math.floor(num(body.batchSize, 15))));
  const minStars = Math.max(0, Math.floor(num(body.minStars, 0)));
  const includeForks = body.includeForks === true;
  const includeArchived = body.includeArchived === true;

  try {
    const listed = await listOrganizationRepos({
      org,
      page,
      perPage: batchSize,
      includeForks,
      includeArchived,
    });
    const repos = listed.repos.filter((repo) => repo.stars >= minStars);
    const projects = [];
    const failures: { repo: string; error: string }[] = [];

    for (const repo of repos) {
      try {
        const project = await scanProject(org, repo.name);
        await recordProjectScan(project);
        projects.push({ project, safety: assessProjectSafety(project) });
      } catch (e) {
        failures.push({ repo: repo.full_name, error: mapScanError(e) });
      }
    }

    const recorded = await recordOrganizationProjectCatalog({
      orgLogin: listed.org,
      requestedBy: access.session.user.login,
      pageStart: page,
      perPage: batchSize,
      nextPage: listed.nextPage,
      projects,
      failures,
    });

    return NextResponse.json({
      org: listed.org,
      page,
      batchSize,
      nextPage: listed.nextPage,
      listed: listed.repos.length,
      skippedByStars: listed.repos.length - repos.length,
      scanned: projects.length,
      failed: failures.length,
      runId: recorded.runId,
      written: recorded.written,
      projects: projects.map(({ project, safety }) => ({
        full_name: project.full_name,
        registry_full_name: project.resolved_from_repository?.full_name ?? null,
        source_url: project.resolved_from_repository?.source_url ?? null,
        href: `/projects/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}`,
        score: project.score,
        band: project.band,
        safety,
        stars: project.stars,
        contributors: project.contributors.slice(0, 5),
        roast_line: project.roast_line,
      })),
      failures,
    });
  } catch (e) {
    if (e instanceof AccountNotFoundError) return errorResponse("organization_not_found", 404);
    if (e instanceof GitHubRateLimitError) return errorResponse("github_rate_limited", 503);
    if (e instanceof GitHubDataUnavailableError) return errorResponse("github_unavailable", 503);
    console.error("organization project scan failed:", e);
    return errorResponse("organization_project_scan_failed", 500);
  }
}
