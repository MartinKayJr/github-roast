import { describe, expect, it } from "vitest";
import { rankSimilar, subScoreDistance } from "../similarity";
import type { SubScores } from "../types";

const profile = (over: Partial<SubScores> = {}): SubScores => ({
  account_maturity: 0,
  original_project_quality: 0,
  contribution_quality: 0,
  ecosystem_impact: 0,
  community_influence: 0,
  activity_authenticity: 0,
  ...over,
});

describe("subScoreDistance", () => {
  it("is zero for identical profiles", () => {
    const a = profile({ account_maturity: 8, contribution_quality: 20 });
    expect(subScoreDistance(a, a)).toBe(0);
  });

  it("grows as profiles diverge", () => {
    const target = profile({ contribution_quality: 27 });
    const near = profile({ contribution_quality: 24 });
    const far = profile({ contribution_quality: 5 });
    expect(subScoreDistance(target, near)).toBeLessThan(subScoreDistance(target, far));
  });

  it("normalizes by each dimension's max so axes are comparable", () => {
    // community_influence max 8: a 4pt gap = 0.5 normalized.
    // contribution_quality max 27: a ~13.5pt gap = 0.5 normalized → equal distance.
    const base = profile();
    const dCommunity = subScoreDistance(base, profile({ community_influence: 4 }));
    const dContrib = subScoreDistance(base, profile({ contribution_quality: 13.5 }));
    expect(Math.abs(dCommunity - dContrib)).toBeLessThan(1e-9);
  });
});

describe("rankSimilar", () => {
  const target = profile({ account_maturity: 10, contribution_quality: 25 });
  const candidates = [
    { id: "far", sub_scores: profile({ account_maturity: 2, community_influence: 8 }) },
    { id: "closest", sub_scores: profile({ account_maturity: 10, contribution_quality: 24 }) },
    { id: "mid", sub_scores: profile({ account_maturity: 8, contribution_quality: 18 }) },
  ];

  it("orders candidates by ascending distance", () => {
    const ranked = rankSimilar(target, candidates, 3).map((c) => c.id);
    expect(ranked).toEqual(["closest", "mid", "far"]);
  });

  it("returns at most k", () => {
    expect(rankSimilar(target, candidates, 2)).toHaveLength(2);
    expect(rankSimilar(target, candidates, 0)).toHaveLength(0);
  });
});
