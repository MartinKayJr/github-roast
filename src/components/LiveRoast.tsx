"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@/i18n/navigation";
import { splitReport } from "@/lib/report";
import { consumeRoastStream } from "@/lib/roast-stream";
import type { RoastLine, RoastMeta, ScanResult, Tags } from "@/lib/types";
import { RoastResultModal } from "./RoastResultModal";

/**
 * Streams a live roast on the profile page for a username that has been scanned
 * (its scan is in the server-side cache) but not yet roasted — so the visitor
 * sees the report write itself in place instead of waiting on the homepage.
 * Renders the inner roast-section content only (the heading/section wrapper is
 * the caller's). On completion it refreshes the server-rendered page once, so
 * the freshly persisted profile (rank, reactions, badge) replaces this shell.
 */
export function LiveRoast({
  username,
  scan,
}: {
  username: string;
  /** Fresh scan from the homepage handoff. Sent in the request body so the roast
   * works even without a server-side scan cache; the route still prefers its own
   * cached scan when present (the client can't inflate the score). */
  scan?: ScanResult | null;
}) {
  const t = useTranslations("detail");
  const locale = useLocale();
  const router = useRouter();
  const started = useRef(false);

  const [thinking, setThinking] = useState("");
  const [report, setReport] = useState("");
  const [meta, setMeta] = useState<RoastMeta | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // The result popup only opens after a *fresh* LLM generation (the stream
  // carried control frames); cached replays skip it. `modalMeta`/`modalReport`
  // snapshot the values at completion so the popup stays stable while it's open.
  const [modalMeta, setModalMeta] = useState<RoastMeta | null>(null);
  const [modalReport, setModalReport] = useState("");

  // Refresh the server page once (a one-shot guard prevents a refresh loop if the
  // row still isn't visible afterward). For a fresh roast this is deferred until
  // the popup closes — refreshing immediately would swap the shell for the full
  // profile and unmount the popup mid-view.
  const refreshOnce = useCallback(() => {
    const key = `liveRoastRefreshed:${username.toLowerCase()}`;
    if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      router.refresh();
    }
  }, [username, router]);

  useEffect(() => {
    if (started.current) return; // guard against StrictMode double-invoke
    started.current = true;
    (async () => {
      try {
        const res = await fetch("/api/roast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Send the handed-off scan when present (works without a server cache);
          // the route falls back to its own cached scan otherwise. byoKey is
          // always null here (BYO roasts stay on the home page, since they
          // persist nothing for the profile to refresh into).
          body: JSON.stringify({ username, scan: scan ?? undefined, byoKey: null, lang: locale }),
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          setErrorKey(mapError(data?.error));
          return;
        }

        let latestMeta: RoastMeta | null = null;
        const { report: finalReport, errored, fresh } = await consumeRoastStream(res, {
          onThinking: setThinking,
          onMeta: (m) => {
            latestMeta = m;
            setMeta(m);
          },
          onReport: setReport,
          onError: (data) => setErrorKey(mapError(data?.error)),
        });
        if (errored) return;

        // Fresh LLM generation → pop the result modal with a snapshot of the
        // final meta/report, and hold the page refresh until the user closes it.
        // Cached replay (no frames) → refresh straight into the full profile.
        if (fresh && latestMeta) {
          setModalMeta(latestMeta);
          setModalReport(finalReport);
        } else {
          refreshOnce();
        }
      } catch {
        setErrorKey("liveError");
      }
    })();
  }, [username, scan, locale, refreshOnce]);

  if (errorKey) {
    return (
      <p className="text-sm text-zinc-400">
        {t(errorKey)}{" "}
        <Link href="/" className="text-orange-400 hover:underline">
          {t("liveGoHome")}
        </Link>
      </p>
    );
  }

  const { body: reportBody, roast: inlineRoast } = splitReport(report);
  const line = pickLine(meta?.roast_line, locale) || inlineRoast;
  const tags = meta?.tags;
  const { body: modalBody } = splitReport(modalReport);

  return (
    <>
      {modalMeta && (
        <RoastResultModal
          open
          onClose={() => {
            setModalMeta(null);
            refreshOnce();
          }}
          username={username}
          name={scan?.metrics.name ?? null}
          avatarUrl={scan?.metrics.avatar_url ?? `https://github.com/${username}.png`}
          meta={modalMeta}
          reportBody={modalBody}
          subScores={scan?.scoring.sub_scores ?? null}
        />
      )}
      {line ? (
        <p className="mb-4 rounded-xl border border-orange-500/30 bg-orange-500/[0.08] p-4 text-[0.95rem] leading-relaxed text-zinc-100">
          🔥 {line}
        </p>
      ) : (
        <div className="mb-4 flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex gap-1.5">
            <span className="h-2 w-2 animate-bounce rounded-full bg-orange-400 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-orange-400 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-orange-400" />
          </div>
          <div className="text-sm text-zinc-400 tabular-nums">
            {thinking || t("livePending")}
          </div>
        </div>
      )}

      {tags && (tags.zh.length > 0 || tags.en.length > 0) && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {tagsList(tags).map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className="rounded-full border border-orange-400/30 bg-orange-500/10 px-2.5 py-0.5 text-xs font-medium text-orange-200"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {reportBody && (
        <div className={`report text-[0.95rem] text-zinc-200 ${report ? "caret" : ""}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{reportBody}</ReactMarkdown>
        </div>
      )}
    </>
  );
}

/** Map a server error code to a `detail` message key. */
function mapError(code: string | undefined): string {
  if (code === "rate_limited") return "liveRateLimited";
  if (code === "missing_scan") return "liveExpired";
  return "liveError";
}

function pickLine(line: RoastLine | undefined, locale: string): string {
  if (!line) return "";
  return locale === "en" ? line.en : line.zh;
}

function tagsList(tags: Tags): string[] {
  return [...tags.zh, ...tags.en];
}
