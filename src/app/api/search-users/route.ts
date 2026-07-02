import { NextRequest, NextResponse } from "next/server";
import { searchScoredUsers } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Omnibox autocomplete: prefix-search already-scored accounts so the homepage can
 * offer a judged handle directly (with its score) for roast and PK. Read-only,
 * CDN-cached briefly — the DB set changes slowly relative to keystrokes.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 1) return NextResponse.json({ users: [] });
  const users = await searchScoredUsers(q, 6);
  return NextResponse.json(
    { users },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
