"use client";

import { useEffect, useState } from "react";
import { Loader2, Play, RotateCcw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

type ScanProjectSummary = {
  full_name: string;
  registry_full_name: string | null;
  source_url: string | null;
  href: string;
  score: number;
  band: string;
  stars: number;
  safety: { level: string; notes: { zh: string[]; en: string[] } };
  contributors: { login: string }[];
  roast_line: { zh: string; en: string };
};

type ScanResponse = {
  job: OrgScanJob;
  jobId: string;
  org: string;
  page: number;
  batchSize: number;
  nextPage: number | null;
  listed: number;
  skippedByStars: number;
  scanned: number;
  failed: number;
  written: number;
  projects: ScanProjectSummary[];
  failures: { repo: string; error: string }[];
  error?: string;
};

type OrgScanJobItem = {
  id: string;
  registry_full_name: string;
  source_full_name: string | null;
  status: "done" | "failed" | "skipped";
  score: number | null;
  band: string | null;
  safety_level: string | null;
  error: string | null;
  attempts: number;
  updated_at: number;
};

type OrgScanJob = {
  id: string;
  org_login: string;
  requested_by: string | null;
  status: "pending" | "running" | "paused" | "done" | "failed";
  next_page: number;
  batch_size: number;
  min_stars: number;
  include_forks: boolean;
  include_archived: boolean;
  scanned_count: number;
  failed_count: number;
  skipped_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  items: OrgScanJobItem[];
};

export function AdminOrgProjectScanPanel() {
  const t = useTranslations("admin");
  const [org, setOrg] = useState("https://github.com/Xposed-Modules-Repo");
  const [page, setPage] = useState(1);
  const [batchSize, setBatchSize] = useState(15);
  const [minStars, setMinStars] = useState(0);
  const [includeForks, setIncludeForks] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [jobs, setJobs] = useState<OrgScanJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadJobs() {
    try {
      const res = await fetch("/api/admin/organizations/scan-projects", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: OrgScanJob[] };
      setJobs(data.jobs);
    } catch {
      // The panel itself remains usable; failed polling should not block scans.
    }
  }

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      fetch("/api/admin/organizations/scan-projects", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ jobs: OrgScanJob[] }>) : null))
        .then((data) => {
          if (!cancelled && data) setJobs(data.jobs);
        })
        .catch(() => {});
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  async function run(options: {
    nextPage?: number | null;
    jobId?: string;
    retryFailures?: boolean;
  } = {}) {
    const targetOrg = org.trim();
    if ((!targetOrg && !options.jobId) || loading) return;
    setLoading(true);
    setLoadingJobId(options.jobId ?? null);
    setError(null);
    try {
      const res = await fetch("/api/admin/organizations/scan-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: options.jobId,
          retryFailures: options.retryFailures,
          org: options.jobId ? undefined : targetOrg,
          page: options.nextPage ?? page,
          batchSize,
          minStars,
          includeForks,
          includeArchived,
        }),
      });
      const data = (await res.json()) as ScanResponse;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      setPage(data.nextPage ?? data.page);
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan_failed");
    } finally {
      setLoading(false);
      setLoadingJobId(null);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-zinc-100">{t("orgScanTitle")}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
            {t("orgScanBody")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading || !org.trim()}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {loading && !loadingJobId ? t("orgScanRunning") : t("orgScanRun")}
        </button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem]">
        <Input
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          placeholder="https://github.com/Xposed-Modules-Repo"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="border-white/10 bg-black/20 text-zinc-100"
        />
        <Input
          value={page}
          onChange={(e) => setPage(Math.max(1, Number(e.target.value) || 1))}
          type="number"
          min={1}
          aria-label={t("orgScanPage")}
          className="border-white/10 bg-black/20 text-zinc-100"
        />
        <Input
          value={batchSize}
          onChange={(e) => setBatchSize(Math.max(1, Math.min(30, Number(e.target.value) || 15)))}
          type="number"
          min={1}
          max={30}
          aria-label={t("orgScanBatch")}
          className="border-white/10 bg-black/20 text-zinc-100"
        />
        <Input
          value={minStars}
          onChange={(e) => setMinStars(Math.max(0, Number(e.target.value) || 0))}
          type="number"
          min={0}
          aria-label={t("orgScanMinStars")}
          className="border-white/10 bg-black/20 text-zinc-100"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeForks}
            onChange={(e) => setIncludeForks(e.target.checked)}
          />
          {t("orgScanIncludeForks")}
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          {t("orgScanIncludeArchived")}
        </label>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-400/15 bg-red-400/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>@{result.org}</span>
            <span>{t("orgScanResultPage", { page: result.page })}</span>
            <span>{t("orgScanResultScanned", { count: result.scanned })}</span>
            <span>{t("orgScanResultFailed", { count: result.failed })}</span>
            <span>{t("orgScanResultSkipped", { count: result.skippedByStars })}</span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {result.projects.map((project) => (
              <a
                key={project.full_name}
                href={project.href}
                className="rounded-xl border border-white/10 bg-black/10 p-4 transition hover:border-cyan-300/30 hover:bg-cyan-300/5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-zinc-100">
                      {project.full_name}
                    </div>
                    {project.registry_full_name && (
                      <div className="mt-1 truncate text-[11px] text-cyan-200/70">
                        {t("orgScanResolvedFrom", { repo: project.registry_full_name })}
                      </div>
                    )}
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">
                      {project.roast_line.zh || project.roast_line.en}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-black text-cyan-100">{project.band}</div>
                    <div className="text-xs text-zinc-500">{project.score.toFixed(0)}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span>★ {project.stars.toLocaleString()}</span>
                  <span>{t("orgScanSafety", { level: project.safety.level })}</span>
                  <span>
                    {project.contributors.slice(0, 3).map((c) => `@${c.login}`).join(" ")}
                  </span>
                </div>
              </a>
            ))}
          </div>

          {result.nextPage && (
            <button
              type="button"
              onClick={() => void run({ jobId: result.jobId, nextPage: result.nextPage })}
              disabled={loading}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/[0.06] disabled:cursor-wait disabled:opacity-60"
            >
              <Search className="h-4 w-4" />
              {t("orgScanNext", { page: result.nextPage })}
            </button>
          )}
        </div>
      )}

      <div className="mt-6 border-t border-white/10 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-zinc-100">{t("orgScanJobsTitle")}</h3>
          <button
            type="button"
            onClick={() => void loadJobs()}
            className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-300 hover:bg-white/[0.06]"
          >
            {t("orgScanRefreshJobs")}
          </button>
        </div>

        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("orgScanNoJobs")}</p>
        ) : (
          <div className="mt-3 space-y-3">
            {jobs.map((job) => {
              const canContinue = job.status !== "done";
              const canRetryFailures = job.failed_count > 0;
              return (
                <div key={job.id} className="rounded-xl border border-white/10 bg-black/10 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-zinc-100">@{job.org_login}</span>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400">
                          {t(`orgScanJobStatus.${job.status}`)}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {t("orgScanJobNextPage", { page: job.next_page })}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                        <span>{t("orgScanJobScanned", { count: job.scanned_count })}</span>
                        <span>{t("orgScanJobFailed", { count: job.failed_count })}</span>
                        <span>{t("orgScanJobSkipped", { count: job.skipped_count })}</span>
                        <span>{t("orgScanJobBatch", { count: job.batch_size })}</span>
                      </div>
                      {job.last_error && (
                        <p className="mt-2 text-xs text-rose-300">{job.last_error}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {canContinue && (
                        <button
                          type="button"
                          onClick={() => void run({ jobId: job.id })}
                          disabled={loading}
                          className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          {loadingJobId === job.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          {t("orgScanContinueJob")}
                        </button>
                      )}
                      {canRetryFailures && (
                        <button
                          type="button"
                          onClick={() => void run({ jobId: job.id, retryFailures: true })}
                          disabled={loading}
                          className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t("orgScanRetryFailures")}
                        </button>
                      )}
                    </div>
                  </div>

                  {job.items.length > 0 && (
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {job.items.slice(0, 6).map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-zinc-300">
                              {item.source_full_name ?? item.registry_full_name}
                            </span>
                            <span className="shrink-0 text-zinc-500">
                              {t(`orgScanItemStatus.${item.status}`)}
                            </span>
                          </div>
                          {item.error && (
                            <div className="mt-1 truncate text-rose-300">{item.error}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
