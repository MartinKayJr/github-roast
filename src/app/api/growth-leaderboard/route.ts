import { NextRequest, NextResponse } from "next/server";
import type { LeaderboardWindow } from "@/lib/db";
import { getContributionGrowthLeaderboard } from "@/lib/db";
import { BAND_KEYS, bandFor, type BandKey } from "@/lib/band";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CDN_CACHE = "public, s-maxage=120, stale-while-revalidate=600";
const GROWTH_LIMIT = 500;

function parseBand(raw: string | null): BandKey {
  if (raw && (BAND_KEYS as string[]).includes(raw)) return raw as BandKey;
  return "A";
}

function parseWindow(raw: string | null): LeaderboardWindow {
  if (raw === "24h") return "24h";
  if (raw === "7d") return "7d";
  if (raw === "all") return "all";
  return "30d";
}

function toGrowthEntry(e: {
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  final_score: number;
  contribution_delta: number;
  merged_pr_delta: number;
  impact_commit_delta: number;
  growth_score: number;
  latest_snapshot_at: number;
}) {
  const band = bandFor(e.final_score);
  return {
    username: e.username,
    display_name: e.display_name ?? null,
    avatar_url: e.avatar_url ?? null,
    band,
    contribution_delta: e.contribution_delta,
    merged_pr_delta: e.merged_pr_delta,
    impact_commit_delta: e.impact_commit_delta,
    growth_score: e.growth_score,
    latest_snapshot_at: e.latest_snapshot_at,
  };
}

export async function GET(req: NextRequest) {
  const band = parseBand(req.nextUrl.searchParams.get("band"));
  const window = parseWindow(req.nextUrl.searchParams.get("window"));
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "12"), 1), 50);

  const all = await getContributionGrowthLeaderboard(GROWTH_LIMIT, window);

  const bandCounts: Record<BandKey, number> = Object.fromEntries(
    BAND_KEYS.map((k) => [k, 0]),
  ) as Record<BandKey, number>;
  for (const e of all) {
    bandCounts[bandFor(e.final_score)]++;
  }

  const bandEntries = all
    .filter((e) => bandFor(e.final_score) === band)
    .slice(0, limit)
    .map(toGrowthEntry);

  const bands = BAND_KEYS.map((k) => ({ band: k, count: bandCounts[k] }));

  return NextResponse.json(
    {
      window,
      band,
      updated_at: Date.now(),
      cached: false,
      bands,
      entries: bandEntries,
    },
    { headers: { "Cache-Control": CDN_CACHE } },
  );
}
