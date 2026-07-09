"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PendingLink } from "@/components/PendingLink";
import { Link } from "@/i18n/navigation";
import type {
  ProjectCircleListItem,
  ProjectCircleListPreset,
  ProjectCircleListSort,
  ProjectEvidenceScope,
} from "@/lib/db";
import type { Lang } from "@/lib/lang";
import type { ProjectBand, ProjectSafetyLevel } from "@/lib/project-scan";

const PAGE_SIZE = 24;

interface ProjectReadingWaterfallProps {
  initialProjects: ProjectCircleListItem[];
  initialNextOffset: number | null;
  lang: Lang;
  query: string;
  preset: ProjectCircleListPreset;
  filters: {
    language: string;
    band: ProjectBand | null;
    safety: ProjectSafetyLevel | null;
    minScore: string;
    minStars: string;
    aiSummary: boolean;
    sort: ProjectCircleListSort;
    evidence: ProjectEvidenceScope[];
  };
}

interface ProjectsResponse {
  projects: ProjectCircleListItem[];
  nextOffset: number | null;
  hasMore: boolean;
  error?: string;
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

function buildRequestUrl(input: Omit<ProjectReadingWaterfallProps, "initialProjects" | "initialNextOffset" | "lang"> & {
  offset: number;
}) {
  const params = new URLSearchParams({
    preset: input.preset,
    limit: String(PAGE_SIZE),
    offset: String(input.offset),
  });
  if (input.query.trim()) params.set("q", input.query.trim());
  if (input.filters.language.trim()) params.set("language", input.filters.language.trim());
  if (input.filters.band) params.set("band", input.filters.band);
  if (input.filters.safety) params.set("safety", input.filters.safety);
  if (input.filters.minScore.trim()) params.set("minScore", input.filters.minScore.trim());
  if (input.filters.minStars.trim()) params.set("minStars", input.filters.minStars.trim());
  if (input.filters.aiSummary) params.set("aiSummary", "1");
  if (input.filters.sort !== "relevance") params.set("sort", input.filters.sort);
  for (const scope of input.filters.evidence) params.append("evidence", scope);
  return `/api/community/projects?${params.toString()}`;
}

function ProjectWaterfallCard({
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
    <article className="mb-3 break-inside-avoid rounded-lg border border-white/10 bg-slate-950/78 p-4 shadow-[0_18px_46px_rgba(0,0,0,0.18)] [contain-intrinsic-size:360px] [content-visibility:auto] transition-colors hover:border-cyan-200/30 hover:bg-cyan-300/[0.06]">
      <div className="flex items-start justify-between gap-3">
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
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-zinc-400">
          <div className="font-black text-zinc-200">{Math.round(item.score)}</div>
          <div>{item.stars} stars</div>
        </div>
      </div>

      {item.topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.topics.slice(0, 7).map((topic) => (
            <span key={topic} className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-zinc-400">
              {topic}
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-sm leading-6 text-zinc-200">{summary}</p>
      {(target || useCase) && (
        <div className="mt-3 grid gap-2 text-xs leading-5 text-zinc-400">
          {target && <p>{target}</p>}
          {useCase && <p>{useCase}</p>}
        </div>
      )}
      {(safety || roast) && (
        <div className="mt-3 grid gap-2 text-xs leading-5 text-zinc-500">
          {safety && <p>{safety}</p>}
          {roast && <p>{roast}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PendingLink
          href={`/community/${encodeURIComponent(item.domain_slug)}`}
          pendingClassName="pointer-events-none border-cyan-200/45 bg-cyan-300/15 opacity-80"
          className="rounded-full border border-cyan-200/20 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10"
        >
          Circle
        </PendingLink>
        <a
          href={item.html_url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-300 hover:bg-white/10"
        >
          GitHub
        </a>
        {item.contributors.slice(0, 3).map((contributor) => (
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

const MemoProjectWaterfallCard = memo(ProjectWaterfallCard);

export function ProjectReadingWaterfall({
  initialProjects,
  initialNextOffset,
  lang,
  query,
  preset,
  filters,
}: ProjectReadingWaterfallProps) {
  const t = useTranslations("communityProjectsList");
  const [projects, setProjects] = useState(initialProjects);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = nextOffset !== null;
  const requestBase = useMemo(
    () => ({ query, preset, filters }),
    [query, preset, filters],
  );

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setLoading(true);
        setError(false);
        fetch(buildRequestUrl({ ...requestBase, offset: nextOffset ?? 0 }), {
          cache: "no-store",
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<ProjectsResponse>;
          })
          .then((data) => {
            setProjects((current) => {
              const seen = new Set(current.map((project) => project.full_name));
              const next = [...current];
              for (const project of data.projects ?? []) {
                if (seen.has(project.full_name)) continue;
                seen.add(project.full_name);
                next.push(project);
              }
              return next;
            });
            setNextOffset(data.hasMore ? data.nextOffset : null);
          })
          .catch(() => {
            setError(true);
          })
          .finally(() => setLoading(false));
      },
      { rootMargin: "640px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, nextOffset, requestBase]);

  if (projects.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-500">
        {t("empty")}
      </p>
    );
  }

  return (
    <section className="mt-6">
      <div className="columns-1 gap-3 md:columns-2 xl:columns-3">
        {projects.map((project) => (
          <MemoProjectWaterfallCard key={project.full_name} item={project} lang={lang} />
        ))}
      </div>
      <div ref={sentinelRef} className="flex min-h-20 items-center justify-center py-6">
        {loading ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-200/15 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t("loadingMore")}
          </span>
        ) : error ? (
          <button
            type="button"
            onClick={() => {
              setError(false);
              setNextOffset((current) => current ?? projects.length);
            }}
            className="rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/15"
          >
            {t("loadMoreError")}
          </button>
        ) : hasMore ? (
          <span className="text-xs text-zinc-500">{t("scrollHint")}</span>
        ) : (
          <span className="text-xs text-zinc-500">{t("end")}</span>
        )}
      </div>
    </section>
  );
}
