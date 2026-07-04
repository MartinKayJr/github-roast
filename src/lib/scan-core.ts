import {
  AccountNotFoundError,
  GitHubAuthRequiredError,
  GitHubDataUnavailableError,
  GitHubRateLimitError,
  collect,
} from "@/lib/github";
import { score } from "@/lib/score";
import type { ScanResult } from "@/lib/types";

/**
 * Deterministic scan: crawl GitHub via `collect()` and run the pure `score()`
 * engine. NO LLM — this is the money-free scoring path shared by POST /api/scan
 * and the on-miss fallthrough in GET /api/score/[username].
 *
 * Wrap calls in `coalesceScan()` (single-flight + cache) so a burst of identical
 * requests only crawls GitHub once.
 */
export async function buildScanResult(username: string): Promise<ScanResult> {
  const {
    metrics,
    top_repos,
    recent_prs,
    flood_pr_titles,
    impact_repos,
    verified_impact_prs,
    pinned_repos,
    organizations,
    contribution_days,
  } = await collect(username);
  return {
    metrics,
    top_repos,
    recent_prs,
    flood_pr_titles,
    impact_repos,
    verified_impact_prs,
    pinned_repos,
    organizations,
    contribution_days,
    scoring: score(metrics),
  };
}

/** Maps a GitHub/scan error to the canonical `{ error, status }` used by the
 * scan + score routes, so both surface identical codes. */
export function scanErrorResponse(e: unknown): {
  error: string;
  status: number;
  retry_after?: number;
} {
  if (e instanceof GitHubAuthRequiredError) {
    return { error: "github_token_required", status: 500 };
  }
  if (e instanceof AccountNotFoundError) {
    return { error: "account_not_found", status: 404 };
  }
  if (e instanceof GitHubRateLimitError) {
    return { error: "github_rate_limited", status: 503 };
  }
  if (e instanceof GitHubDataUnavailableError) {
    return { error: "github_unavailable", status: 503, retry_after: 60 };
  }
  console.error("scan failed:", e);
  return { error: "scan_failed", status: 500 };
}
