import { NextRequest, NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import {
  createOrganizationProjectScanJob,
  getOrganizationProjectCatalogStats,
  getOrganizationProjectScanJob,
  listOrganizationProjectScanJobItemsByStatus,
  listOrganizationProjectScanJobs,
  markOrganizationProjectScanJobRunning,
  type OrganizationProjectScanJob,
  recordOrganizationProjectCatalog,
  recordOrganizationProjectScanJobItem,
  recordProjectScan,
  updateOrganizationProjectScanJobAfterBatch,
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
import { generateProjectAiSummary, type ProjectAiSummary } from "@/lib/project-ai-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const activeOrgScanJobs = new Set<string>();

interface ScanOrgProjectsBody {
  jobId?: unknown;
  org?: unknown;
  page?: unknown;
  batchSize?: unknown;
  minStars?: unknown;
  includeForks?: unknown;
  includeArchived?: unknown;
  retryFailures?: unknown;
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

function splitFullName(fullName: string): { owner: string; repo: string } | null {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function runOrganizationProjectScanBatch(input: {
  job: OrganizationProjectScanJob;
  requestedBy: string | null;
  retryFailures?: boolean;
}): Promise<{
  job: OrganizationProjectScanJob;
  page: number;
  batchSize: number;
  nextPage: number | null;
  listed: number;
  skippedByStars: number;
  scanned: number;
  failed: number;
  runId: string | null;
  written: number;
  projects: {
    full_name: string;
    registry_full_name: string | null;
    source_url: string | null;
    href: string;
    score: number;
    band: string;
    safety: ReturnType<typeof assessProjectSafety>;
    stars: number;
    contributors: { login: string }[];
    roast_line: { zh: string; en: string };
    ai_summary: ProjectAiSummary;
  }[];
  failures: { repo: string; error: string }[];
}> {
  let job = (await markOrganizationProjectScanJobRunning(input.job.id)) ?? input.job;
  const retryFailures = input.retryFailures === true;
  const page = job.next_page;
  const batchSize = job.batch_size;
  const minStars = job.min_stars;

  const retryItems = retryFailures
    ? await listOrganizationProjectScanJobItemsByStatus(job.id, "failed", batchSize)
    : [];
  const listed =
    retryItems.length > 0
      ? {
          org: job.org_login,
          repos: retryItems.flatMap((item) => {
            const parsed = splitFullName(item.registry_full_name);
            return parsed
              ? [
                  {
                    name: parsed.repo,
                    full_name: item.registry_full_name,
                    html_url: `https://github.com/${item.registry_full_name}`,
                    description: null,
                    language: null,
                    topics: [],
                    stars: 0,
                    forks: 0,
                    pushed_at: null,
                    fork: false,
                    archived: false,
                  },
                ]
              : [];
          }),
          nextPage: job.next_page,
        }
      : await listOrganizationRepos({
          org: job.org_login,
          page,
          perPage: batchSize,
          includeForks: job.include_forks,
          includeArchived: job.include_archived,
        });
  const repos = listed.repos.filter((repo) => retryFailures || repo.stars >= minStars);
  const projects: {
    project: Awaited<ReturnType<typeof scanProject>>;
    safety: ReturnType<typeof assessProjectSafety>;
    aiSummary: ProjectAiSummary;
  }[] = [];
  const failures: { repo: string; error: string }[] = [];
  const skippedByStars = listed.repos.length - repos.length;

  for (const repo of listed.repos) {
    if (!retryFailures && repo.stars < minStars) {
      await recordOrganizationProjectScanJobItem({
        jobId: job.id,
        registryFullName: repo.full_name,
        status: "skipped",
        error: "below_min_stars",
      });
    }
  }

  for (const repo of repos) {
    try {
      const project = await scanProject(job.org_login, repo.name);
      const safety = assessProjectSafety(project);
      const aiSummary = await generateProjectAiSummary(project, safety);
      await recordProjectScan(project, { aiSummary });
      projects.push({ project, safety, aiSummary });
      await recordOrganizationProjectScanJobItem({
        jobId: job.id,
        registryFullName: repo.full_name,
        sourceFullName: project.full_name,
        status: "done",
        score: project.score,
        band: project.band,
        safetyLevel: safety.level,
      });
    } catch (e) {
      const error = mapScanError(e);
      failures.push({ repo: repo.full_name, error });
      await recordOrganizationProjectScanJobItem({
        jobId: job.id,
        registryFullName: repo.full_name,
        status: "failed",
        error,
      });
    }
  }

  const recorded = await recordOrganizationProjectCatalog({
    orgLogin: listed.org,
    requestedBy: input.requestedBy,
    pageStart: page,
    perPage: batchSize,
    nextPage: listed.nextPage,
    projects,
    failures,
  });
  const shouldRetryThisPage =
    !retryFailures && repos.length > 0 && projects.length === 0 && failures.length > 0;
  const nextPage = shouldRetryThisPage ? page : retryItems.length > 0 ? job.next_page : listed.nextPage;
  const status = shouldRetryThisPage
    ? "failed"
    : nextPage
      ? "running"
      : failures.length > 0 && retryFailures
        ? "failed"
        : "done";
  job =
    (await updateOrganizationProjectScanJobAfterBatch({
      jobId: job.id,
      nextPage,
      scannedDelta: projects.length,
      failedDelta: failures.length,
      skippedDelta: skippedByStars,
      status,
      lastError: shouldRetryThisPage
        ? failures[0]?.error ?? "batch_failed"
        : status === "failed"
          ? failures[0]?.error ?? null
          : null,
    })) ?? job;

  return {
    job,
    page,
    batchSize,
    nextPage,
    listed: listed.repos.length,
    skippedByStars,
    scanned: projects.length,
    failed: failures.length,
    runId: recorded.runId,
    written: recorded.written,
    projects: projects.map(({ project, safety, aiSummary }) => ({
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
      ai_summary: aiSummary,
    })),
    failures,
  };
}

function scheduleOrganizationProjectScanJob(jobId: string, requestedBy: string | null): void {
  if (activeOrgScanJobs.has(jobId)) return;
  activeOrgScanJobs.add(jobId);

  const run = async () => {
    try {
      let job = await getOrganizationProjectScanJob(jobId);
      while (job && job.status !== "done" && job.status !== "failed") {
        const batch = await runOrganizationProjectScanBatch({ job, requestedBy });
        job = batch.job;
        if (!batch.nextPage || job.status === "done" || job.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (e) {
      const error = mapScanError(e);
      await updateOrganizationProjectScanJobAfterBatch({
        jobId,
        nextPage: (await getOrganizationProjectScanJob(jobId))?.next_page ?? 1,
        scannedDelta: 0,
        failedDelta: 0,
        skippedDelta: 0,
        status: "failed",
        lastError: error,
      });
      console.error("organization project background scan failed:", e);
    } finally {
      activeOrgScanJobs.delete(jobId);
    }
  };

  setTimeout(() => {
    void run();
  }, 0);
}

export async function GET() {
  const access = await getAdminAccess();
  if (!access.ok) {
    return errorResponse(access.reason, access.reason === "unauthorized" ? 401 : 403);
  }
  const [jobs, stats] = await Promise.all([
    listOrganizationProjectScanJobs(20),
    getOrganizationProjectCatalogStats(),
  ]);
  return NextResponse.json({ jobs, stats });
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

  const requestedJobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const retryFailures = body.retryFailures === true;
  let job = requestedJobId ? await getOrganizationProjectScanJob(requestedJobId) : null;
  if (requestedJobId && !job) return errorResponse("job_not_found", 404);

  if (!job) {
    const org = parseOrganizationInput(body.org);
    if (!org) return errorResponse("invalid_org", 400);
    job = await createOrganizationProjectScanJob({
      orgLogin: org,
      requestedBy: access.session.user.login,
      page: Math.max(1, Math.floor(num(body.page, 1))),
      batchSize: Math.max(1, Math.min(30, Math.floor(num(body.batchSize, 15)))),
      minStars: Math.max(0, Math.floor(num(body.minStars, 0))),
      includeForks: body.includeForks === true,
      includeArchived: body.includeArchived === true,
    });
    if (!job) return errorResponse("job_create_failed", 500);
  }

  if (job.status === "done" && !retryFailures) {
    return NextResponse.json({ job, done: true });
  }

  try {
    if (retryFailures) {
      const batch = await runOrganizationProjectScanBatch({
        job,
        requestedBy: access.session.user.login,
        retryFailures: true,
      });
      return NextResponse.json({
        ...batch,
        jobId: job.id,
        org: job.org_login,
        background: false,
      });
    }

    const runningJob = (await markOrganizationProjectScanJobRunning(job.id)) ?? job;
    scheduleOrganizationProjectScanJob(job.id, access.session.user.login);
    return NextResponse.json({
      job: runningJob,
      jobId: job.id,
      org: job.org_login,
      page: runningJob.next_page,
      batchSize: runningJob.batch_size,
      nextPage: runningJob.next_page,
      listed: 0,
      skippedByStars: 0,
      scanned: 0,
      failed: 0,
      runId: null,
      written: 0,
      projects: [],
      failures: [],
      background: true,
    });
  } catch (e) {
    const error = mapScanError(e);
    await updateOrganizationProjectScanJobAfterBatch({
      jobId: job.id,
      nextPage: job.next_page,
      scannedDelta: 0,
      failedDelta: 0,
      skippedDelta: 0,
      status: "failed",
      lastError: error,
    });
    if (e instanceof AccountNotFoundError) return errorResponse("organization_not_found", 404);
    if (e instanceof GitHubRateLimitError) return errorResponse("github_rate_limited", 503);
    if (e instanceof GitHubDataUnavailableError) return errorResponse("github_unavailable", 503);
    console.error("organization project scan failed:", e);
    return errorResponse("organization_project_scan_failed", 500);
  }
}
