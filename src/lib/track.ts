import { track } from "@vercel/analytics";

/**
 * Where a PK (versus) entry was triggered from — lets us tell the badge-landing
 * loop apart from in-page CTAs when reading the funnel. Kept as a closed union so
 * the dashboard groups stay clean.
 */
export type PkSource =
  | "badge_banner"
  | "profile_btn"
  | "leaderboard"
  | "modal"
  | "similar";

export type TrackEvent =
  | "badge_banner_view"
  | "badge_banner_click"
  | "pk_cta_click"
  | "similar_dev_click"
  | "leaderboard_vs_click"
  | "facet_rank_click"
  | "modal_cta_click";

/**
 * Thin, typed wrapper over Vercel Analytics `track()`. Client-only (the underlying
 * API no-ops on the server) and swallows failures so a blocked analytics script
 * never breaks a click handler. GA4 pageview autotracking is untouched — this only
 * adds the custom interaction events the growth surfaces need.
 */
export function trackEvent(
  name: TrackEvent,
  props?: Record<string, string | number | boolean>,
): void {
  try {
    track(name, props);
  } catch {
    /* analytics blocked or unavailable */
  }
}
