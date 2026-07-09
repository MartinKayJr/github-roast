import { NextRequest, NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import {
  countGrowthBackfillCandidates,
  countPendingGrowthBackfillItems,
  createGrowthBackfillJob,
  getGrowthBackfillJob,
  listGrowthBackfillJobs,
  listPendingGrowthBackfillItems,
  markGrowthBackfillItemRunning,
  markGrowthBackfillJobRunning,
  resetFailedGrowthBackfillItems,
  updateGrowthBackfillItemResult,
  updateGrowthBackfillJobProgress,
  type GrowthBackfillJob,
} from "@/lib/db";
import { runGrowthScanForLogin, runGrowthScanForSubscription } from "@/lib/growth-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const activeGrowthBackfillJobs = new Set<string>();

interface GrowthBackfillBody {
  jobId?: unknown;
  batchSize?: unknown;
  retryFailures?: unknown;
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function num(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

async function runGrowthBackfillBatch(job: GrowthBackfillJob): Promise<{
  job: GrowthBackfillJob;
  processed: number;
  failed: number;
  skipped: number;
  remaining: number;
}> {
  let current = (await markGrowthBackfillJobRunning(job.id)) ?? job;
  const batch = await listPendingGrowthBackfillItems(current.id, current.batch_size);
  if (batch.length === 0) {
    current =
      (await updateGrowthBackfillJobProgress({
        jobId: current.id,
        processedDelta: 0,
        failedDelta: 0,
        skippedDelta: 0,
        status: "done",
      })) ?? current;
    return { job: current, processed: 0, failed: 0, skipped: 0, remaining: 0 };
  }

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let lastError: string | null = null;
  for (const item of batch) {
    await markGrowthBackfillItemRunning(item.id);
    const result =
      item.github_id !== null && item.source === "subscription"
        ? await runGrowthScanForSubscription({
            github_id: item.github_id,
            login: item.login,
          })
        : await runGrowthScanForLogin(item.login);
    if (result.ok) {
      await updateGrowthBackfillItemResult({
        itemId: item.id,
        status: "done",
        finalScore: result.finalScore ?? item.final_score,
      });
      processed += 1;
      continue;
    }

    const error = result.error ?? "scan_failed";
    if (result.status === 404) {
      await updateGrowthBackfillItemResult({
        itemId: item.id,
        status: "skipped",
        error,
      });
      skipped += 1;
      continue;
    }

    await updateGrowthBackfillItemResult({
      itemId: item.id,
      status: "failed",
      error,
    });
    failed += 1;
    lastError = error;
  }

  const remaining = await countPendingGrowthBackfillItems(current.id);
  current =
    (await updateGrowthBackfillJobProgress({
      jobId: current.id,
      processedDelta: processed,
      failedDelta: failed,
      skippedDelta: skipped,
      status: remaining > 0 && processed + skipped > 0 ? "running" : remaining > 0 ? "failed" : "done",
      lastError,
    })) ?? current;
  return { job: current, processed, failed, skipped, remaining };
}

function scheduleGrowthBackfillJob(jobId: string): void {
  if (activeGrowthBackfillJobs.has(jobId)) return;
  activeGrowthBackfillJobs.add(jobId);

  const run = async () => {
    try {
      let job = await getGrowthBackfillJob(jobId);
      while (job && job.status !== "done" && job.status !== "failed") {
        const batch = await runGrowthBackfillBatch(job);
        job = batch.job;
        if (batch.remaining <= 0 || job.status === "done" || job.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (e) {
      await updateGrowthBackfillJobProgress({
        jobId,
        processedDelta: 0,
        failedDelta: 1,
        skippedDelta: 0,
        status: "failed",
        lastError: e instanceof Error ? e.message : String(e),
      });
      console.error("growth backfill failed:", e);
    } finally {
      activeGrowthBackfillJobs.delete(jobId);
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
  const [jobs, candidates] = await Promise.all([
    listGrowthBackfillJobs(10),
    countGrowthBackfillCandidates(),
  ]);
  return NextResponse.json({ jobs, candidates });
}

export async function POST(req: NextRequest) {
  const access = await getAdminAccess();
  if (!access.ok) {
    return errorResponse(access.reason, access.reason === "unauthorized" ? 401 : 403);
  }

  let body: GrowthBackfillBody;
  try {
    body = (await req.json()) as GrowthBackfillBody;
  } catch {
    return errorResponse("invalid_body", 400);
  }

  const requestedJobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const retryFailures = body.retryFailures === true;
  let job = requestedJobId ? await getGrowthBackfillJob(requestedJobId) : null;
  if (requestedJobId && !job) return errorResponse("job_not_found", 404);
  if (job?.status === "done" && !retryFailures) {
    return NextResponse.json({
      job,
      candidates: await countGrowthBackfillCandidates(),
      background: false,
    });
  }

  if (!job) {
    job = await createGrowthBackfillJob({
      requestedBy: access.session.user.login,
      batchSize: Math.max(1, Math.min(30, Math.floor(num(body.batchSize, 10)))),
    });
    if (!job) return errorResponse("job_create_failed", 500);
  }

  if (retryFailures) {
    await resetFailedGrowthBackfillItems(job.id);
  }

  const runningJob = (await markGrowthBackfillJobRunning(job.id)) ?? job;
  scheduleGrowthBackfillJob(job.id);
  return NextResponse.json({
    job: runningJob,
    candidates: await countGrowthBackfillCandidates(),
    background: true,
  });
}
