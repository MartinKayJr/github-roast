"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

type BackfillJob = {
  id: string;
  requested_by: string | null;
  status: "pending" | "running" | "done" | "failed";
  batch_size: number;
  processed_count: number;
  failed_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type BackfillState = {
  jobs: BackfillJob[];
  missing: number;
};

type BackfillResponse = {
  job?: BackfillJob;
  jobs?: BackfillJob[];
  missing: number;
  background?: boolean;
  error?: string;
};

export function AdminProjectAiSummaryBackfillPanel() {
  const t = useTranslations("admin");
  const [batchSize, setBatchSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [state, setState] = useState<BackfillState>({ jobs: [], missing: 0 });
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/project-ai-summaries/backfill", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as BackfillState;
      setState(data);
    } catch {
      // Polling is best-effort; the action button remains usable.
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

  async function run(jobId?: string) {
    if (loading) return;
    setLoading(true);
    setLoadingJobId(jobId ?? null);
    setError(null);
    try {
      const res = await fetch("/api/admin/project-ai-summaries/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, batchSize }),
      });
      const data = (await res.json()) as BackfillResponse;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadState();
    } catch (e) {
      setError(e instanceof Error ? e.message : "backfill_failed");
    } finally {
      setLoading(false);
      setLoadingJobId(null);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-zinc-100">{t("projectAiBackfillTitle")}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
            {t("projectAiBackfillBody")}
          </p>
          <div className="mt-3 inline-flex rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
            {t("projectAiBackfillMissing", { count: state.missing })}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Input
            value={batchSize}
            onChange={(e) => setBatchSize(Math.max(1, Math.min(30, Number(e.target.value) || 10)))}
            type="number"
            min={1}
            max={30}
            aria-label={t("projectAiBackfillBatch")}
            className="w-28 border-white/10 bg-black/20 text-zinc-100"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || state.missing <= 0}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-wait disabled:opacity-60"
          >
            {loading && !loadingJobId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {loading && !loadingJobId ? t("projectAiBackfillStarting") : t("projectAiBackfillRun")}
          </button>
          <button
            type="button"
            onClick={() => void loadState()}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.06]"
          >
            <RefreshCw className="h-4 w-4" />
            {t("projectAiBackfillRefresh")}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-400/15 bg-red-400/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {state.jobs.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">{t("projectAiBackfillNoJobs")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {state.jobs.map((job) => {
            const canResume = job.status !== "done";
            return (
              <div key={job.id} className="rounded-xl border border-white/10 bg-black/10 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-zinc-400">
                        {job.id.slice(0, 8)}
                      </span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400">
                        {t(`projectAiBackfillStatus.${job.status}`)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                      <span>{t("projectAiBackfillProcessed", { count: job.processed_count })}</span>
                      <span>{t("projectAiBackfillFailed", { count: job.failed_count })}</span>
                      <span>{t("projectAiBackfillBatchValue", { count: job.batch_size })}</span>
                    </div>
                    {job.last_error && (
                      <p className="mt-2 text-xs text-rose-300">{job.last_error}</p>
                    )}
                  </div>
                  {canResume && (
                    <button
                      type="button"
                      onClick={() => void run(job.id)}
                      disabled={loading}
                      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:cursor-wait disabled:opacity-60"
                    >
                      {loadingJobId === job.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {t("projectAiBackfillResume")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
