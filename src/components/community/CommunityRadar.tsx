"use client";

import { useLocale, useTranslations } from "next-intl";
import { Radar, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { ByoKeyModal, loadByoKey, type ByoKeyConfig } from "@/components/ByoKeyModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CommunityWaterfallEntry } from "@/lib/db";
import {
  estimateDiscoverySearchTokens,
  type AiDiscoveryLlmMode,
} from "@/lib/discovery";
import type { Lang } from "@/lib/lang";
import { CommunityWaterfallCard } from "./CommunityWaterfallCard";
import {
  CommunityOrbitRadar,
  type CommunityOrbitSubject,
} from "./CommunityOrbitRadar";

interface CommunityRadarProps {
  initialEntries: CommunityWaterfallEntry[];
  lang: Lang;
  aiSearchMode: AiDiscoveryLlmMode;
  subject: CommunityOrbitSubject;
}

interface AiSearchResponse {
  mode: "ai" | "fallback";
  error?: string;
  estimatedTokens?: { min: number; max: number };
  summary?: string;
  entries: CommunityWaterfallEntry[];
}

const PAGE_SIZE = 6;

function sliceBatch(entries: CommunityWaterfallEntry[], batch: number) {
  if (entries.length <= PAGE_SIZE) return entries;
  const start = (batch * PAGE_SIZE) % entries.length;
  return [...entries, ...entries].slice(start, start + PAGE_SIZE);
}

export function CommunityRadar({
  initialEntries,
  lang,
  aiSearchMode,
  subject,
}: CommunityRadarProps) {
  const t = useTranslations("communityRadar");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState(0);
  const [aiEntries, setAiEntries] = useState<CommunityWaterfallEntry[] | null>(null);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [byoOpen, setByoOpen] = useState(false);

  const sourceEntries = aiEntries ?? initialEntries;
  const visibleEntries = useMemo(() => sliceBatch(sourceEntries, batch), [batch, sourceEntries]);
  const tokenEstimate = estimateDiscoverySearchTokens(query);
  const canShuffle = sourceEntries.length > PAGE_SIZE;
  const modeLabel = aiEntries ? t("aiMode") : t("publicMode");

  async function runAiMatch(savedByoKey?: ByoKeyConfig | null) {
    const trimmed = query.trim();
    if (!trimmed || loading) return;
    const byoKey = savedByoKey ?? loadByoKey();
    if (!byoKey && aiSearchMode !== "server") {
      setByoOpen(true);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/community/radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, lang: locale, byoKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | AiSearchResponse
        | { error?: string }
        | null;
      if (!res.ok) {
        const code = data?.error ?? `search_${res.status}`;
        if (code === "byo_required") setByoOpen(true);
        throw new Error(code);
      }
      const payload = data as AiSearchResponse;
      setAiEntries(payload.entries);
      setSummary(payload.summary ?? "");
      setBatch(0);
      setError(payload.error ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "match_failed");
    } finally {
      setLoading(false);
    }
  }

  function shuffle() {
    setBatch((prev) => prev + 1);
  }

  function resetAi() {
    setAiEntries(null);
    setSummary("");
    setError(null);
    setBatch(0);
  }

  return (
    <section className="mb-8 rounded-2xl border border-cyan-300/20 bg-cyan-500/[0.035] p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 lg:max-w-md">
          <div className="flex items-center gap-2 text-cyan-200">
            <Radar className="h-5 w-5" />
            <h2 className="text-base font-bold">{t("title")}</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{t("subtitle")}</p>
          <div className="mt-3 inline-flex rounded-full border border-cyan-300/15 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-200">
            {modeLabel}
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 lg:max-w-xl">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runAiMatch();
              }}
              placeholder={t("placeholder")}
              className="min-w-0"
            />
            <Button
              type="button"
              onClick={() => void runAiMatch()}
              disabled={!query.trim() || loading}
              className="shrink-0 bg-cyan-500 text-white hover:bg-cyan-600"
            >
              <Sparkles className="h-4 w-4" />
              {loading ? t("matching") : t("aiMatch")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={shuffle}
              disabled={!canShuffle}
              className="shrink-0"
            >
              <RefreshCw className="h-4 w-4" />
              {t("shuffle")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{t("tokenEstimate", tokenEstimate)}</span>
            {aiEntries && (
              <button
                type="button"
                onClick={resetAi}
                className="text-cyan-300 underline-offset-2 hover:underline"
              >
                {t("reset")}
              </button>
            )}
          </div>
          {summary && <p className="text-sm text-cyan-100/80">{summary}</p>}
          {error && <p className="text-sm text-orange-300">{t("fallback")}</p>}
        </div>
      </div>

      {visibleEntries.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <>
          <CommunityOrbitRadar subject={subject} entries={visibleEntries} />
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleEntries.map((entry) => (
              <CommunityWaterfallCard key={entry.login} entry={entry} lang={lang} />
            ))}
          </div>
        </>
      )}

      <ByoKeyModal
        open={byoOpen}
        onClose={() => setByoOpen(false)}
        onSave={(cfg) => {
          setByoOpen(false);
          void runAiMatch(cfg);
        }}
      />
    </section>
  );
}
