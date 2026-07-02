"use client";

import { useLocale, useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DIMENSIONS } from "@/lib/dimensions";
import { SITE_URL } from "@/lib/site";
import { TIER_KEY, tierStyle } from "@/lib/tier";
import type { RoastLine, RoastMeta, SubScoreKey, SubScores } from "@/lib/types";
import { CopyBadge } from "./CopyBadge";
import { DimensionStarChart } from "./DimensionStarChart";
import { ProfileShare } from "./ProfileShare";
import { TierAvatarFrame } from "./TierAvatarFrame";

/**
 * Result popup shown once a *fresh* LLM roast finishes streaming on the profile
 * page (see {@link LiveRoast}). Cached/replayed roasts never open it. It surfaces
 * the score, one-liner, tags, dimension chart and the full report above the fold,
 * plus the whole share toolkit ({@link ProfileShare} = 一键分享/下载炫耀图 and
 * {@link CopyBadge} = 引用/贴到 GitHub/炫耀卡) so the user can quote + backlink the
 * moment their roast lands — no scrolling required. Purely a presentational shell
 * over existing components; no new share logic.
 */
export function RoastResultModal({
  open,
  onClose,
  username,
  name,
  avatarUrl,
  meta,
  reportBody,
  subScores,
}: {
  open: boolean;
  onClose: () => void;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  meta: RoastMeta;
  /** Full report markdown (already stripped of the inline one-liner). */
  reportBody: string;
  /** Deterministic dimension scores from the scan; null → hide the radar. */
  subScores: SubScores | null;
}) {
  const t = useTranslations("detail");
  const tTier = useTranslations("tiers");
  const tDim = useTranslations("dimensions");
  const locale = useLocale();

  const style = tierStyle(meta.tier);
  const tierKey = TIER_KEY[meta.tier];
  const line = pickLine(meta.roast_line, locale);
  const tags = [...(meta.tags?.zh ?? []), ...(meta.tags?.en ?? [])];
  const beat = meta.percentile?.beat ?? null;
  const dimensionLabels = Object.fromEntries(
    DIMENSIONS.map((key) => [key, tDim(key)]),
  ) as Record<SubScoreKey, string>;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(calc(100vw-2rem),34rem)] max-h-[85vh] overflow-y-auto">
        <DialogTitle className="text-center text-lg font-bold text-orange-400">
          {t("modalTitle")}
        </DialogTitle>

        {/* Identity + score */}
        <div
          className={`flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center ring-1 ${style.ring}`}
          style={{ boxShadow: `0 0 60px -24px ${style.glow}` }}
        >
          <TierAvatarFrame
            username={username}
            avatarUrl={avatarUrl}
            tier={meta.tier}
            size="lg"
          />
          <div className={`mt-3 max-w-full truncate text-base font-bold ${style.text}`}>
            @{username}
          </div>
          <div className={`mt-1 text-5xl font-black tabular-nums ${style.text}`}>
            {meta.final_score.toFixed(2)}
            <span className="text-xl text-zinc-600">/100</span>
          </div>
          <div className={`mt-1 text-xl font-bold ${style.text}`}>
            {style.emoji} {tTier(`${tierKey}.name`)}
          </div>
          {meta.percentile &&
            (meta.percentile.beat === null ? (
              <div className="mt-2 text-sm text-zinc-300">{t("modalFirstJudged")}</div>
            ) : (
              <div className="mt-2 text-sm text-zinc-300">
                {t("modalBeat", {
                  beat: meta.percentile.beat.toFixed(1),
                  total: meta.percentile.total,
                })}
              </div>
            ))}
        </div>

        {/* Savage one-liner */}
        {line && (
          <p className="rounded-xl border border-orange-500/30 bg-orange-500/[0.08] p-4 text-[0.95rem] leading-relaxed text-zinc-100">
            🔥 {line}
          </p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {tags.map((tag, i) => (
              <span
                key={`${tag}-${i}`}
                className="rounded-full border border-orange-400/30 bg-orange-500/10 px-2.5 py-0.5 text-xs font-medium text-orange-200"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Dimension scores */}
        {subScores && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-3 text-sm font-bold text-zinc-200">
              {t("dimensionsHeading")}
            </div>
            <DimensionStarChart
              scores={subScores}
              labels={dimensionLabels}
              tier={meta.tier}
            />
          </div>
        )}

        {/* Full report */}
        {reportBody && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-2 text-sm font-bold text-zinc-200">
              {t("modalRoastHeading")}
            </div>
            <div className="report text-[0.9rem] text-zinc-200">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{reportBody}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Share toolkit — one-click share / download / 炫耀图 + 引用/贴到 GitHub */}
        <div className="flex flex-col gap-3">
          <ProfileShare
            username={username}
            name={name}
            avatarUrl={avatarUrl}
            score={meta.final_score}
            tier={meta.tier}
            tierLabel={tTier(`${tierKey}.blurb`)}
            beat={beat}
            tags={meta.tags ?? { zh: [], en: [] }}
          />
          <CopyBadge baseUrl={SITE_URL} username={username} version={meta.final_score} />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-1 w-full rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10"
        >
          {t("modalViewProfile")}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function pickLine(line: RoastLine | undefined, locale: string): string {
  if (!line) return "";
  return locale === "en" ? line.en : line.zh;
}
