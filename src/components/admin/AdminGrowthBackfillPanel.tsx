"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, RefreshCw, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

type GrowthBackfillItem = {
  id: string;
  login: string;
  source: "subscription" | "qualified_score";
  status: "pending" | "running" | "done" | "failed" | "skipped";
  final_score: number | null;
  error: string | null;
  attempts: number;
};

type GrowthBackfillJob = {
  id: string;
  requested_by: string | null;
  scope: string;
  status: "pending" | "running" | "done" | "failed";
  batch_size: number;
  processed_count: number;
  failed_count: number;
  skipped_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  items: GrowthBackfillItem[];
};

type GrowthBackfillState = {
  jobs: GrowthBackfillJob[];
  candidates: number;
};

type GrowthBackfillResponse = {
  job?: GrowthBackfillJob;
  jobs?: GrowthBackfillJob[];
  candidates: number;
  background?: boolean;
  error?: string;
};

export function AdminGrowthBackfillPanel() {
  const t = useTranslations("admin");
  const [batchSize, setBatchSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [state, setState] = useState<GrowthBackfillState>({ jobs: [], candidates: 0 });
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/growth-backfill", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as GrowthBackfillState;
      setState(data);
    } catch {
      // Best-effort polling; action buttons stay usable.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (!cancelled) void loadState();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [loadState]);

  useEffect(() => {
    if (!state.jobs.some((job) => job.status === "pending" || job.status === "running")) {
      return;
    }
    const id = window.setInterval(() => {
      void loadState();
    }, 3000);
    return () => window.clearInterval(id);
  }, [state.jobs, loadState]);

  async function run(jobId?: string, retryFailures = false) {
    if (loading) return;
    setLoading(true);
    setLoadingJobId(jobId ?? null);
    setError(null);
    try {
      const res = await fetch("/api/admin/growth-backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, retryFailures, batchSize }),
      });
      const data = (await res.json()) as GrowthBackfillResponse;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadState();
    } catch (e) {
      setError(e instanceof Error ? e.message : "growth_backfill_failed");
    } finally {
      setLoading(false);
      setLoadingJobId(null);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-zinc-100">{t("growthBackfillTitle")}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
            {t("growthBackfillBody")}
          </p>
          <div className="mt-3 inline-flex rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
            {t("growthBackfillCandidates", { count: state.candidates })}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Input
            value={batchSize}
            onChange={(e) => setBatchSize(Math.max(1, Math.min(30, Number(e.target.value) || 10)))}
            type="number"
            min={1}
            max={30}
            aria-label={t("growthBackfillBatch")}
            className="w-28 border-white/10 bg-black/20 text-zinc-100"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || state.candidates <= 0}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-wait disabled:opacity-60"
          >
            {loading && !loadingJobId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {loading && !loadingJobId ? t("growthBackfillStarting") : t("growthBackfillRun")}
          </button>
          <button
            type="button"
            onClick={() => void loadState()}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.06]"
          >
            <RefreshCw className="h-4 w-4" />
            {t("growthBackfillRefresh")}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-400/15 bg-red-400/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {state.jobs.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">{t("growthBackfillNoJobs")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {state.jobs.map((job) => {
            const canResume = job.status !== "done";
            const canRetryFailures = job.failed_count > 0;
            return (
              <div key={job.id} className="rounded-xl border border-white/10 bg-black/10 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-zinc-400">
                        {job.id.slice(0, 8)}
                      </span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400">
                        {t(`growthBackfillStatus.${job.status}`)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                      <span>{t("growthBackfillProcessed", { count: job.processed_count })}</span>
                      <span>{t("growthBackfillFailed", { count: job.failed_count })}</span>
                      <span>{t("growthBackfillSkipped", { count: job.skipped_count })}</span>
                      <span>{t("growthBackfillBatchValue", { count: job.batch_size })}</span>
                    </div>
                    {job.last_error && (
                      <p className="mt-2 text-xs text-rose-300">{job.last_error}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {canResume && (
                      <button
                        type="button"
                        onClick={() => void run(job.id)}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:cursor-wait disabled:opacity-60"
                      >
                        {loadingJobId === job.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        {t("growthBackfillResume")}
                      </button>
                    )}
                    {canRetryFailures && (
                      <button
                        type="button"
                        onClick={() => void run(job.id, true)}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:cursor-wait disabled:opacity-60"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t("growthBackfillRetryFailures")}
                      </button>
                    )}
                  </div>
                </div>

                {job.items.length > 0 && (
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {job.items.slice(0, 8).map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-zinc-300">@{item.login}</span>
                          <span className="shrink-0 text-zinc-500">
                            {t(`growthBackfillItemStatus.${item.status}`)}
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
    </section>
  );
}
