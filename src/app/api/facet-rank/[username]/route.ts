import { NextResponse } from "next/server";
import { getFacetRank, getScoreBrief } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Language-bucket rank for a freshly-roasted user, read client-side by the roast
 * result modal to render its "see where I rank on {lang}" exit. The score row was
 * just persisted, so we look it up (getScoreBrief) and derive the rank. Returns
 * `{ facetRank: null }` whenever there's no bucket to show — the modal simply
 * hides the CTA.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const decoded = decodeURIComponent(username);
  const brief = await getScoreBrief(decoded);
  if (!brief) return NextResponse.json({ facetRank: null });
  const facetRank = await getFacetRank(brief.username, brief.final_score);
  return NextResponse.json({ facetRank });
}
