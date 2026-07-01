import { NextRequest, NextResponse } from "next/server";
import {
  getDevelopersByFacetCached,
  getFacetCategoriesCached,
} from "@/lib/developers";
import type { FacetType } from "@/lib/facets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CDN-cache the payload at the edge so most visitors never invoke the function,
// with stale-while-revalidate keeping it instant during a background refresh —
// the same lever /api/leaderboard uses. The directory moves slowly, so a longer
// edge window than the boards is fine.
const CDN_CACHE = "public, s-maxage=300, stale-while-revalidate=1800";

function parseFacetType(raw: string | null): FacetType | null {
  return raw === "language" || raw === "org" ? raw : null;
}

/**
 * Directory JSON:
 *   ?type=language            → category grid for that facet type
 *   ?type=language&value=Rust → the head of one bucket (developers)
 * Everything is served from the Redis cache-aside in lib/developers.ts, then
 * CDN-cached on top.
 */
export async function GET(req: NextRequest) {
  const type = parseFacetType(req.nextUrl.searchParams.get("type"));
  if (!type) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }
  const value = req.nextUrl.searchParams.get("value");

  if (value) {
    const entries = await getDevelopersByFacetCached(type, value);
    return NextResponse.json(
      { type, value, entries },
      { headers: { "Cache-Control": CDN_CACHE } },
    );
  }

  const categories = await getFacetCategoriesCached(type);
  return NextResponse.json(
    { type, categories },
    { headers: { "Cache-Control": CDN_CACHE } },
  );
}
