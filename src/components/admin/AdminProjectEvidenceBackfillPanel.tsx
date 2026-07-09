"use client";

import { useCallback, useEffect, useState } from "react";
import { Code2, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

type EvidenceState = {
  missing: number;
};

type EvidenceResponse = EvidenceState & {
  processed?: number;
  failed?: number;
  failures?: { repo: string; error: string }[];
  error?: string;
};

export function AdminProjectEvidenceBackfillPanel() {
  const t = useTranslations("admin");
  const [batchSize, setBatchSize] = useState(8);
  const [state, setState] = useState<EvidenceState>({ missing: 0 });
  const [result, setResult] = useState<EvidenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/project-evidence/backfill", {
        cache: "no-store",
      });
      if (!res.ok) return;
      setState((await res.json()) as EvidenceState);
    } catch {
      // Keep the panel usable even if a polling read fails.
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

  async function run() {
    if (loading || state.missing <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/project-evidence/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize }),
      });
      const data = (await res.json()) as EvidenceResponse;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      setState({ missing: data.missing });
    } catch (e) {
      setError(e instanceof Error ? e.message : "evidence_backfill_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-zinc-100">{t("projectEvidenceBackfillTitle")}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
            {t("projectEvidenceBackfillBody")}
          </p>
          <div className="mt-3 inline-flex rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
            {t("projectEvidenceBackfillMissing", { count: state.missing })}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Input
            value={batchSize}
            onChange={(e) => setBatchSize(Math.max(1, Math.min(30, Number(e.target.value) || 8)))}
            type="number"
            min={1}
            max={30}
            aria-label={t("projectEvidenceBackfillBatch")}
            className="w-28 border-white/10 bg-black/20 text-zinc-100"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || state.missing <= 0}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Code2 className="h-4 w-4" />}
            {loading ? t("projectEvidenceBackfillRunning") : t("projectEvidenceBackfillRun")}
          </button>
          <button
            type="button"
            onClick={() => void loadState()}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.06]"
          >
            <RefreshCw className="h-4 w-4" />
            {t("projectEvidenceBackfillRefresh")}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-400/15 bg-red-400/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4">
          <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
            <span>{t("projectEvidenceBackfillProcessed", { count: result.processed ?? 0 })}</span>
            <span>{t("projectEvidenceBackfillFailed", { count: result.failed ?? 0 })}</span>
            <span>{t("projectEvidenceBackfillRemaining", { count: result.missing })}</span>
          </div>
          {(result.failures ?? []).length > 0 && (
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {result.failures!.slice(0, 8).map((failure) => (
                <div key={failure.repo} className="rounded-lg border border-red-400/15 bg-red-400/10 px-3 py-2 text-xs">
                  <div className="font-semibold text-red-100">{failure.repo}</div>
                  <div className="mt-1 text-red-300">{failure.error}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
