import { NextRequest, NextResponse } from "next/server";
import { rebuildCircleDomainsFromFacets } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/rebuild-domains
 *
 * Rebuild the facet-derived community galaxy domains (Phase 1) from the local
 * `developer_facets` + `community_profiles` + `scores` data — no GitHub calls.
 * Idempotent and safe to re-run: it rewrites `source = 'facet'` domains and their
 * member rows wholesale, leaving AI-merged domains untouched. New community joins
 * and re-scans don't refresh domains on their own, so run this on a schedule (or
 * after a facet backfill) to keep the waterfall current.
 *
 * Guarded by ADMIN_SECRET (inert until set), mirroring backfill-facets.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const summary = await rebuildCircleDomainsFromFacets();
  return NextResponse.json(summary);
}
