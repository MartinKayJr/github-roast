"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { trackEvent } from "@/lib/track";

/**
 * "You're #12 on the Rust board — one spot behind @yyy →". A profile-to-directory
 * hook shown in the "My standing" card: it gives the visitor a concrete next
 * destination (the language leaderboard) instead of a dead end. Tracks the click
 * so the transit-station funnel is measurable.
 */
export function FacetRankLink({
  facetValue,
  rank,
  ahead,
  username,
}: {
  facetValue: string;
  rank: number;
  ahead: string | null;
  /** The profile owner — carried as `?u=` so the board pins their position. */
  username: string;
}) {
  const t = useTranslations("detail");
  const href = `/developers/language/${encodeURIComponent(facetValue)}?u=${encodeURIComponent(username.toLowerCase())}`;
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={() => trackEvent("facet_rank_click", { facet: facetValue, rank })}
      className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-black/15 px-2.5 py-1.5 text-xs text-zinc-200 transition hover:border-orange-400/40 hover:bg-orange-500/10"
    >
      <span className="font-semibold text-orange-200/90">
        {t("facetRankLine", { facet: facetValue, rank })}
      </span>
      {ahead && (
        <span className="min-w-0 truncate text-zinc-400">
          · {t("facetRankAhead", { username: ahead })}
        </span>
      )}
      <span aria-hidden className="text-zinc-500">
        →
      </span>
    </Link>
  );
}
