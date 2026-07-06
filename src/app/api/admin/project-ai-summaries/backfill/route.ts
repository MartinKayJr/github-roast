import { NextRequest, NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import {
  countProjectsMissingAiSummary,
  createProjectAiSummaryBackfillJob,
  getProjectAiSummaryBackfillJob,
  listProjectAiSummaryBackfillJobs,
  listProjectsMissingAiSummary,
  markProjectAiSummaryBackfillJobRunning,
  updateProjectAiSummaryBackfillJobAfterBatch,
  updateStoredProjectAiSummary,
  type ProjectAiSummaryBackfillJob,
} from "@/lib/db";
import { generateProjectAiSummary } from "@/lib/project-ai-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const activeBackfillJobs = new Set<string>();

interface BackfillBody {
  jobId?: unknown;
  batchSize?: unknown;
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function num(input: unknown, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

async function runProjectAiSummaryBackfillBatch(job: ProjectAiSummaryBackfillJob): Promise<{
  job: ProjectAiSummaryBackfillJob;
  processed: number;
  failed: number;
  remaining: number;
}> {
  let current = (await markProjectAiSummaryBackfillJobRunning(job.id)) ?? job;
  const batch = await listProjectsMissingAiSummary(current.batch_size);
  if (batch.length === 0) {
    current =
      (await updateProjectAiSummaryBackfillJobAfterBatch({
        jobId: current.id,
        processedDelta: 0,
        failedDelta: 0,
        status: "done",
      })) ?? current;
    return { job: current, processed: 0, failed: 0, remaining: 0 };
  }

  let processed = 0;
  let failed = 0;
  let lastError: string | null = null;
  for (const item of batch) {
    try {
      const aiSummary =
        item.existingAiSummary ?? (await generateProjectAiSummary(item.project, item.safety));
      await updateStoredProjectAiSummary({
        project: item.project,
        safety: item.safety,
        aiSummary,
      });
      processed += 1;
    } catch (e) {
      failed += 1;
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  const remaining = await countProjectsMissingAiSummary();
  current =
    (await updateProjectAiSummaryBackfillJobAfterBatch({
      jobId: current.id,
      processedDelta: processed,
      failedDelta: failed,
      status: remaining > 0 && processed > 0 ? "running" : remaining > 0 ? "failed" : "done",
      lastError,
    })) ?? current;
  return { job: current, processed, failed, remaining };
}

function scheduleProjectAiSummaryBackfillJob(jobId: string): void {
  if (activeBackfillJobs.has(jobId)) return;
  activeBackfillJobs.add(jobId);

  const run = async () => {
    try {
      let job = await getProjectAiSummaryBackfillJob(jobId);
      while (job && job.status !== "done" && job.status !== "failed") {
        const batch = await runProjectAiSummaryBackfillBatch(job);
        job = batch.job;
        if (batch.remaining <= 0 || job.status === "done" || job.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (e) {
      await updateProjectAiSummaryBackfillJobAfterBatch({
        jobId,
        processedDelta: 0,
        failedDelta: 1,
        status: "failed",
        lastError: e instanceof Error ? e.message : String(e),
      });
      console.error("project AI summary backfill failed:", e);
    } finally {
      activeBackfillJobs.delete(jobId);
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
  const [jobs, missing] = await Promise.all([
    listProjectAiSummaryBackfillJobs(10),
    countProjectsMissingAiSummary(),
  ]);
  return NextResponse.json({ jobs, missing });
}

export async function POST(req: NextRequest) {
  const access = await getAdminAccess();
  if (!access.ok) {
    return errorResponse(access.reason, access.reason === "unauthorized" ? 401 : 403);
  }

  let body: BackfillBody;
  try {
    body = (await req.json()) as BackfillBody;
  } catch {
    return errorResponse("invalid_body", 400);
  }

  const requestedJobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  let job = requestedJobId ? await getProjectAiSummaryBackfillJob(requestedJobId) : null;
  if (requestedJobId && !job) return errorResponse("job_not_found", 404);
  if (job?.status === "done") {
    return NextResponse.json({
      job,
      missing: await countProjectsMissingAiSummary(),
      background: false,
    });
  }

  if (!job) {
    job = await createProjectAiSummaryBackfillJob({
      requestedBy: access.session.user.login,
      batchSize: Math.max(1, Math.min(30, Math.floor(num(body.batchSize, 10)))),
    });
    if (!job) return errorResponse("job_create_failed", 500);
  }

  const runningJob = (await markProjectAiSummaryBackfillJobRunning(job.id)) ?? job;
  scheduleProjectAiSummaryBackfillJob(job.id);
  return NextResponse.json({
    job: runningJob,
    missing: await countProjectsMissingAiSummary(),
    background: true,
  });
}
