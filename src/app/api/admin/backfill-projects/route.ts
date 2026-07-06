import { NextRequest, NextResponse } from "next/server";
import { backfillProjectCirclesFromSnapshots } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One-off/re-runnable project-circle seeding from existing roasted developers.
 * It reads local profile_snapshots + scores only, so it does not spend GitHub or
 * LLM quota. New project scans keep project circles fresh on their own.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit")) || 500));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const minDeveloperScore = Math.max(
    0,
    Math.min(100, Number(url.searchParams.get("minDeveloperScore")) || 60),
  );
  const minProjectScore = Math.max(
    0,
    Math.min(100, Number(url.searchParams.get("minProjectScore")) || 48),
  );
  const minStars = Math.max(0, Number(url.searchParams.get("minStars")) || 5);
  const dryRun = url.searchParams.get("dry") === "1";

  const summary = await backfillProjectCirclesFromSnapshots({
    limit,
    offset,
    minDeveloperScore,
    minProjectScore,
    minStars,
    dryRun,
  });

  return NextResponse.json(summary);
}
