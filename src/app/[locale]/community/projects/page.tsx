import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Search } from "lucide-react";
import { CommunityGalaxyBackdrop } from "@/components/community/CommunityGalaxyBackdrop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  listProjectCircleItems,
  type ProjectCircleListItem,
  type ProjectCircleListPreset,
  type ProjectCircleListSort,
} from "@/lib/db";
import { normLang, type Lang } from "@/lib/lang";
import type { ProjectBand, ProjectSafetyLevel } from "@/lib/project-scan";
import { localeAlternates } from "@/lib/site";

export const dynamic = "force-dynamic";

const PRESETS: ProjectCircleListPreset[] = ["xposed", "ai", "security", "devtools", "all"];
const SORTS: ProjectCircleListSort[] = ["relevance", "score", "stars", "recent"];
const BANDS: ProjectBand[] = ["S+", "S", "A+", "A", "B+", "B", "C+", "C"];
const SAFETY_LEVELS: ProjectSafetyLevel[] = ["A", "B", "C", "D"];

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
  return `/community/projects?${query.toString()}`;
}

function textFor(
  item: ProjectCircleListItem,
  lang: Lang,
  field: "summary" | "target" | "use_case" | "safety" | "roast",
): string {
  const summary = item.ai_summary;
  if (!summary) {
    if (field === "roast") return lang === "en" ? item.roast_line.en : item.roast_line.zh;
    return item.description ?? "";
  }
  return lang === "en" ? summary.en[field] || summary.zh[field] : summary.zh[field] || summary.en[field];
}

function ProjectListRow({
  item,
  lang,
}: {
  item: ProjectCircleListItem;
  lang: Lang;
}) {
  const summary = textFor(item, lang, "summary");
  const target = textFor(item, lang, "target");
  const useCase = textFor(item, lang, "use_case");
  const safety = textFor(item, lang, "safety");
  const roast = textFor(item, lang, "roast");

  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.045] p-4 backdrop-blur-md transition hover:border-cyan-200/30 hover:bg-cyan-300/[0.06]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href={`/projects/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.repo)}`}
            className="text-base font-black text-zinc-100 underline-offset-4 hover:text-cyan-100 hover:underline"
          >
            {item.full_name}
          </Link>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-cyan-300/12 px-2 py-0.5 text-xs font-bold text-cyan-100">
              {item.band}
            </span>
            {item.safety_level && (
              <span className="rounded-full bg-emerald-300/12 px-2 py-0.5 text-xs font-bold text-emerald-100">
                Safety {item.safety_level}
              </span>
            )}
            {item.language && (
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-zinc-300">
                {item.language}
              </span>
            )}
            {item.topics.slice(0, 5).map((topic) => (
              <span key={topic} className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-zinc-400">
                {topic}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-3 text-xs text-zinc-400 sm:text-right">
          <span>{Math.round(item.score)} pts</span>
          <span>{item.stars} stars</span>
          <span>{item.forks} forks</span>
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-zinc-200">{summary}</p>
      {(target || useCase) && (
        <div className="mt-3 grid gap-2 text-xs leading-5 text-zinc-400 md:grid-cols-2">
          {target && <p>{target}</p>}
          {useCase && <p>{useCase}</p>}
        </div>
      )}
      {(safety || roast) && (
        <div className="mt-3 grid gap-2 text-xs leading-5 text-zinc-500 md:grid-cols-2">
          {safety && <p>{safety}</p>}
          {roast && <p>{roast}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/community/${encodeURIComponent(item.domain_slug)}`}
          className="rounded-full border border-cyan-200/20 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10"
        >
          Circle
        </Link>
        <a
          href={item.html_url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-300 hover:bg-white/10"
        >
          GitHub
        </a>
        {item.contributors.slice(0, 4).map((contributor) => (
          <Link
            key={contributor.login}
            href={`/u/${contributor.login}`}
            className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-100"
          >
            @{contributor.login}
          </Link>
        ))}
      </div>
    </article>
  );
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
  const projects = await listProjectCircleItems({
    preset,
    query: q,
    limit: 60,
    filters: {
      language,
      band,
      safetyLevel: safety,
      minScore,
      minStars,
      hasAiSummary: aiSummary,
      sort,
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
  };

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#020617]">
      <CommunityGalaxyBackdrop />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.18),rgba(2,6,23,0.82)_72%)]" />
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

        <section className="mt-6 rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
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
              <div className="flex min-h-10 items-center text-xs text-zinc-500 sm:mt-5">
                {t("resultCount", { count: projects.length })}
              </div>
            </div>
          </form>
        </section>

        <section className="mt-6 space-y-3">
          {projects.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-500">
              {t("empty")}
            </p>
          ) : (
            projects.map((project) => (
              <ProjectListRow key={project.full_name} item={project} lang={lang} />
            ))
          )}
        </section>
      </div>
    </main>
  );
}
