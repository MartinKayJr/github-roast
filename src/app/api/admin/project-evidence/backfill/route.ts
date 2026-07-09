import { NextRequest, NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import {
  countProjectsMissingEvidence,
  listProjectsMissingEvidence,
  updateStoredProjectEvidence,
} from "@/lib/db";
import {
  AccountNotFoundError,
  GitHubDataUnavailableError,
  GitHubRateLimitError,
} from "@/lib/github";
import { scanProject } from "@/lib/project-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface BackfillBody {
  batchSize?: unknown;
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function batchSize(input: unknown): number {
  const value = Number(input);
  return Math.max(1, Math.min(30, Number.isFinite(value) ? Math.floor(value) : 10));
}

export async function GET() {
  const access = await getAdminAccess();
  if (!access.ok) {
    return errorResponse(access.reason, access.reason === "unauthorized" ? 401 : 403);
  }
  return NextResponse.json({ missing: await countProjectsMissingEvidence() });
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

  const projects = await listProjectsMissingEvidence(batchSize(body.batchSize));
  let processed = 0;
  let failed = 0;
  const failures: { repo: string; error: string }[] = [];

  for (const item of projects) {
    const fullName = `${item.owner}/${item.repo}`;
    try {
      const project = await scanProject(item.owner, item.repo);
      await updateStoredProjectEvidence({ project, aiSummary: item.aiSummary });
      processed += 1;
    } catch (e) {
      failed += 1;
      const error =
        e instanceof AccountNotFoundError
          ? "project_not_found"
          : e instanceof GitHubRateLimitError
            ? "github_rate_limited"
            : e instanceof GitHubDataUnavailableError
              ? "github_unavailable"
              : e instanceof Error
                ? e.message
                : "backfill_failed";
      failures.push({ repo: fullName, error });
    }
  }

  return NextResponse.json({
    processed,
    failed,
    failures,
    missing: await countProjectsMissingEvidence(),
  });
}
