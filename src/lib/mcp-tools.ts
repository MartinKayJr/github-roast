/**
 * Shared logic for the MCP tools (src/app/api/[transport]/route.ts). Each function
 * calls the internal libs directly — never an HTTP self-call — and returns a plain
 * JS object. Deterministic, read-only, and routed through the same caches the REST
 * endpoints use, so an agent looping over these can't amplify GitHub/DB load.
 */
import { getAccountDetail, getPercentile, getRank, searchScoredUsers } from "@/lib/db";
import { getLeaderboardCached } from "@/lib/leaderboard";
import type { LeaderboardCacheView } from "@/lib/redis";
import type { LeaderboardWindow } from "@/lib/db";
import { coalesceScan, getCachedScan } from "@/lib/redis";
import { buildScanResult, scanErrorResponse } from "@/lib/scan-core";
import { normalizeUsername } from "@/lib/username";
import { beatPercent } from "@/lib/percentile";
import { TIER_KEY } from "@/lib/tier";
import { SITE_URL } from "@/lib/site";
import type { ScanResult, Tier } from "@/lib/types";

export type ToolError = { error: string; message: string };

async function percentileFor(finalScore: number) {
  const [rank, pct] = await Promise.all([getRank(finalScore), getPercentile(finalScore)]);
  return pct
    ? { beat: beatPercent(pct.below, pct.total), total: pct.total, rank: rank?.rank ?? null }
    : null;
}

/** Deterministic score for one account (indexed hit, else a live scan). */
export async function scoreUser(rawUsername: string): Promise<Record<string, unknown> | ToolError> {
  const handle = normalizeUsername(rawUsername ?? "");
  if (!handle) {
    return { error: "invalid_username", message: "username must be a valid GitHub login" };
  }

  const detail = await getAccountDetail(handle);
  if (detail) {
    return {
      source: "indexed",
      username: detail.username,
      display_name: detail.display_name,
      final_score: detail.final_score,
      tier: detail.tier,
      tier_key: TIER_KEY[detail.tier],
      sub_scores: detail.sub_scores,
      percentile: await percentileFor(detail.final_score),
      scanned_at: detail.scanned_at,
      profile: `${SITE_URL}/u/${detail.username}`,
    };
  }

  let result: ScanResult;
  try {
    const cached = await getCachedScan(handle);
    result = cached ?? (await coalesceScan(handle, () => buildScanResult(handle)));
  } catch (e) {
    const { error } = scanErrorResponse(e);
    return { error, message: `could not score ${handle}` };
  }

  const s = result.scoring;
  const m = result.metrics;
  const tier = s.tier as Tier;
  return {
    source: "live",
    username: m.username,
    display_name: m.name,
    final_score: s.final_score,
    tier,
    tier_key: TIER_KEY[tier],
    sub_scores: s.sub_scores,
    red_flags: s.red_flags,
    percentile: await percentileFor(s.final_score),
    profile: `${SITE_URL}/u/${m.username}`,
  };
}

/** Full deterministic scan payload for one account. */
export async function scanUser(rawUsername: string): Promise<ScanResult | ToolError> {
  const handle = normalizeUsername(rawUsername ?? "");
  if (!handle) {
    return { error: "invalid_username", message: "username must be a valid GitHub login" };
  }
  try {
    const cached = await getCachedScan(handle);
    return cached ?? (await coalesceScan(handle, () => buildScanResult(handle)));
  } catch (e) {
    const { error } = scanErrorResponse(e);
    return { error, message: `could not scan ${handle}` };
  }
}

/** Head-to-head: two deterministic scores side by side (no LLM verdict). */
export async function compareUsers(rawA: string, rawB: string): Promise<Record<string, unknown> | ToolError> {
  const [a, b] = await Promise.all([scoreUser(rawA), scoreUser(rawB)]);
  if ("error" in a) return a;
  if ("error" in b) return b;
  const sa = a.final_score as number;
  const sb = b.final_score as number;
  const gap = Math.abs(sa - sb);
  return {
    a,
    b,
    winner: gap === 0 ? null : sa > sb ? a.username : b.username,
    gap: Number(gap.toFixed(2)),
    note: "Deterministic comparison. For a savage bilingual verdict, POST /api/vs-verdict.",
  };
}

/** Ranked developers. */
export async function getLeaderboard(
  view: LeaderboardCacheView = "trending",
  window: LeaderboardWindow = "all",
): Promise<Record<string, unknown>> {
  const { entries, cached } = await getLeaderboardCached(view, window);
  return { view, window, cached, count: entries.length, entries };
}

/** Prefix search over scored accounts. */
export async function searchUsers(q: string): Promise<Record<string, unknown>> {
  const query = (q ?? "").trim();
  if (query.length < 1) return { query, users: [] };
  const users = await searchScoredUsers(query, 6);
  return { query, users };
}
