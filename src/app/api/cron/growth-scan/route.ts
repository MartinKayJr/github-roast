import { NextRequest, NextResponse } from "next/server";
import {
  listDueGrowthScanSubscriptions,
  markGrowthScanSubscriptionRun,
  recordProfileSnapshot,
  recordScore,
} from "@/lib/db";
import { scanErrorResponse, buildScanResult } from "@/lib/scan-core";
import { spamBotScore } from "@/lib/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EMPTY_TAGS = { zh: [], en: [] };
const EMPTY_ROAST_LINE = { zh: "", en: "" };
const DEFAULT_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_SECRET;
  if (!secret) return false;
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer === secret || req.headers.get("x-admin-secret") === secret;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGrowthScan(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const limit = Math.min(
    25,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 10),
  );
  const intervalHours = Math.max(
    1,
    Number(req.nextUrl.searchParams.get("intervalHours")) || 24,
  );
  const delayMs = Math.min(
    5000,
    Math.max(0, Number(req.nextUrl.searchParams.get("delayMs")) || 1000),
  );

  const subscriptions = await listDueGrowthScanSubscriptions(
    limit,
    intervalHours * 60 * 60 * 1000 || DEFAULT_MIN_INTERVAL_MS,
  );

  let succeeded = 0;
  let failed = 0;
  const errors: { login: string; error: string; status?: number }[] = [];

  for (let i = 0; i < subscriptions.length; i++) {
    const subscription = subscriptions[i];
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    const attemptedAt = Date.now();
    try {
      const scan = await buildScanResult(subscription.login);
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
        scanned_at: attemptedAt,
      });
      await recordProfileSnapshot(scan);
      await markGrowthScanSubscriptionRun(subscription.github_id, {
        last_scanned_at: attemptedAt,
        last_error: null,
      });
      succeeded++;
    } catch (e) {
      const mapped = scanErrorResponse(e);
      const message = mapped.error || (e instanceof Error ? e.message : String(e));
      await markGrowthScanSubscriptionRun(subscription.github_id, {
        last_scanned_at: attemptedAt,
        last_error: message,
      });
      failed++;
      errors.push({
        login: subscription.login,
        error: message,
        status: mapped.status,
      });
    }
  }

  return NextResponse.json({
    processed: subscriptions.length,
    succeeded,
    failed,
    errors: errors.slice(0, 20),
  });
}

export async function GET(req: NextRequest) {
  return runGrowthScan(req);
}

export async function POST(req: NextRequest) {
  return runGrowthScan(req);
}
