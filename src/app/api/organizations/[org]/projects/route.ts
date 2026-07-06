import { NextRequest, NextResponse } from "next/server";
import { searchOrganizationProjectCatalog } from "@/lib/db";
import { parseOrganizationInput } from "@/lib/project-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public organization project catalog search. It reads only projects already
 * scanned by an admin batch, making it cheap enough for circle UI and future AI
 * search/rerank flows.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ org: string }> },
) {
  const params = await ctx.params;
  const org = parseOrganizationInput(params.org);
  if (!org) {
    return NextResponse.json({ error: "invalid_org" }, { status: 400 });
  }
  const url = new URL(req.url);
  const query = url.searchParams.get("q");
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
  const projects = await searchOrganizationProjectCatalog(org, { query, limit });
  return NextResponse.json(
    { org, query: query ?? "", projects },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=120" } },
  );
}
