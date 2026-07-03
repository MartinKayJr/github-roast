import { NextRequest, NextResponse } from "next/server";
import { recordAccountLookup } from "@/lib/db";
import {
  checkRateLimit,
  coalesceScan,
  getCachedScan,
} from "@/lib/redis";
import { buildScanResult, scanErrorResponse } from "@/lib/scan-core";
import { verifyTurnstile } from "@/lib/turnstile";
import { normalizeUsername } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "0.0.0.0";
}

function hasMachineAuth(req: NextRequest): boolean {
  const expected = process.env.GITHUB_ROAST_CLI_API_KEY;
  if (!expected) return false;
  const value = req.headers.get("authorization") ?? "";
  const token = value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return token === expected;
}

async function recordSuccessfulLookup(username: string, ip: string): Promise<void> {
  // Record the lookup for heat/trending counts, but intentionally DON'T bust the
  // leaderboard cache here. Under real traffic this "counted" path fires
  // constantly (first lookup per IP per account per 24h), and clearing all 16
  // board variants each time meant the 5-min cache almost never survived — every
  // /leaderboard visit then ran the heavy 500-row triple JOIN and hammered Turso
  // (slow board + cascading DB timeouts elsewhere). A board that's up to one TTL
  // stale is perfectly fine; natural expiry refreshes it.
  await recordAccountLookup(username, ip);
}

export async function POST(req: NextRequest) {
  let body: { username?: string; turnstileToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const username = normalizeUsername(body.username ?? "");
  if (!username) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  }

  const ip = clientIp(req);

  if (!hasMachineAuth(req)) {
    const human = await verifyTurnstile(body.turnstileToken ?? null, ip);
    if (!human) {
      return NextResponse.json({ error: "turnstile_failed" }, { status: 403 });
    }
  }

  // Cache hit short-circuits both GitHub and (later) the LLM. The leaderboard
  // row + percentile are produced by /api/roast (which has the AI-adjusted final
  // score), so the scan response stays purely the deterministic result.
  const cached = await getCachedScan(username);
  if (cached) {
    await recordSuccessfulLookup(cached.metrics.username, ip);
    return NextResponse.json({ ...cached, cached: true });
  }

  const { success } = await checkRateLimit(ip);
  if (!success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const result = await coalesceScan(username, () => buildScanResult(username));
    await recordSuccessfulLookup(result.metrics.username, ip);
    return NextResponse.json({ ...result, cached: false });
  } catch (e) {
    const { error, status, retry_after } = scanErrorResponse(e);
    return NextResponse.json(
      retry_after ? { error, retry_after } : { error },
      retry_after
        ? { status, headers: { "Retry-After": String(retry_after) } }
        : { status },
    );
  }
}
