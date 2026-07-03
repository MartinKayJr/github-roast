import { NextRequest, NextResponse } from "next/server";
import { recordAccountLookup } from "@/lib/db";
import {
  checkRateLimit,
  coalesceScan,
  getCachedScan,
  rateLimitHeaders,
} from "@/lib/redis";
import { apiError } from "@/lib/api-error";
import { buildScanResult, scanErrorResponse } from "@/lib/scan-core";
import { verifyTurnstile } from "@/lib/turnstile";
import { normalizeUsername } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "0.0.0.0";
}

/** Presence + validity of the Authorization header, kept separate so an invalid
 *  key returns a spec-shaped 401 (with WWW-Authenticate) instead of falling
 *  through to the browser Turnstile path. */
function machineAuth(req: NextRequest): "valid" | "invalid" | "absent" {
  const value = req.headers.get("authorization") ?? "";
  if (!value) return "absent";
  const expected = process.env.GITHUB_ROAST_CLI_API_KEY;
  const token = value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return expected && token === expected ? "valid" : "invalid";
}

/** Echo the client's Idempotency-Key so retries are correlatable. Scans are
 *  idempotent per username (shared cache + single-flight), so no storage needed. */
function idempotencyHeaders(req: NextRequest): Record<string, string> {
  const key = req.headers.get("idempotency-key");
  return key ? { "Idempotency-Key": key } : {};
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
  const idem = idempotencyHeaders(req);

  let body: { username?: string; turnstileToken?: string };
  try {
    body = await req.json();
  } catch {
    return apiError("invalid_body", { status: 400, headers: idem });
  }

  const username = normalizeUsername(body.username ?? "");
  if (!username) {
    return apiError("invalid_username", { status: 400, headers: idem });
  }

  const ip = clientIp(req);

  const auth = machineAuth(req);
  if (auth === "invalid") {
    // An Authorization header was sent but the key is wrong — tell agents how to
    // authenticate (spec-shaped WWW-Authenticate is added by apiError on 401).
    return apiError("unauthorized", { status: 401, headers: idem });
  }
  if (auth === "absent") {
    const human = await verifyTurnstile(body.turnstileToken ?? null, ip);
    if (!human) {
      return apiError("turnstile_failed", { status: 403, headers: idem });
    }
  }

  // Cache hit short-circuits both GitHub and (later) the LLM. The leaderboard
  // row + percentile are produced by /api/roast (which has the AI-adjusted final
  // score), so the scan response stays purely the deterministic result.
  const cached = await getCachedScan(username);
  if (cached) {
    await recordSuccessfulLookup(cached.metrics.username, ip);
    return NextResponse.json({ ...cached, cached: true }, { headers: idem });
  }

  const limit = await checkRateLimit(ip);
  const rlHeaders = rateLimitHeaders(limit);
  if (!limit.success) {
    return apiError("rate_limited", { status: 429, headers: { ...idem, ...rlHeaders } });
  }

  try {
    const result = await coalesceScan(username, () => buildScanResult(username));
    await recordSuccessfulLookup(result.metrics.username, ip);
    return NextResponse.json(
      { ...result, cached: false },
      { headers: { ...idem, ...rlHeaders } },
    );
  } catch (e) {
    const { error, status, retry_after } = scanErrorResponse(e);
    return apiError(error as Parameters<typeof apiError>[0], {
      status,
      headers: {
        ...idem,
        ...rlHeaders,
        ...(retry_after ? { "Retry-After": String(retry_after) } : {}),
      },
    });
  }
}
