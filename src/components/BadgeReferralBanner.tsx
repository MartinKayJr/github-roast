"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChallengeCta } from "./ChallengeCta";
import { trackEvent } from "@/lib/track";

/**
 * The badge-landing hook. Shown at the top of a /u profile when the visitor
 * arrived from a GitHub README badge (Referer github.com, or an explicit
 * `?ref=badge`) and is looking at *someone else's* page. Turns that shallow,
 * one-page badge click into a PK entry — "you just read @owner's profile; see how
 * you stack up against them" — welding the growing badge channel onto the versus
 * viral loop. Dismissable per-render (no persistence needed at this scale).
 */
export function BadgeReferralBanner({
  owner,
  signal,
}: {
  owner: string;
  /** How the landing was detected — for funnel attribution. */
  signal: "referer" | "ref";
}) {
  const t = useTranslations("challenge");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    trackEvent("badge_banner_view", { owner: owner.toLowerCase(), signal });
  }, [owner, signal]);

  if (dismissed) return null;

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-orange-400/40 bg-orange-500/[0.1] p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-orange-100">
          {t("bannerTitle", { owner })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ChallengeCta
          opponent={owner}
          source="badge_banner"
          variant="button"
          label={t("cta")}
          goLabel={t("go")}
          placeholder={t("inputPlaceholder")}
          selfHint={t("selfHint")}
          invalidHint={t("invalidHint")}
        />
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("dismiss")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-orange-200/60 hover:bg-orange-500/20 hover:text-orange-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
