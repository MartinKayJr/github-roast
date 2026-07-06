import { NextRequest, NextResponse } from "next/server";
import { getCommunityDomains } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/community/domains
 *
 * The community galaxy waterfall feed: active domains ordered by heat, each with
 * its representative members. Paginated with an opaque `cursor` (numeric offset)
 * echoed back as `nextCursor`. `limit` is clamped server-side.
 *
 * Public and unauthenticated — anyone can browse domains. Returns bilingual
 * name/description; the client resolves to the viewer's language.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

  const page = await getCommunityDomains({ cursor, limit });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
