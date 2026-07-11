import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Search } from "lucide-react";
import { ProjectReadingWaterfall } from "@/components/community/ProjectReadingWaterfall";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  listProjectCircleItems,
  type ProjectEvidenceScope,
  type ProjectCircleListPreset,
  type ProjectCircleListSort,
} from "@/lib/db";
import { normLang } from "@/lib/lang";
import type { ProjectBand, ProjectSafetyLevel } from "@/lib/project-scan";
import { localeAlternates } from "@/lib/site";

export const dynamic = "force-dynamic";

const PRESETS: ProjectCircleListPreset[] = ["xposed", "ai", "security", "devtools", "all"];
const SORTS: ProjectCircleListSort[] = ["relevance", "score", "stars", "recent"];
const EVIDENCE_SCOPES: ProjectEvidenceScope[] = ["readme", "commits", "source"];
const BANDS: ProjectBand[] = ["S+", "S", "A+", "A", "B+", "B", "C+", "C"];
const SAFETY_LEVELS: ProjectSafetyLevel[] = ["A", "B", "C", "D"];
const PAGE_SIZE = 24;

function parsePreset(raw: string | string[] | undefined): ProjectCircleListPreset {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PRESETS.includes(value as ProjectCircleListPreset)
    ? (value as ProjectCircleListPreset)
    : "xposed";
}

function firstParam(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
}

function parseSort(raw: string | string[] | undefined): ProjectCircleListSort {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return SORTS.includes(value as ProjectCircleListSort)
    ? (value as ProjectCircleListSort)
    : "relevance";
}

function parseBand(raw: string | string[] | undefined): ProjectBand | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return BANDS.includes(value as ProjectBand) ? (value as ProjectBand) : null;
}

function parseSafety(raw: string | string[] | undefined): ProjectSafetyLevel | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return SAFETY_LEVELS.includes(value as ProjectSafetyLevel)
    ? (value as ProjectSafetyLevel)
    : null;
}

function parseNumberParam(raw: string | string[] | undefined): number | null {
  const value = firstParam(raw);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEvidence(raw: string | string[] | undefined): ProjectEvidenceScope[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const scopes = values.filter((value): value is ProjectEvidenceScope =>
    EVIDENCE_SCOPES.includes(value as ProjectEvidenceScope),
  );
  return scopes.length > 0 ? [...new Set(scopes)] : ["readme"];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "communityProjectsList" });
  const meta = await getTranslations({ locale, namespace: "meta" });
  return {
    title: `${t("heading")} · ${meta("siteName")}`,
    description: t("subtitle"),
    alternates: localeAlternates(locale, "/community/projects"),
  };
}

function hrefFor(
  preset: ProjectCircleListPreset,
  filters: {
    q?: string;
    language?: string;
    band?: string | null;
    safety?: string | null;
    minScore?: string;
    minStars?: string;
    aiSummary?: boolean;
    sort?: ProjectCircleListSort;
    evidence?: ProjectEvidenceScope[];
  } = {},
) {
  const query = new URLSearchParams({ preset });
  if (filters.q?.trim()) query.set("q", filters.q.trim());
  if (filters.language?.trim()) query.set("language", filters.language.trim());
  if (filters.band) query.set("band", filters.band);
  if (filters.safety) query.set("safety", filters.safety);
  if (filters.minScore?.trim()) query.set("minScore", filters.minScore.trim());
  if (filters.minStars?.trim()) query.set("minStars", filters.minStars.trim());
  if (filters.aiSummary) query.set("aiSummary", "1");
  if (filters.sort && filters.sort !== "relevance") query.set("sort", filters.sort);
  for (const scope of filters.evidence ?? ["readme"]) query.append("evidence", scope);
  return `/community/projects?${query.toString()}`;
}

export default async function CommunityProjectsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const queryParams = await searchParams;
  setRequestLocale(locale);
  const lang = normLang(locale);
  const t = await getTranslations("communityProjectsList");
  const preset = parsePreset(queryParams.preset);
  const q = firstParam(queryParams.q);
  const language = firstParam(queryParams.language);
  const band = parseBand(queryParams.band);
  const safety = parseSafety(queryParams.safety);
  const minScore = parseNumberParam(queryParams.minScore);
  const minStars = parseNumberParam(queryParams.minStars);
  const aiSummary = firstParam(queryParams.aiSummary) === "1";
  const sort = parseSort(queryParams.sort);
  const evidence = parseEvidence(queryParams.evidence);
  const projects = await listProjectCircleItems({
    preset,
    query: q,
    limit: PAGE_SIZE,
    filters: {
      language,
      band,
      safetyLevel: safety,
      minScore,
      minStars,
      hasAiSummary: aiSummary,
      sort,
      evidence,
    },
  });
  const presetHrefFilters = {
    q,
    language,
    band,
    safety,
    minScore: firstParam(queryParams.minScore),
    minStars: firstParam(queryParams.minStars),
    aiSummary,
    sort,
    evidence,
  };
  const waterfallKey = JSON.stringify({
    preset,
    q,
    language,
    band,
    safety,
    minScore: firstParam(queryParams.minScore),
    minStars: firstParam(queryParams.minStars),
    aiSummary,
    sort,
    evidence,
  });

  return (
    <main data-force-dark className="relative min-h-screen w-full overflow-x-hidden bg-[#020617]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_78%_14%,rgba(168,85,247,0.12),transparent_26%),linear-gradient(to_bottom,rgba(2,6,23,0.18),rgba(2,6,23,0.9)_72%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:56px_56px]" />
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <Link
            href="/community"
            className="inline-flex rounded-full border border-cyan-200/15 bg-slate-950/40 px-3 py-1 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/10"
          >
            {t("back")}
          </Link>
        </div>

        <header className="max-w-3xl">
          <h1 className="text-3xl font-black tracking-normal text-zinc-100 sm:text-4xl">
            {t("heading")}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{t("subtitle")}</p>
        </header>

        <section className="mt-6 rounded-lg border border-white/10 bg-slate-950/80 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((value) => (
              <Link
                key={value}
                href={hrefFor(value, presetHrefFilters)}
                className={
                  value === preset
                    ? "rounded-full bg-cyan-300 px-3 py-1.5 text-sm font-bold text-slate-950"
                    : "rounded-full border border-white/10 px-3 py-1.5 text-sm font-semibold text-zinc-300 hover:bg-white/10"
                }
              >
                {t(`presets.${value}`)}
              </Link>
            ))}
          </div>
          <form method="get" className="mt-4 grid gap-3">
            <input type="hidden" name="preset" value={preset} />
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                name="q"
                defaultValue={q}
                placeholder={t("placeholder")}
                className="border-cyan-200/15 bg-white/[0.07] text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-300/70 focus-visible:ring-cyan-300/20"
              />
              <div className="flex gap-2">
                <Button type="submit" className="shrink-0 bg-cyan-300 text-slate-950 hover:bg-cyan-200">
                  <Search className="h-4 w-4" />
                  {t("search")}
                </Button>
                <Link
                  href="/community/projects?preset=xposed"
                  className="inline-flex h-10 items-center rounded-lg border border-white/10 px-3 text-sm font-semibold text-zinc-300 hover:bg-white/10"
                >
                  {t("reset")}
                </Link>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-xs font-semibold text-zinc-500">
                {t("filters.language")}
                <Input
                  name="language"
                  defaultValue={language}
                  placeholder="Kotlin / Java / TypeScript"
                  className="border-white/10 bg-white/[0.06] text-sm text-zinc-100 placeholder:text-zinc-600"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-500">
                {t("filters.band")}
                <select
                  name="band"
                  defaultValue={band ?? ""}
                  className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-300/70"
                >
                  <option value="">{t("filters.any")}</option>
                  {BANDS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-500">
                {t("filters.safety")}
                <select
                  name="safety"
                  defaultValue={safety ?? ""}
                  className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-300/70"
                >
                  <option value="">{t("filters.any")}</option>
                  {SAFETY_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-500">
                {t("filters.sort")}
                <select
                  name="sort"
                  defaultValue={sort}
                  className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-300/70"
                >
                  {SORTS.map((value) => (
                    <option key={value} value={value}>
                      {t(`sorts.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-500">
                {t("filters.minScore")}
                <Input
                  name="minScore"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={firstParam(queryParams.minScore)}
                  className="border-white/10 bg-white/[0.06] text-sm text-zinc-100"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-500">
                {t("filters.minStars")}
                <Input
                  name="minStars"
                  type="number"
                  min={0}
                  defaultValue={firstParam(queryParams.minStars)}
                  className="border-white/10 bg-white/[0.06] text-sm text-zinc-100"
                />
              </label>
              <label className="flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-zinc-300 sm:mt-5">
                <input
                  type="checkbox"
                  name="aiSummary"
                  value="1"
                  defaultChecked={aiSummary}
                  className="h-4 w-4 accent-cyan-300"
                />
                {t("filters.aiSummary")}
              </label>
              <fieldset className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-zinc-300 lg:col-span-2">
                <legend className="px-1 text-xs text-zinc-500">{t("filters.evidence")}</legend>
                <div className="flex flex-wrap gap-2">
                  {EVIDENCE_SCOPES.map((scope) => (
                    <label key={scope} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs">
                      <input
                        type="checkbox"
                        name="evidence"
                        value={scope}
                        defaultChecked={evidence.includes(scope)}
                        className="h-3.5 w-3.5 accent-cyan-300"
                      />
                      {t(`evidence.${scope}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex min-h-10 items-center text-xs text-zinc-500 sm:mt-5">
                {t("resultCount", { count: projects.length })}
              </div>
            </div>
          </form>
        </section>

        <ProjectReadingWaterfall
          key={waterfallKey}
          initialProjects={projects}
          initialNextOffset={projects.length >= PAGE_SIZE ? projects.length : null}
          lang={lang}
          query={q}
          preset={preset}
          filters={{
            language,
            band,
            safety,
            minScore: firstParam(queryParams.minScore),
            minStars: firstParam(queryParams.minStars),
            aiSummary,
            sort,
            evidence,
          }}
        />
      </div>
    </main>
  );
}
