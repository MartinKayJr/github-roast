import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROAST_CACHE_VERSION } from "../cache-version";
import type { ScoreEntry } from "../db";
import type { ProjectScanResult } from "../project-scan";
import type { RawMetrics, ScanResult } from "../types";

let db: typeof import("../db");
let tmpDir: string;

const entry: ScoreEntry = {
  username: "RockChinQ",
  display_name: "Rock",
  avatar_url: null,
  profile_url: "https://github.com/RockChinQ",
  final_score: 95.2,
  tier: "夯",
  tags: { zh: ["开源狠人"], en: ["oss beast"] },
  roast_line: { zh: "强到没法吐槽。", en: "Too good to roast." },
  bot_score: 0,
  sub_scores: {
    account_maturity: 10,
    original_project_quality: 18,
    contribution_quality: 27,
    ecosystem_impact: 20,
    community_influence: 8,
    activity_authenticity: 12.2,
  },
  scanned_at: 1_800_000_000_000,
};

const baseMetrics: RawMetrics = {
  username: "growth-qualified",
  profile_url: "https://github.com/growth-qualified",
  avatar_url: null,
  name: "Growth Qualified",
  bio: null,
  company: null,
  account_age_years: 3,
  created_at: "2023-01-01T00:00:00Z",
  followers: 10,
  following: 5,
  public_repos: 4,
  fetched_repo_count: 4,
  original_repo_count: 4,
  nonempty_original_repo_count: 3,
  fork_repo_count: 0,
  empty_original_repo_count: 1,
  total_stars: 10,
  max_stars: 8,
  best_original_repo_quality_score: 0.8,
  top_starred_original_repo_quality_score: 0.8,
  merged_pr_count: 4,
  total_pr_count: 5,
  issues_created: 1,
  last_year_contributions: 80,
  activity_type_count: 2,
  contribution_years_active: 3,
  days_since_last_activity: 1,
  recent_merged_pr_sample: 3,
  recent_trivial_pr_count: 0,
  external_trivial_pr_count: 0,
  max_impact_repo_stars: 0,
  impact_pr_count: 0,
  impact_depth_raw: 0,
  impact_commit_count: 0,
  star_inflation_suspect: false,
  closed_unmerged_pr_count: 0,
  pr_rejection_rate: 0,
  recent_pr_sample: 3,
  top_repo_pr_target: null,
  top_repo_pr_share: 0,
  templated_pr_ratio: 0,
  pr_flood_suspect: false,
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function scanFixture(
  username: string,
  finalScore: number,
  overrides: Partial<RawMetrics> = {},
): ScanResult {
  return {
    metrics: {
      ...baseMetrics,
      ...overrides,
      username,
      profile_url: `https://github.com/${username}`,
    },
    top_repos: [
      {
        name: "app",
        owner_login: username,
        name_with_owner: `${username}/app`,
        stars: 10,
        forks: 1,
        open_issues: 0,
        size: 100,
        language: "TypeScript",
        description: null,
        pushed_at: new Date().toISOString(),
      },
    ],
    recent_prs: [],
    flood_pr_titles: [],
    impact_repos: [],
    verified_impact_prs: [],
    pinned_repos: [],
    organizations: [],
    contribution_days: [{ date: todayIso(), contribution_count: 4 }],
    scoring: {
      sub_scores: entry.sub_scores,
      base_score: finalScore,
      red_flags: [],
      total_penalty: 0,
      final_score: finalScore,
      tier: finalScore > 70 ? "人上人" : "NPC",
      tier_label: "test",
    },
  };
}

function projectScanFixture(fullName: string): ProjectScanResult {
  const [ownerRaw, repoRaw] = fullName.split("/");
  const owner = ownerRaw ?? "owner";
  const repo = repoRaw ?? "repo";
  return {
    owner,
    repo,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    owner_avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    description: "Test project circle",
    homepage: null,
    language: "TypeScript",
    topics: ["test"],
    license: "MIT",
    stars: 12,
    forks: 2,
    watchers: 12,
    open_issues: 1,
    size: 128,
    default_branch: "main",
    created_at: "2024-01-01T00:00:00Z",
    pushed_at: new Date().toISOString(),
    latest_release_at: null,
    contributors: [
      {
        login: `${repo}-alice`,
        avatar_url: `https://avatars.githubusercontent.com/u/101?v=4`,
        html_url: `https://github.com/${repo}-alice`,
        contributions: 8,
        role: "contributor",
      },
      {
        login: `${repo}-bob`,
        avatar_url: `https://avatars.githubusercontent.com/u/102?v=4`,
        html_url: `https://github.com/${repo}-bob`,
        contributions: 3,
        role: "contributor",
      },
    ],
    languages: [{ name: "TypeScript", size: 128 }],
    readme: null,
    score: 61,
    band: "A",
    breakdown: {
      activity: 12,
      quality: 14,
      collaboration: 13,
      impact: 10,
      authenticity: 12,
    },
    roast_line: {
      zh: "测试项目圈",
      en: "Test project circle",
    },
    resolved_from_repository: null,
    scanned_at: Date.now(),
  };
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "ghroast-db-"));
  process.env.TURSO_DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  db = await import("../db");
});

afterAll(async () => {
  delete process.env.TURSO_DATABASE_URL;
  db.closeDbClientForTests();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      return;
    } catch {
      await delay(50 * (attempt + 1));
    }
  }
});

describe("getArchivedRoast", () => {
  it("replays archived reports by username and language", async () => {
    await db.recordScore(entry);
    await db.updateRoast("RockChinQ", "## 中文报告", "zh");
    await db.updateRoast("RockChinQ", "## English report", "en");

    await expect(db.getArchivedRoast("rockchinq", "zh")).resolves.toMatchObject({
      username: "rockchinq",
      final_score: 95.2,
      tier: "夯",
      tags: entry.tags,
      report: "## 中文报告",
    });
    await expect(db.getArchivedRoast("RockChinQ", "en")).resolves.toMatchObject({
      report: "## English report",
    });
  });

  it("does not replay archived reports from a stale roast version", async () => {
    await db.recordScore({ ...entry, username: "stale-roast" });
    await db.updateRoast("stale-roast", "## stale report", "zh");

    const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
    await client.execute({
      sql: `UPDATE scores SET roast_version = ? WHERE username = ?`,
      args: [`${ROAST_CACHE_VERSION}-old`, "stale-roast"],
    });
    client.close();

    await expect(db.getArchivedRoast("stale-roast", "zh")).resolves.toBeNull();
  });

  it("does not replay archived reports from rows without cache versions", async () => {
    await db.recordScore({ ...entry, username: "legacy-roast" });
    await db.updateRoast("legacy-roast", "## legacy report", "zh");

    const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
    await client.execute({
      sql: `UPDATE scores
            SET score_version = NULL, roast_version = NULL
            WHERE username = ?`,
      args: ["legacy-roast"],
    });
    client.close();

    await expect(db.getArchivedRoast("legacy-roast", "zh")).resolves.toBeNull();
  });
});

describe("score snapshots", () => {
  it("stores one generated-at stub when a completed roast is persisted", async () => {
    const username = "roast-snapshot";
    const before = Date.now();
    await db.recordScore({ ...entry, username, final_score: 90 });
    await db.updateRoast(username, "## first report", "zh");
    await db.recordScore({
      ...entry,
      username,
      final_score: 96.1,
      scanned_at: entry.scanned_at + 2 * 60 * 60 * 1000,
    });
    await db.updateRoast(username, "## second report", "en");
    const after = Date.now();

    const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
    const res = await client.execute({
      sql: `SELECT COUNT(*) AS n,
                   MIN(generated_at) AS first_generated_at,
                   MAX(generated_at) AS last_generated_at,
                   GROUP_CONCAT(roast_lang, ',') AS langs
            FROM score_snapshots
            WHERE username = ?`,
      args: [username],
    });

    expect(Number(res.rows[0]?.n)).toBe(2);
    expect(Number(res.rows[0]?.first_generated_at)).toBeGreaterThanOrEqual(before);
    expect(Number(res.rows[0]?.last_generated_at)).toBeLessThanOrEqual(after);
    expect(String(res.rows[0]?.langs).split(",").sort()).toEqual(["en", "zh"]);
    client.close();
  });
});

describe("profile comments", () => {
  it("stores anonymous and GitHub comments for a profile", async () => {
    const anonymous = await db.createProfileComment({
      targetUsername: "Torvalds",
      text: "硬核 🔥",
      author: { type: "anonymous" },
    });
    const github = await db.createProfileComment({
      targetUsername: "torvalds",
      text: "Legend status",
      author: {
        type: "github",
        username: "yyx990803",
        avatarUrl: "https://avatars.githubusercontent.com/u/499550",
      },
      authorGithubId: 499550,
    });

    expect(anonymous).toMatchObject({
      targetUsername: "torvalds",
      author: { type: "anonymous" },
      text: "硬核 🔥",
    });
    expect(github).toMatchObject({
      targetUsername: "torvalds",
      author: {
        type: "github",
        username: "yyx990803",
        avatarUrl: "https://avatars.githubusercontent.com/u/499550",
      },
      text: "Legend status",
    });

    await expect(db.getProfileComments("TORVALDS")).resolves.toMatchObject([
      { author: { type: "anonymous" }, text: "硬核 🔥" },
      { author: { type: "github", username: "yyx990803" }, text: "Legend status" },
    ]);
  });
});

describe("profile reactions", () => {
  it("stores one durable reaction per GitHub user and target profile", async () => {
    await db.setProfileReaction({
      targetUsername: "React-Target",
      voterGithubId: 101,
      voterLogin: "alice",
      reaction: "like",
    });
    await db.setProfileReaction({
      targetUsername: "react-target",
      voterGithubId: 202,
      voterLogin: "bob",
      reaction: "poop",
    });

    await expect(db.getProfileReactionState("REACT-TARGET", 101)).resolves.toEqual({
      counts: { like: 1, poop: 1, kick: 0, fire: 0, salute: 0, clown: 0 },
      viewerReaction: "like",
    });
  });

  it("atomically replaces an existing reaction instead of adding another vote", async () => {
    const state = await db.setProfileReaction({
      targetUsername: "react-target",
      voterGithubId: 101,
      voterLogin: "alice-renamed",
      reaction: "fire",
    });

    expect(state).toEqual({
      counts: { like: 0, poop: 1, kick: 0, fire: 1, salute: 0, clown: 0 },
      viewerReaction: "fire",
    });
  });

  it("removes only the authenticated user's reaction", async () => {
    const state = await db.removeProfileReaction({
      targetUsername: "REACT-TARGET",
      voterGithubId: 101,
    });

    expect(state).toEqual({
      counts: { like: 0, poop: 1, kick: 0, fire: 0, salute: 0, clown: 0 },
      viewerReaction: null,
    });
  });
});

describe("getTrendingLeaderboard", () => {
  it("counts unique lookups from the last seven days only", async () => {
    const now = Date.now();
    await db.recordScore({ ...entry, username: "fresh", final_score: 92, scanned_at: now });
    await db.recordScore({ ...entry, username: "stale", final_score: 100, scanned_at: now - 1 });

    await db.recordAccountLookup("fresh", "203.0.113.1");
    await db.recordAccountLookup("fresh", "203.0.113.2");
    await db.recordAccountLookup("fresh", "203.0.113.2"); // same visitor, same 24h window
    await db.recordAccountLookup("stale", "203.0.113.3");

    const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
    await client.execute({
      sql: `UPDATE account_lookup_limits
            SET last_counted_at = ?
            WHERE username = ?`,
      args: [now - 8 * 24 * 60 * 60 * 1000, "stale"],
    });
    await client.execute({
      sql: `UPDATE account_stats
            SET last_lookup_at = ?
            WHERE username = ?`,
      args: [now - 8 * 24 * 60 * 60 * 1000, "stale"],
    });
    client.close();

    const entries = await db.getTrendingLeaderboard(10);
    const fresh = entries.find((e) => e.username === "fresh");
    const stale = entries.find((e) => e.username === "stale");

    expect(fresh?.recent_lookup_count).toBe(2);
    expect(stale?.recent_lookup_count).toBe(0);
    expect(fresh?.trending_score).toBeGreaterThan(0);
    expect(entries[0]?.username).toBe("fresh");
  });
});

describe("searchFacetCategories", () => {
  it("searches facet labels across types and counts only public qualified developers", async () => {
    const now = Date.now();
    await db.recordScore({ ...entry, username: "facet-search-a", final_score: 91, scanned_at: now });
    await db.recordScore({ ...entry, username: "facet-search-b", final_score: 87, scanned_at: now });
    await db.recordScore({ ...entry, username: "facet-search-low", final_score: 59, scanned_at: now });
    await db.recordScore({ ...entry, username: "facet-search-hidden", final_score: 99, scanned_at: now });

    await db.recordDeveloperFacets("facet-search-a", [
      { type: "language", value: "FacetSearchVectorDB", weight: 100 },
      { type: "repo", value: "facetsearch/vector-db", weight: 1000 },
      { type: "org", value: "FacetSearchLabs", weight: 1 },
    ]);
    await db.recordDeveloperFacets("facet-search-b", [
      { type: "language", value: "FacetSearchVectorDB", weight: 100 },
    ]);
    await db.recordDeveloperFacets("facet-search-low", [
      { type: "language", value: "FacetSearchVectorDB", weight: 100 },
    ]);
    await db.recordDeveloperFacets("facet-search-hidden", [
      { type: "language", value: "FacetSearchVectorDB", weight: 100 },
    ]);
    await db.hideUser("facet-search-hidden");

    const results = await db.searchFacetCategories("FacetSearchVectorDB", { limit: 10 });
    expect(results[0]).toEqual({
      type: "language",
      value: "FacetSearchVectorDB",
      count: 2,
    });

    const repoResults = await db.searchFacetCategories("facetsearch", {
      type: "repo",
      limit: 10,
    });
    expect(repoResults).toEqual([
      { type: "repo", value: "facetsearch/vector-db", count: 1 },
    ]);
  });
});

describe("community project domains", () => {
  it("uses project contributor avatars and demotes empty domains", async () => {
    const project = projectScanFixture("circleavatars/project-with-avatars");
    await db.recordProjectScan(project);

    const emptySlug = "admin:empty-high-heat";
    const now = Date.now();
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
    await client.execute({
      sql: `INSERT INTO circle_domains
              (slug, name_zh, name_en, description_zh, description_en,
               source, status, member_count, heat_score, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'admin', 'active', 0, 999999, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
              heat_score = excluded.heat_score,
              updated_at = excluded.updated_at`,
      args: [
        emptySlug,
        "空项目圈",
        "Empty project circle",
        JSON.stringify({ tag: "empty/high-heat", project: true }),
        JSON.stringify({ tag: "empty/high-heat", project: true }),
        now,
        now,
      ],
    });
    client.close();

    const page = await db.getCommunityDomains({ limit: 24 });
    const projectSlug = db.projectDomainSlug(project.owner, project.repo);
    const projectDomain = page.domains.find((d) => d.slug === projectSlug);
    const emptyDomain = page.domains.find((d) => d.slug === emptySlug);

    expect(projectDomain?.members.map((m) => m.avatar_url)).toEqual([
      "https://avatars.githubusercontent.com/u/101?v=4",
      "https://avatars.githubusercontent.com/u/102?v=4",
    ]);
    expect(projectDomain?.members.map((m) => m.tier)).toEqual(["NPC", "NPC"]);
    expect(page.domains.findIndex((d) => d.slug === projectSlug)).toBeLessThan(
      page.domains.findIndex((d) => d.slug === emptySlug),
    );
    expect(emptyDomain?.members).toEqual([]);
  });
});

describe("getRank", () => {
  it("ranks by score desc over a shared population", async () => {
    await db.recordScore({ ...entry, username: "rank-low", final_score: 11 });
    await db.recordScore({ ...entry, username: "rank-mid", final_score: 22 });
    await db.recordScore({ ...entry, username: "rank-high", final_score: 33 });

    const low = await db.getRank(11);
    const mid = await db.getRank(22);
    const high = await db.getRank(33);
    expect(low && mid && high).toBeTruthy();
    // A higher score earns a smaller (better) rank number.
    expect(high!.rank).toBeLessThan(mid!.rank);
    expect(mid!.rank).toBeLessThan(low!.rank);
    // Every query measures the same population, and `below` tracks the score.
    expect(high!.total).toBe(low!.total);
    expect(high!.total).toBeGreaterThanOrEqual(3);
    expect(high!.below).toBeGreaterThan(mid!.below);
  });

  it("excludes hidden accounts from the ranking", async () => {
    const before = await db.getRank(22);
    await db.recordScore({ ...entry, username: "rank-hidden", final_score: 99 });
    await db.hideUser("rank-hidden");
    const after = await db.getRank(22);
    // A hidden high score neither inflates the total nor worsens the rank.
    expect(after!.total).toBe(before!.total);
    expect(after!.rank).toBe(before!.rank);
  });
});

describe("growth scan subscriptions", () => {
  it("tracks subscription state and due scans", async () => {
    await db.upsertUser({
      github_id: 991001,
      login: "GrowthSubUser",
      name: "Growth Sub",
      avatar_url: null,
    });

    const active = await db.upsertGrowthScanSubscription({
      github_id: 991001,
      login: "GrowthSubUser",
    });
    expect(active).toMatchObject({
      github_id: 991001,
      login: "growthsubuser",
      status: "active",
      last_scanned_at: null,
      last_error: null,
    });

    const due = await db.listDueGrowthScanSubscriptions(10, 24 * 60 * 60 * 1000);
    expect(due.some((s) => s.github_id === 991001)).toBe(true);

    await db.markGrowthScanSubscriptionRun(991001, {
      last_scanned_at: Date.now(),
      last_error: null,
    });
    const notDue = await db.listDueGrowthScanSubscriptions(10, 24 * 60 * 60 * 1000);
    expect(notDue.some((s) => s.github_id === 991001)).toBe(false);

    const inactive = await db.updateGrowthScanSubscriptionStatus(991001, "inactive");
    expect(inactive?.status).toBe("inactive");
  });
});

describe("recent growth contribution eligibility", () => {
  it("adds roast scans to recent growth when the final score is above 50 and activity is recent", async () => {
    const username = "growth-roast-qualified";
    const scan = scanFixture(username, 45);
    await db.recordScore({
      ...entry,
      username,
      final_score: 55,
      tier: "NPC",
      scanned_at: Date.now(),
    });

    await db.recordProfileSnapshot(scan, { growthFinalScore: 55 });

    const points = await db.getGrowthTimeline(50, "30d");
    expect(points.some((p) => p.username === username)).toBe(true);
  });

  it("keeps daily contribution steps for users who commit on multiple days", async () => {
    const username = "growth-multi-day";
    const scan = scanFixture(username, 72);
    scan.contribution_days = [
      { date: daysAgoIso(5), contribution_count: 2 },
      { date: daysAgoIso(1), contribution_count: 7 },
    ];
    await db.recordScore({
      ...entry,
      username,
      final_score: 72,
      tier: "人上人",
      scanned_at: Date.now(),
    });

    await db.recordProfileSnapshot(scan);

    const points = await db.getGrowthTimeline(50, "30d");
    const point = points.find((p) => p.username === username);
    expect(point?.steps.map((s) => s.count)).toEqual([2, 7]);
    expect(point?.contribution_count).toBe(9);
  });

  it("does not add accounts at or below the growth score floor", async () => {
    const username = "growth-low-score";
    const scan = scanFixture(username, 50);
    await db.recordScore({
      ...entry,
      username,
      final_score: 50,
      tier: "NPC",
      scanned_at: Date.now(),
    });

    await db.recordProfileSnapshot(scan);

    const points = await db.getGrowthTimeline(50, "30d");
    expect(points.some((p) => p.username === username)).toBe(false);
  });

  it("removes recent growth days when a later scan looks like farming", async () => {
    const username = "growth-spam-clears";
    await db.recordScore({
      ...entry,
      username,
      final_score: 72,
      tier: "人上人",
      scanned_at: Date.now(),
    });
    await db.recordProfileSnapshot(scanFixture(username, 72));

    let points = await db.getGrowthTimeline(50, "30d");
    expect(points.some((p) => p.username === username)).toBe(true);

    const spamScan = scanFixture(username, 72, {
      recent_merged_pr_sample: 20,
      external_trivial_pr_count: 16,
    });
    spamScan.scoring.red_flags = [
      {
        flag: "trivial_pr_farming",
        penalty: 8,
        detail: "test farming signal",
      },
    ];
    await db.recordProfileSnapshot(spamScan);

    points = await db.getGrowthTimeline(50, "30d");
    expect(points.some((p) => p.username === username)).toBe(false);
  });

  it("does not clear existing growth days when an old cached scan has no contribution_days field", async () => {
    const username = "growth-legacy-cache";
    await db.recordScore({
      ...entry,
      username,
      final_score: 72,
      tier: "人上人",
      scanned_at: Date.now(),
    });
    await db.recordProfileSnapshot(scanFixture(username, 72));

    let points = await db.getGrowthTimeline(50, "30d");
    expect(points.some((p) => p.username === username)).toBe(true);

    const legacyScan = scanFixture(username, 72);
    delete legacyScan.contribution_days;
    await db.recordProfileSnapshot(legacyScan);

    points = await db.getGrowthTimeline(50, "30d");
    expect(points.some((p) => p.username === username)).toBe(true);
  });
});
