import { describe, it, expect } from "vitest";
import { scoreMetrics, collectAndScore, GitHubAuthRequiredError } from "./local.js";
import type { RawMetrics } from "./types.js";

/** A complete, all-neutral RawMetrics (valid input to the pure scorer). */
function emptyMetrics(over: Partial<RawMetrics> = {}): RawMetrics {
  return {
    username: "test",
    profile_url: null,
    avatar_url: null,
    name: null,
    bio: null,
    company: null,
    account_age_years: 0,
    created_at: null,
    followers: 0,
    following: 0,
    public_repos: 0,
    fetched_repo_count: 0,
    original_repo_count: 0,
    nonempty_original_repo_count: 0,
    fork_repo_count: 0,
    empty_original_repo_count: 0,
    total_stars: 0,
    max_stars: 0,
    merged_pr_count: 0,
    total_pr_count: 0,
    issues_created: 0,
    last_year_contributions: 0,
    activity_type_count: 0,
    contribution_years_active: 0,
    days_since_last_activity: null,
    recent_merged_pr_sample: 0,
    recent_trivial_pr_count: 0,
    external_trivial_pr_count: 0,
    max_impact_repo_stars: 0,
    impact_pr_count: 0,
    impact_depth_raw: 0,
    star_inflation_suspect: false,
    closed_unmerged_pr_count: 0,
    pr_rejection_rate: 0,
    recent_pr_sample: 0,
    top_repo_pr_target: null,
    top_repo_pr_share: 0,
    templated_pr_ratio: 0,
    pr_flood_suspect: false,
    ...over,
  };
}

describe("ghfind/local", () => {
  it("scoreMetrics runs the real deterministic core and returns a full Scoring", () => {
    const s = scoreMetrics(emptyMetrics());
    expect(s).toHaveProperty("final_score");
    expect(s).toHaveProperty("tier");
    expect(s).toHaveProperty("sub_scores");
    expect(Object.keys(s.sub_scores)).toContain("contribution_quality");
    expect(s.final_score).toBeGreaterThanOrEqual(0);
    expect(s.final_score).toBeLessThanOrEqual(100);
  });

  it("scoreMetrics is deterministic (same input → same score)", () => {
    const m = emptyMetrics({ followers: 500, total_stars: 3000, merged_pr_count: 40 });
    expect(scoreMetrics(m).final_score).toBe(scoreMetrics(m).final_score);
  });

  it("collectAndScore requires a token", async () => {
    const prev = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      await expect(collectAndScore("torvalds")).rejects.toBeInstanceOf(GitHubAuthRequiredError);
    } finally {
      if (prev !== undefined) process.env.GITHUB_TOKEN = prev;
    }
  });
});
