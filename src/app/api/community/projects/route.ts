import { NextRequest, NextResponse } from "next/server";
import {
  listProjectCircleItems,
  type ProjectCircleListPreset,
  type ProjectCircleListSort,
} from "@/lib/db";
import type { ProjectBand } from "@/lib/project-scan";
import type { ProjectSafetyLevel } from "@/lib/project-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESETS = new Set<ProjectCircleListPreset>([
  "all",
  "xposed",
  "ai",
  "security",
  "devtools",
]);
const SORTS = new Set<ProjectCircleListSort>(["relevance", "score", "stars", "recent"]);
const BANDS = new Set<ProjectBand>(["S+", "S", "A+", "A", "B+", "B", "C+", "C"]);
const SAFETY_LEVELS = new Set<ProjectSafetyLevel>(["A", "B", "C", "D"]);

function parsePreset(raw: string | null): ProjectCircleListPreset {
  return raw && PRESETS.has(raw as ProjectCircleListPreset)
    ? (raw as ProjectCircleListPreset)
    : "all";
}

function parseSort(raw: string | null): ProjectCircleListSort {
  return raw && SORTS.has(raw as ProjectCircleListSort)
    ? (raw as ProjectCircleListSort)
    : "relevance";
}

function parseNumber(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const query = url.searchParams.get("q");
  const preset = parsePreset(url.searchParams.get("preset"));
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
  const bandRaw = url.searchParams.get("band");
  const safetyRaw = url.searchParams.get("safety");
  const projects = await listProjectCircleItems({
    query,
    preset,
    limit,
    filters: {
      language: url.searchParams.get("language"),
      band: bandRaw && BANDS.has(bandRaw as ProjectBand) ? (bandRaw as ProjectBand) : null,
      safetyLevel:
        safetyRaw && SAFETY_LEVELS.has(safetyRaw as ProjectSafetyLevel)
          ? (safetyRaw as ProjectSafetyLevel)
          : null,
      minScore: parseNumber(url.searchParams.get("minScore")),
      minStars: parseNumber(url.searchParams.get("minStars")),
      hasAiSummary: url.searchParams.get("aiSummary") === "1",
      sort: parseSort(url.searchParams.get("sort")),
    },
  });
  return NextResponse.json(
    { query: query ?? "", preset, projects },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=120" } },
  );
}
