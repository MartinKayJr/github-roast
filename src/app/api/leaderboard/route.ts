import { NextResponse } from "next/server";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/db";
import { getCachedLeaderboard, setCachedLeaderboard } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 500;

// CDN-cache the whole payload so most visitors are served from Vercel's edge
// without invoking the function at all (the big lever on the serverless bill).
// stale-while-revalidate keeps it instant while one background request refreshes.
const CDN_CACHE = "public, s-maxage=120, stale-while-revalidate=600";

export async function GET() {
  const cached = await getCachedLeaderboard();
  if (cached) {
    return NextResponse.json(
      { entries: cached, cached: true },
      { headers: { "Cache-Control": CDN_CACHE } },
    );
  }

  const entries: LeaderboardEntry[] = await getLeaderboard(LIMIT);
  await setCachedLeaderboard(entries);
  return NextResponse.json(
    { entries, cached: false },
    { headers: { "Cache-Control": CDN_CACHE } },
  );
}
