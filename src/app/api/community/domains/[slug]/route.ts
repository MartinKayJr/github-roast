import { NextRequest, NextResponse } from "next/server";
import { getCommunityDomain } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/community/domains/[slug]
 *
 * Full detail for a single domain planet: metadata plus its ranked member pool.
 * Public and unauthenticated. 404 when the slug is unknown or hidden.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const domain = await getCommunityDomain(decodeURIComponent(slug));
  if (!domain) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(domain, { headers: { "Cache-Control": "no-store" } });
}
