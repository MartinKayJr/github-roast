import { NextRequest, NextResponse } from "next/server";
import { listProjectCircleItems, type ProjectCircleListPreset } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESETS = new Set<ProjectCircleListPreset>([
  "all",
  "xposed",
  "ai",
  "security",
  "devtools",
]);

function parsePreset(raw: string | null): ProjectCircleListPreset {
  return raw && PRESETS.has(raw as ProjectCircleListPreset)
    ? (raw as ProjectCircleListPreset)
    : "all";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const query = url.searchParams.get("q");
  const preset = parsePreset(url.searchParams.get("preset"));
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
  const projects = await listProjectCircleItems({ query, preset, limit });
  return NextResponse.json(
    { query: query ?? "", preset, projects },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=120" } },
  );
}
