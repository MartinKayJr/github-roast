"use client";

import { BookOpen, LoaderCircle, Search, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ByoKeyModal, loadByoKey, type ByoKeyConfig } from "@/components/ByoKeyModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  estimateDiscoverySearchTokens,
  type AiDiscoveryLlmMode,
} from "@/lib/discovery";
import type { CircleDomain } from "@/lib/db";
import type { Lang } from "@/lib/lang";

interface CommunityProjectSearchDockProps {
  aiSearchMode: AiDiscoveryLlmMode;
  lang: Lang;
}

interface ProjectSearchResponse {
  mode: "ai" | "fallback";
  error?: string;
  estimatedTokens?: { min: number; max: number };
  summary?: string;
  domains: CircleDomain[];
}

function domainName(domain: CircleDomain, lang: Lang): string {
  return lang === "en" ? domain.name.en || domain.name.zh : domain.name.zh;
}

function domainDescription(domain: CircleDomain, lang: Lang): string {
  if (!domain.description) return "";
  return lang === "en"
    ? domain.description.en || domain.description.zh
    : domain.description.zh || domain.description.en;
}

export function CommunityProjectSearchDock({
  aiSearchMode,
  lang,
}: CommunityProjectSearchDockProps) {
  const t = useTranslations("communityProjectSearch");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProjectSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [byoOpen, setByoOpen] = useState(false);
  const tokenEstimate = estimateDiscoverySearchTokens(query, 180);

  async function runSearch(savedByoKey?: ByoKeyConfig | null) {
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
      const res = await fetch("/api/community/projects/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, lang: locale, byoKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | ProjectSearchResponse
        | { error?: string }
        | null;
      if (!res.ok) {
        const code = data?.error ?? `search_${res.status}`;
        if (code === "byo_required") setByoOpen(true);
        throw new Error(code);
      }
      setResult(data as ProjectSearchResponse);
      setError((data as ProjectSearchResponse).error ?? null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "search_failed");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
        <div className="flex max-w-full items-center gap-2">
        <Button
          type="button"
          onClick={() => setOpen(true)}
          shape="pill"
          className="h-11 border border-cyan-200/25 bg-cyan-300 text-slate-950 shadow-[0_0_34px_rgba(34,211,238,0.32)] hover:bg-cyan-200"
        >
          <Search className="h-4 w-4" />
          {t("open")}
        </Button>
          <Link
            href="/community/projects?preset=xposed"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-cyan-200/20 bg-slate-950/78 px-4 text-sm font-semibold text-cyan-100 shadow-[0_0_26px_rgba(34,211,238,0.18)] backdrop-blur-xl transition hover:border-cyan-200/35 hover:bg-cyan-300/10"
          >
            <BookOpen className="h-4 w-4" />
            {t("readMode")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 px-3 sm:bottom-6">
      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-cyan-200/20 bg-slate-950/88 shadow-[0_0_46px_rgba(34,211,238,0.22)] backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3 sm:px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-300 text-slate-950">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold text-zinc-100">{t("title")}</h2>
            <p className="truncate text-xs text-zinc-500">{t("subtitle")}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label={t("close")}
            className="text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim()) {
                  setResult(null);
                  setError(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
              placeholder={t("placeholder")}
              className="min-w-0 border-cyan-200/15 bg-white/[0.07] text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-300/70 focus-visible:ring-cyan-300/20"
            />
            <Button
              type="button"
              onClick={() => void runSearch()}
              disabled={!query.trim() || loading}
              className="shrink-0 bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            >
              {loading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {loading ? t("searching") : t("search")}
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span>{t("tokenEstimate", tokenEstimate)}</span>
            <Link
              href="/community/projects?preset=xposed"
              className="text-cyan-300 underline-offset-2 hover:underline"
            >
              {t("readMode")}
            </Link>
            {result?.mode === "fallback" && (
              <span className="text-amber-300/90">{t("fallback")}</span>
            )}
            {error && <span className="text-amber-300/90">{t("error")}</span>}
          </div>

          {result?.summary && (
            <p className="mt-3 text-sm leading-6 text-cyan-100/85">{result.summary}</p>
          )}

          {result && (
            <div className="mt-3 max-h-[min(42vh,24rem)] overflow-y-auto pr-1">
              {result.domains.length === 0 ? (
                <p className="py-4 text-sm text-zinc-500">{t("empty")}</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {result.domains.map((domain) => (
                    <Link
                      key={domain.slug}
                      href={`/community/${encodeURIComponent(domain.slug)}`}
                      prefetch={false}
                      className="group rounded-xl border border-white/10 bg-white/[0.04] p-3 transition hover:border-cyan-200/35 hover:bg-cyan-300/[0.08]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold text-zinc-100 group-hover:text-cyan-100">
                            {domainName(domain, lang)}
                          </h3>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">
                            {domainDescription(domain, lang) || t("noDescription")}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2 py-0.5 text-xs font-semibold text-cyan-100">
                          {t("members", { count: domain.member_count })}
                        </span>
                      </div>
                      {domain.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {domain.tags.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="max-w-full truncate rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-zinc-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <ByoKeyModal
        open={byoOpen}
        reason={t("byoReason")}
        onClose={() => setByoOpen(false)}
        onSave={(cfg) => {
          setByoOpen(false);
          void runSearch(cfg);
        }}
      />
    </div>
  );
}
