import { NextRequest, NextResponse } from "next/server";
import type { LeaderboardWindow } from "@/lib/db";
import { getGrowthTimeline } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CDN_CACHE = "public, s-maxage=120, stale-while-revalidate=600";

function parseWindow(raw: string | null): LeaderboardWindow {
  if (raw === "24h") return "24h";
  if (raw === "7d") return "7d";
  if (raw === "all") return "all";
  return "30d";
}

export async function GET(req: NextRequest) {
  const window = parseWindow(req.nextUrl.searchParams.get("window"));
  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "120"), 1),
    500,
  );

  const points = await getGrowthTimeline(limit, window);

  return NextResponse.json(
    {
      window,
      updated_at: Date.now(),
      points,
    },
    { headers: { "Cache-Control": CDN_CACHE } },
  );
}
