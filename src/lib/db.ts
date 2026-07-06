/**
 * Turso (libSQL) persistence for the leaderboard + percentile.
 *
 * Optional, like {@link ./redis}: if `TURSO_DATABASE_URL` is unset, every function
 * no-ops (returns null/empty) so the app runs fine without it. Stores one latest
 * row per scanned account plus append-only score snapshots for long-term progress.
 * The score itself is still computed deterministically by `lib/score.ts`; this
 * layer only persists the result for cross-account ranking.
 */

import { Client, createClient } from "@libsql/client";
import { createHash, randomUUID } from "node:crypto";
import {
  bypassGeneratedCaches,
  ROAST_CACHE_VERSION,
  SCORE_CACHE_VERSION,
} from "./cache-version";
import {
  normalizeCommentText,
  normalizeGitHubUsername,
  type ProfileComment,
  type ProfileCommentAuthor,
} from "./comments";
import { extractFacets, type FacetType } from "./facets";
import {
  emptyReactionCounts,
  isProfileReaction,
  type ProfileReaction,
  type ProfileReactionCounts,
  type ProfileReactionState,
} from "./reactions";
import { computeTrendingScore, rankTrending } from "./hotness";
import { VS_MIN_SCORE } from "./site";
import {
  clearCachedReactionCounts,
  getCachedReactionCounts,
  releaseLookupGate,
  setCachedReactionCounts,
  tryAcquireLookupGate,
} from "./redis";
import type { Lang } from "./lang";
import { rankSimilar } from "./similarity";
import type {
  ImpactRepo,
  RoastLine,
  ScanResult,
  SubScores,
  Tags,
  Tier,
  TopRepo,
} from "./types";
import type { LeaderboardWindow } from "./leaderboardWindow";
import { bandFor } from "./band";
import { clampScore, logRatio, spamBotScore } from "./score";
import type { ProjectBand, ProjectScanResult } from "./project-scan";

const EMPTY_TAGS: Tags = { zh: [], en: [] };
const HEAT_LOOKUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const TRENDING_LOOKUP_WINDOW_MS = 7 * HEAT_LOOKUP_WINDOW_MS;
const MIN_RECORDED_LOOKUP_COUNT = 1;
const GROWTH_MIN_FINAL_SCORE = 50;
const GROWTH_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const GROWTH_MAX_SPAM_BOT_SCORE = 3;
const GROWTH_FARMING_FLAGS = new Set([
  "trivial_pr_farming",
  "templated_pr_flooding",
]);

// User-selectable leaderboard time window. Every board shares one meaning: the
// candidate pool is "accounts looked up within this window" (and the recent-heat
// figure is counted over the same window). "all" keeps the original behaviour —
// no recency filter, cumulative heat. The windowed count comes from
// `account_lookup_limits` (one row per unique IP per account, holding its most
// recent counted lookup), which the idx_account_lookup_limits_counted_user
// covering index serves index-only.
export type { LeaderboardWindow };
const LEADERBOARD_WINDOW_MS: Record<Exclude<LeaderboardWindow, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/**
 * Resolve a window into the recent-lookup cutoff (feeds the windowed heat count
 * and the trending score's recency component) and whether to restrict the board
 * to accounts active within it. "all" preserves the legacy 7-week trending
 * recency window and applies no active filter.
 */
function resolveLeaderboardWindow(window: LeaderboardWindow, now: number) {
  if (window === "all") {
    return { recentCutoff: now - TRENDING_LOOKUP_WINDOW_MS, activeOnly: false };
  }
  return { recentCutoff: now - LEADERBOARD_WINDOW_MS[window], activeOnly: true };
}
// Only roll the previous score forward when this much time has passed since the
// last recorded scan. Distinguishes a genuine re-scan (≥24h apart, since scans
// are cached 24h) from the same session re-recording in the other language a few
// seconds later — the latter must not clobber a real improvement.
const PROGRESS_MIN_GAP_MS = 60 * 60 * 1000;

function parseTags(raw: unknown): Tags {
  if (typeof raw !== "string" || !raw) return EMPTY_TAGS;
  try {
    const t = JSON.parse(raw) as Partial<Tags>;
    return { zh: Array.isArray(t.zh) ? t.zh : [], en: Array.isArray(t.en) ? t.en : [] };
  } catch {
    return EMPTY_TAGS;
  }
}

const EMPTY_ROAST_LINE: RoastLine = { zh: "", en: "" };

function parseRoastLine(raw: unknown): RoastLine {
  if (typeof raw !== "string" || !raw) return EMPTY_ROAST_LINE;
  try {
    const r = JSON.parse(raw) as Partial<RoastLine>;
    return { zh: typeof r.zh === "string" ? r.zh : "", en: typeof r.en === "string" ? r.en : "" };
  } catch {
    return EMPTY_ROAST_LINE;
  }
}

const EMPTY_SUB: SubScores = {
  account_maturity: 0,
  original_project_quality: 0,
  contribution_quality: 0,
  ecosystem_impact: 0,
  community_influence: 0,
  activity_authenticity: 0,
};

function parseSubScores(raw: unknown): SubScores {
  if (typeof raw !== "string" || !raw) return EMPTY_SUB;
  try {
    const s = JSON.parse(raw) as Partial<SubScores>;
    return {
      account_maturity: Number(s.account_maturity) || 0,
      original_project_quality: Number(s.original_project_quality) || 0,
      contribution_quality: Number(s.contribution_quality) || 0,
      ecosystem_impact: Number(s.ecosystem_impact) || 0,
      community_influence: Number(s.community_influence) || 0,
      activity_authenticity: Number(s.activity_authenticity) || 0,
    };
  } catch {
    return EMPTY_SUB;
  }
}

function normalizeLookupCount(raw: unknown): number {
  return Math.max(MIN_RECORDED_LOOKUP_COUNT, Number(raw) || 0);
}

function normalizeRecentLookupCount(raw: unknown): number {
  return Math.max(0, Number(raw) || 0);
}

function normalizeLastLookupAt(raw: unknown): number | null {
  return raw == null ? null : Number(raw);
}

function heatIpHash(ip: string): string {
  const salt =
    process.env.AUTH_SECRET ?? process.env.TURNSTILE_SECRET_KEY ?? "github-roast-heat-v1";
  return createHash("sha256").update(salt).update("\0").update(ip).digest("hex");
}

let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

function getClient(): Client | null {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return null;
  client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN, // omit for local file: URLs
  });
  return client;
}

export function closeDbClientForTests(): void {
  client?.close();
  client = null;
  schemaReady = null;
}

/** Create the table/index once per process. */
function ensureSchema(db: Client): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.batch(
        [
          `CREATE TABLE IF NOT EXISTS scores (
             username     TEXT PRIMARY KEY,
             display_name TEXT,
             avatar_url   TEXT,
             profile_url  TEXT,
             final_score  REAL NOT NULL,
             tier         TEXT NOT NULL,
             tags         TEXT,
             bot_score    REAL,
             sub_scores   TEXT,
             roast        TEXT,
             roast_line   TEXT,
             hidden       INTEGER NOT NULL DEFAULT 0,
             scanned_at   INTEGER NOT NULL
           )`,
          `CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(final_score DESC)`,
          // Leaderboard & sitemap all filter `hidden = 0 AND final_score >= ?`,
          // so a composite index lets one seek cover both conditions.
          `CREATE INDEX IF NOT EXISTS idx_scores_hidden_score
             ON scores(hidden, final_score DESC)`,
          `CREATE TABLE IF NOT EXISTS score_snapshots (
             id            TEXT PRIMARY KEY,
             username      TEXT NOT NULL,
             display_name  TEXT,
             avatar_url    TEXT,
             profile_url   TEXT,
             final_score   REAL NOT NULL,
             tier          TEXT NOT NULL,
             tags          TEXT,
             roast_line    TEXT,
             bot_score     REAL,
             sub_scores    TEXT,
             score_version TEXT NOT NULL,
             roast_version TEXT NOT NULL,
             roast_lang    TEXT NOT NULL CHECK(roast_lang IN ('zh', 'en')),
             generated_at  INTEGER NOT NULL
           )`,
          `CREATE INDEX IF NOT EXISTS idx_score_snapshots_username_generated
             ON score_snapshots(username, generated_at DESC)`,
          // Raw developer-profile snapshots — the data moat. The full scan
          // (repos w/ topics + language breakdown, contributed repos, metrics,
          // pinned, orgs) is otherwise only cached in Redis for 24h. This is a
          // slow-path archive, decoupled from the leaderboard hot-path `scores`
          // table, so domain classification can be (re)derived later without
          // re-crawling GitHub. JSON columns: cheap to write, denormalized into
          // a developer⟷repo graph in a later phase if needed.
          `CREATE TABLE IF NOT EXISTS profile_snapshots (
             id            TEXT PRIMARY KEY,
             username      TEXT NOT NULL,
             scanned_at    INTEGER NOT NULL,
             top_repos     TEXT,
             impact_repos  TEXT,
             verified_prs  TEXT,
             metrics       TEXT,
             pinned_repos  TEXT,
             organizations TEXT,
             scan_version  TEXT
           )`,
          `CREATE INDEX IF NOT EXISTS idx_profile_snapshots_username_scanned
             ON profile_snapshots(username, scanned_at DESC)`,
          `CREATE TABLE IF NOT EXISTS github_contribution_days (
             username           TEXT NOT NULL,
             contribution_date  TEXT NOT NULL,
             contribution_count INTEGER NOT NULL,
             scanned_at         INTEGER NOT NULL,
             source             TEXT NOT NULL DEFAULT 'github_commit_contributions',
             PRIMARY KEY(username, contribution_date)
           )`,
          `CREATE INDEX IF NOT EXISTS idx_github_contribution_days_date
             ON github_contribution_days(contribution_date DESC)`,
          // Legacy: AI-generated anonymous danmaku for the detail page. The
          // feature was removed; this table is no longer read or written and is
          // kept only so existing databases (which may hold rows) stay valid.
          `CREATE TABLE IF NOT EXISTS profile_danmaku (
             username   TEXT PRIMARY KEY,
             lines      TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             version    TEXT
           )`,
          `CREATE TABLE IF NOT EXISTS account_stats (
             username        TEXT PRIMARY KEY,
             lookup_count    INTEGER NOT NULL DEFAULT 0,
             first_lookup_at INTEGER NOT NULL,
             last_lookup_at  INTEGER NOT NULL
           )`,
          `CREATE INDEX IF NOT EXISTS idx_account_stats_heat
             ON account_stats(lookup_count DESC)`,
          `CREATE TABLE IF NOT EXISTS account_lookup_limits (
             username        TEXT NOT NULL,
             ip_hash         TEXT NOT NULL,
             last_counted_at INTEGER NOT NULL,
             PRIMARY KEY (username, ip_hash)
           )`,
          `CREATE INDEX IF NOT EXISTS idx_account_lookup_limits_last_counted
             ON account_lookup_limits(last_counted_at)`,
          // Covering index for the windowed-heat subquery
          // (WHERE last_counted_at >= ? GROUP BY username): both columns live in
          // the index so the per-window unique-visitor count is computed
          // index-only, without touching the table.
          `CREATE INDEX IF NOT EXISTS idx_account_lookup_limits_counted_user
             ON account_lookup_limits(last_counted_at, username)`,
          // Logged-in users (GitHub OAuth). Identity only for now; the lowercased
          // `login` lets us later link a user to their own `scores` row + comments.
          `CREATE TABLE IF NOT EXISTS users (
             github_id   INTEGER PRIMARY KEY,
             login       TEXT NOT NULL,
             name        TEXT,
             avatar_url  TEXT,
             created_at  INTEGER NOT NULL,
             last_login  INTEGER NOT NULL
           )`,
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login ON users(login)`,
          `CREATE TABLE IF NOT EXISTS inbox_messages (
             id                  TEXT PRIMARY KEY,
             recipient_github_id INTEGER NOT NULL,
             recipient_login     TEXT NOT NULL,
             sender_kind         TEXT NOT NULL CHECK(sender_kind IN ('system', 'user')),
             sender_github_id    INTEGER,
             sender_login        TEXT,
             title               TEXT NOT NULL,
             body                TEXT NOT NULL,
             action_href         TEXT,
             read_at             INTEGER,
             created_at          INTEGER NOT NULL,
             FOREIGN KEY (recipient_github_id) REFERENCES users(github_id) ON DELETE CASCADE
           )`,
          `CREATE INDEX IF NOT EXISTS idx_inbox_messages_recipient_created
             ON inbox_messages(recipient_github_id, created_at DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_inbox_messages_recipient_read
             ON inbox_messages(recipient_github_id, read_at)`,
          `CREATE TABLE IF NOT EXISTS growth_scan_subscriptions (
             github_id       INTEGER PRIMARY KEY,
             login           TEXT NOT NULL,
             status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
             created_at      INTEGER NOT NULL,
             updated_at      INTEGER NOT NULL,
             last_scanned_at INTEGER,
             last_error      TEXT,
             FOREIGN KEY (github_id) REFERENCES users(github_id) ON DELETE CASCADE
           )`,
          `CREATE INDEX IF NOT EXISTS idx_growth_scan_subscriptions_due
             ON growth_scan_subscriptions(status, last_scanned_at)`,
          `CREATE TABLE IF NOT EXISTS project_scores (
             full_name         TEXT PRIMARY KEY,
             owner             TEXT NOT NULL,
             repo              TEXT NOT NULL,
             html_url          TEXT NOT NULL,
             owner_avatar_url  TEXT,
             description       TEXT,
             homepage          TEXT,
             language          TEXT,
             topics            TEXT,
             license           TEXT,
             stars             INTEGER NOT NULL DEFAULT 0,
             forks             INTEGER NOT NULL DEFAULT 0,
             watchers          INTEGER NOT NULL DEFAULT 0,
             open_issues       INTEGER NOT NULL DEFAULT 0,
             size              INTEGER NOT NULL DEFAULT 0,
             default_branch    TEXT,
             created_at_iso    TEXT,
             pushed_at_iso     TEXT,
             latest_release_at TEXT,
             score             REAL NOT NULL,
             band              TEXT NOT NULL,
             breakdown         TEXT NOT NULL,
             roast_line        TEXT NOT NULL,
             readme            TEXT,
             languages         TEXT,
             scanned_at        INTEGER NOT NULL
           )`,
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_project_scores_owner_repo
             ON project_scores(owner, repo)`,
          `CREATE INDEX IF NOT EXISTS idx_project_scores_score
             ON project_scores(score DESC, scanned_at DESC)`,
          `CREATE TABLE IF NOT EXISTS project_snapshots (
             id           TEXT PRIMARY KEY,
             full_name    TEXT NOT NULL,
             owner        TEXT NOT NULL,
             repo         TEXT NOT NULL,
             scanned_at   INTEGER NOT NULL,
             project_json TEXT NOT NULL,
             contributors TEXT NOT NULL
           )`,
          `CREATE INDEX IF NOT EXISTS idx_project_snapshots_project_scanned
             ON project_snapshots(full_name, scanned_at DESC)`,
          `CREATE TABLE IF NOT EXISTS project_contributors (
             full_name     TEXT NOT NULL,
             owner         TEXT NOT NULL,
             repo          TEXT NOT NULL,
             login         TEXT NOT NULL,
             avatar_url    TEXT,
             html_url      TEXT,
             contributions INTEGER NOT NULL DEFAULT 0,
             role          TEXT NOT NULL DEFAULT 'contributor',
             scanned_at    INTEGER NOT NULL,
             PRIMARY KEY(full_name, login)
           )`,
          `CREATE INDEX IF NOT EXISTS idx_project_contributors_project_contrib
             ON project_contributors(full_name, contributions DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_project_contributors_login
             ON project_contributors(login)`,
          `CREATE TABLE IF NOT EXISTS project_scan_jobs (
             id          TEXT PRIMARY KEY,
             full_name   TEXT NOT NULL,
             status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed')),
             created_at  INTEGER NOT NULL,
             updated_at  INTEGER NOT NULL,
             last_error  TEXT
           )`,
          `CREATE INDEX IF NOT EXISTS idx_project_scan_jobs_status
             ON project_scan_jobs(status, created_at)`,
          `CREATE TABLE IF NOT EXISTS profile_comments (
             id                TEXT PRIMARY KEY,
             target_username   TEXT NOT NULL,
             body              TEXT NOT NULL,
             author_kind       TEXT NOT NULL,
             author_github_id  INTEGER,
             author_login      TEXT,
             author_avatar_url TEXT,
             hidden            INTEGER NOT NULL DEFAULT 0,
             created_at        INTEGER NOT NULL
           )`,
          `CREATE INDEX IF NOT EXISTS idx_profile_comments_target_created
             ON profile_comments(target_username, created_at DESC)`,
          `CREATE TABLE IF NOT EXISTS profile_reactions (
             target_username  TEXT NOT NULL,
             voter_github_id  INTEGER NOT NULL,
             voter_login      TEXT NOT NULL,
             reaction         TEXT NOT NULL,
             created_at       INTEGER NOT NULL,
             updated_at       INTEGER NOT NULL,
             PRIMARY KEY (target_username, voter_github_id)
           )`,
          `CREATE INDEX IF NOT EXISTS idx_profile_reactions_target_reaction
             ON profile_reactions(target_username, reaction)`,
          // Discovery facets — the queryable classification layer for the
          // /developers directory. Derived from profile_snapshots (the data moat)
          // by lib/facets.ts: one row per (developer, facet). facet_type is
          // 'language' | 'org'; facet_value is the bucket ("Rust", "huggingface").
          // weight lets us pick a dev's primary language later. Rewritten wholesale
          // per developer on each new scan, so it self-heals as scores refresh.
          `CREATE TABLE IF NOT EXISTS developer_facets (
             username    TEXT NOT NULL,
             facet_type  TEXT NOT NULL,
             facet_value TEXT NOT NULL,
             weight      REAL NOT NULL DEFAULT 0,
             PRIMARY KEY (username, facet_type, facet_value)
           )`,
          // Serves the two directory reads index-first: the per-bucket developer
          // list (WHERE facet_type = ? AND facet_value = ?) seeks straight to a
          // bucket, and the category counts (GROUP BY facet_value) scan one
          // contiguous range per type.
          `CREATE INDEX IF NOT EXISTS idx_developer_facets_lookup
             ON developer_facets(facet_type, facet_value, username)`,
          // PK (versus) matchups — one row per canonical (lowercased, sorted)
          // pair. Holds the deterministic result plus the cached bilingual LLM
          // verdict + self-improvement advice (JSON {zh,en}); feeds the /vs page,
          // the profile "battles" section, the trending board, and the sitemap.
          `CREATE TABLE IF NOT EXISTS vs_matchups (
             handle_a       TEXT NOT NULL,
             handle_b       TEXT NOT NULL,
             winner         TEXT,
             bucket         TEXT NOT NULL,
             gap            REAL NOT NULL,
             score_a        REAL NOT NULL,
             score_b        REAL NOT NULL,
             verdict        TEXT,
             advice         TEXT,
             verdict_source TEXT,
             view_count     INTEGER NOT NULL DEFAULT 0,
             created_at     INTEGER NOT NULL,
             updated_at     INTEGER NOT NULL,
             PRIMARY KEY (handle_a, handle_b)
           )`,
          `CREATE INDEX IF NOT EXISTS idx_vs_matchups_a ON vs_matchups(handle_a, updated_at DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_vs_matchups_b ON vs_matchups(handle_b, updated_at DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_vs_matchups_hot ON vs_matchups(view_count DESC)`,
          // Community profiles — privacy-first opt-in social layer. Users must
          // explicitly claim their developer identity and join the community circle.
          // Stores bilingual user-provided content (working_on, want_to_meet, etc.)
          // and optional AI-generated community card. Separate from users table to
          // clearly distinguish auth identity from social profile.
          `CREATE TABLE IF NOT EXISTS community_profiles (
             github_id         INTEGER PRIMARY KEY,
             login             TEXT NOT NULL,
             status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'inactive')),
             visibility        TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
             working_on        TEXT,
             want_to_meet      TEXT,
             contact_method    TEXT,
             chat_topics       TEXT,
             no_recommend_for  TEXT,
             ai_card           TEXT,
             ai_card_approved  INTEGER NOT NULL DEFAULT 0,
             joined_at         INTEGER NOT NULL,
             updated_at        INTEGER NOT NULL,
             FOREIGN KEY (github_id) REFERENCES users(github_id) ON DELETE CASCADE
           )`,
          `CREATE INDEX IF NOT EXISTS idx_community_profiles_status
             ON community_profiles(status, visibility)`,
          `CREATE INDEX IF NOT EXISTS idx_community_profiles_login
             ON community_profiles(login)`,
          // Email-based circle subscriptions. This is separate from GitHub auth:
          // users can opt in during a roast without granting OAuth access. Email
          // is stored because it is needed to send recommendations; email_hash is
          // the stable primary key used for dedupe and notification logs.
          `CREATE TABLE IF NOT EXISTS circle_email_subscriptions (
             email_hash          TEXT PRIMARY KEY,
             email               TEXT NOT NULL,
             username            TEXT NOT NULL,
             status              TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'unsubscribed')),
             source              TEXT NOT NULL DEFAULT 'roast',
             consent_version     TEXT NOT NULL,
             created_at          INTEGER NOT NULL,
             updated_at          INTEGER NOT NULL,
             last_recommended_at INTEGER
           )`,
          `CREATE INDEX IF NOT EXISTS idx_circle_email_subscriptions_username
             ON circle_email_subscriptions(username, status)`,
          `CREATE TABLE IF NOT EXISTS circle_email_recommendation_logs (
             email_hash TEXT NOT NULL,
             match_login TEXT NOT NULL,
             sent_at INTEGER NOT NULL,
             PRIMARY KEY (email_hash, match_login)
           )`,
          // Community galaxy domains — the "planet" waterfall on /community. A
          // domain is a facet-derived (Phase 1) or AI-merged (Phase 2) people
          // bucket: "top Rust developers", "huggingface org", etc. Rebuilt
          // wholesale by the domain-rebuild backfill from developer_facets +
          // community_profiles, so it self-heals as scores/facets refresh.
          // `source` records provenance; `slug` is a URL-safe canonical key
          // derived from "type:value" so a rebuild is idempotent.
          `CREATE TABLE IF NOT EXISTS circle_domains (
             slug          TEXT PRIMARY KEY,
             name_zh       TEXT NOT NULL,
             name_en       TEXT,
             description_zh TEXT,
             description_en TEXT,
             source        TEXT NOT NULL DEFAULT 'facet' CHECK(source IN ('facet', 'ai', 'admin')),
             status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden')),
             member_count  INTEGER NOT NULL DEFAULT 0,
             heat_score    REAL NOT NULL DEFAULT 0,
             created_at    INTEGER NOT NULL,
             updated_at    INTEGER NOT NULL
           )`,
          // Waterfall ordering: active domains sorted by heat then size. One
          // seek covers the WHERE status = 'active' ORDER BY heat_score DESC read.
          `CREATE INDEX IF NOT EXISTS idx_circle_domains_active_heat
             ON circle_domains(status, heat_score DESC, member_count DESC)`,
          // Which community members belong to a domain, with a per-member weight
          // (facet share / AI confidence) and an optional bilingual match reason.
          // (domain_slug, login) is the PK; the reverse index serves "which
          // domains is this user in" for the future profile view.
          `CREATE TABLE IF NOT EXISTS circle_domain_members (
             domain_slug TEXT NOT NULL,
             login       TEXT NOT NULL,
             weight      REAL NOT NULL DEFAULT 0,
             reason_zh   TEXT,
             reason_en   TEXT,
             created_at  INTEGER NOT NULL,
             updated_at  INTEGER NOT NULL,
             PRIMARY KEY(domain_slug, login)
           )`,
          `CREATE INDEX IF NOT EXISTS idx_circle_domain_members_domain_weight
             ON circle_domain_members(domain_slug, weight DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_circle_domain_members_login
             ON circle_domain_members(login)`,
          // Domain-to-domain relations for future cross-domain navigation and the
          // galaxy graph. Written by the AI merge phase; unused by the Phase A read
          // path but created up front so the schema is stable.
          `CREATE TABLE IF NOT EXISTS circle_domain_edges (
             from_slug  TEXT NOT NULL,
             to_slug    TEXT NOT NULL,
             weight     REAL NOT NULL DEFAULT 0,
             reason     TEXT,
             updated_at INTEGER NOT NULL,
             PRIMARY KEY(from_slug, to_slug)
           )`,
        ],
        "write",
      );
      // Migrations for tables created before these columns existed.
      // `roast` holds the Chinese report; `roast_en` the English one.
      for (const col of [
        "tags TEXT",
        "bot_score REAL",
        "sub_scores TEXT",
        "roast TEXT",
        "roast_en TEXT",
        // Bilingual one-liner {zh,en} JSON — generated in one LLM call so the
        // roast shows in the visitor's language regardless of report language.
        "roast_line TEXT",
        "score_version TEXT",
        "roast_version TEXT",
        "roast_en_version TEXT",
        // Previous scan's score + timestamp, kept for the 进步榜 (progress board).
        // Populated by recordScore on a genuinely later re-scan; NULL until then.
        "prev_score REAL",
        "prev_scanned_at INTEGER",
      ]) {
        try {
          await db.execute(`ALTER TABLE scores ADD COLUMN ${col}`);
        } catch {
          // column already exists — ignore
        }
      }
      try {
        await db.execute(
          `ALTER TABLE circle_email_subscriptions ADD COLUMN unsubscribe_token TEXT`,
        );
      } catch {
        // column already exists — ignore
      }
    })().catch((e) => {
      schemaReady = null; // allow retry on next call
      throw e;
    });
  }
  return schemaReady;
}

export interface ScoreEntry {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  final_score: number;
  tier: Tier;
  tags: Tags;
  /** Bilingual savage one-liner {zh,en}; shown in the visitor's language. */
  roast_line: RoastLine;
  /** Hidden 0-10 spam-PR / bot likelihood — stored, never returned to clients. */
  bot_score: number;
  /** Per-dimension breakdown — persisted for "similar developers" matching. */
  sub_scores: SubScores;
  scanned_at: number;
}

export interface LeaderboardEntry {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  final_score: number;
  tier: Tier;
  tags: Tags;
  lookup_count: number;
  recent_lookup_count: number;
  trending_score: number;
  /** Previous recorded score — only set on the 进步榜 (progress) board. */
  prev_score?: number;
  /** final_score - prev_score — only set on the 进步榜 (progress) board. */
  delta?: number;
}

export interface GrowthLeaderboardEntry {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  final_score: number;
  tier: Tier;
  contribution_delta: number;
  merged_pr_delta: number;
  impact_commit_delta: number;
  growth_score: number;
  latest_snapshot_at: number;
  previous_snapshot_at: number | null;
}

/**
 * Count one successful public lookup for a GitHub account.
 *
 * Returns true only when the lookup changed the public heat value. Repeated
 * successful scans for the same account from the same IP hash inside 24 hours
 * are accepted by the app, but do not increment leaderboard heat.
 */
export async function recordAccountLookup(username: string, ip: string): Promise<boolean> {
  const db = getClient();
  if (!db) return false;
  const normalizedUsername = username.toLowerCase();
  const ipHash = heatIpHash(ip);
  // Redis shield in front of the Turso write transaction: repeats of the same
  // (username, ip) inside the window are answered by one Redis call instead of
  // holding a Turso connection. Turso's own gate below stays the source of
  // truth (covers Redis-unconfigured/flushed cases); the Redis key is kept even
  // when Turso declines, which can delay a re-count by up to one extra window
  // after a Redis flush — fine for a best-effort heat counter.
  const gateKey = `heat:gate:${normalizedUsername}:${ipHash}`;
  if (!(await tryAcquireLookupGate(gateKey, HEAT_LOOKUP_WINDOW_MS / 1000))) {
    return false;
  }
  try {
    await ensureSchema(db);
    const now = Date.now();
    const tx = await db.transaction("write");
    try {
      const gate = await tx.execute({
        sql: `INSERT INTO account_lookup_limits (username, ip_hash, last_counted_at)
              VALUES (?, ?, ?)
              ON CONFLICT(username, ip_hash) DO UPDATE SET
                last_counted_at = excluded.last_counted_at
              WHERE account_lookup_limits.last_counted_at <= ?
              RETURNING last_counted_at`,
        args: [
          normalizedUsername,
          ipHash,
          now,
          now - HEAT_LOOKUP_WINDOW_MS,
        ],
      });
      if (gate.rows.length === 0) {
        await tx.rollback();
        return false;
      }
      await tx.execute({
        sql: `INSERT INTO account_stats (username, lookup_count, first_lookup_at, last_lookup_at)
              VALUES (?, 1, ?, ?)
              ON CONFLICT(username) DO UPDATE SET
                lookup_count   = account_stats.lookup_count + 1,
                last_lookup_at = excluded.last_lookup_at`,
        args: [normalizedUsername, now, now],
      });
      await tx.commit();
      return true;
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  } catch (e) {
    // Give the count back: a failed Turso write must not suppress this pair's
    // heat for a whole window.
    await releaseLookupGate(gateKey);
    console.error("recordAccountLookup failed:", e);
    return false;
  }
}

/** Upsert an account's latest score. Best-effort; never throws to the caller. */
export async function recordScore(entry: ScoreEntry): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    const username = entry.username.toLowerCase();
    await db.execute({
      sql: `INSERT INTO scores
              (username, display_name, avatar_url, profile_url, final_score, tier, tags, roast_line, score_version, bot_score, sub_scores, scanned_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
              prev_score      = CASE WHEN excluded.scanned_at - scores.scanned_at >= ?
                                     THEN scores.final_score ELSE scores.prev_score END,
              prev_scanned_at = CASE WHEN excluded.scanned_at - scores.scanned_at >= ?
                                     THEN scores.scanned_at ELSE scores.prev_scanned_at END,
              display_name = excluded.display_name,
              avatar_url   = excluded.avatar_url,
              profile_url  = excluded.profile_url,
              final_score  = excluded.final_score,
              tier         = excluded.tier,
              tags         = excluded.tags,
              roast_line   = excluded.roast_line,
              score_version = excluded.score_version,
              bot_score    = excluded.bot_score,
              sub_scores   = excluded.sub_scores,
              scanned_at   = excluded.scanned_at`,
      args: [
        username,
        entry.display_name,
        entry.avatar_url,
        entry.profile_url,
        entry.final_score,
        entry.tier,
        JSON.stringify(entry.tags ?? EMPTY_TAGS),
        JSON.stringify(entry.roast_line ?? EMPTY_ROAST_LINE),
        SCORE_CACHE_VERSION,
        entry.bot_score,
        JSON.stringify(entry.sub_scores),
        entry.scanned_at,
        PROGRESS_MIN_GAP_MS,
        PROGRESS_MIN_GAP_MS,
      ],
    });
    await db.execute({
      sql: `INSERT INTO account_stats (username, lookup_count, first_lookup_at, last_lookup_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
              lookup_count = MAX(account_stats.lookup_count, excluded.lookup_count)`,
      args: [username, MIN_RECORDED_LOOKUP_COUNT, entry.scanned_at, entry.scanned_at],
    });
  } catch (e) {
    console.error("recordScore failed:", e);
  }
}

/**
 * Persist a raw developer-profile snapshot — the data moat. Stores the full scan
 * (repos with topics + language breakdown, contributed repos, verified-impact PRs
 * with file paths, the complete metrics blob, pinned repos, orgs) that otherwise
 * lives only in the 24h Redis cache. Append-only: one row per scan, so the
 * profile history is preserved for later domain classification / analysis.
 *
 * Fire-and-forget: any failure is logged and swallowed so it never blocks the
 * scoring/roast flow (mirrors {@link recordScore} / {@link updateRoast}).
 */
export async function recordProfileSnapshot(
  scan: ScanResult,
  options: ProfileSnapshotOptions = {},
): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    const username = scan.metrics.username.toLowerCase();
    const scannedAt = Date.now();
    await db.execute({
      sql: `INSERT INTO profile_snapshots
              (id, username, scanned_at, top_repos, impact_repos, verified_prs,
               metrics, pinned_repos, organizations, scan_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        username,
        scannedAt,
        JSON.stringify(scan.top_repos ?? []),
        JSON.stringify(scan.impact_repos ?? []),
        JSON.stringify(scan.verified_impact_prs ?? []),
        JSON.stringify(scan.metrics),
        JSON.stringify(scan.pinned_repos ?? []),
        JSON.stringify(scan.organizations ?? []),
        SCORE_CACHE_VERSION,
      ],
    });
    if (Array.isArray(scan.contribution_days)) {
      const contributionDays = scan.contribution_days.filter(
        (day) =>
          /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
          Number.isFinite(day.contribution_count) &&
          day.contribution_count > 0,
      );
      const growthFinalScore = options.growthFinalScore ?? scan.scoring.final_score;
      if (isGrowthEligible(scan, contributionDays, growthFinalScore, scannedAt)) {
        for (const day of contributionDays) {
          await db.execute({
            sql: `INSERT INTO github_contribution_days
                    (username, contribution_date, contribution_count, scanned_at, source)
                  VALUES (?, ?, ?, ?, 'github_commit_contributions')
                  ON CONFLICT(username, contribution_date) DO UPDATE SET
                    contribution_count = excluded.contribution_count,
                    scanned_at = MAX(github_contribution_days.scanned_at, excluded.scanned_at),
                    source = excluded.source`,
            args: [
              username,
              day.date,
              Math.max(0, Math.floor(day.contribution_count)),
              scannedAt,
            ],
          });
        }
      } else {
        await db.execute({
          sql: `DELETE FROM github_contribution_days WHERE username = ?`,
          args: [username],
        });
      }
    }
    // Derive + persist the discovery facets from the same scan, so every path
    // that sediments a snapshot also refreshes the /developers directory. Kept
    // inside the same best-effort try (independent statement — a facet failure is
    // logged and swallowed just like the snapshot write).
    await recordDeveloperFacets(
      username,
      extractFacets({
        top_repos: scan.top_repos,
        organizations: scan.organizations,
        impact_repos: scan.impact_repos,
      }),
    );
  } catch (e) {
    console.error("recordProfileSnapshot failed:", e);
  }
}

/** Hard cap on how many developers any one directory bucket returns. The reader
 *  only ever wants the head of a language/org, and a bounded LIMIT keeps the
 *  query (and its cached payload) cheap no matter how large a bucket grows. */
export const DEVELOPERS_PER_FACET_LIMIT = 250;
/** Public floor for the directory — mirrors the leaderboard/sitemap index floor
 *  so "top Rust developers" means the same calibre as the main boards. */
const FACET_MIN_SCORE = 60;

/**
 * Replace a developer's facet rows wholesale (delete-then-insert in one
 * transaction) so a re-scan can't leave stale buckets behind — e.g. a dev who
 * dropped a language keeps no phantom row. No-op without Turso; best-effort like
 * the rest of this module. Called from {@link recordProfileSnapshot} and the
 * facet backfill.
 */
export async function recordDeveloperFacets(
  username: string,
  facets: { type: FacetType; value: string; weight: number }[],
): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    const normalized = username.toLowerCase();
    // One atomic round trip: batch() runs the delete + all inserts in a single
    // implicit transaction. This replaces a multi-statement transaction() whose
    // per-statement round trips made bulk backfill (and every scan's facet write)
    // needlessly slow against a high-latency remote DB.
    await db.batch(
      [
        {
          sql: `DELETE FROM developer_facets WHERE username = ?`,
          args: [normalized],
        },
        ...facets.map((f) => ({
          sql: `INSERT OR REPLACE INTO developer_facets
                  (username, facet_type, facet_value, weight)
                VALUES (?, ?, ?, ?)`,
          args: [normalized, f.type, f.value, f.weight] as (string | number)[],
        })),
      ],
      "write",
    );
  } catch (e) {
    console.error("recordDeveloperFacets failed:", e);
  }
}

/** True if any profile snapshot already exists for this account — lets the
 * head-user backfill skip accounts it has already sedimented (resumable). */
export async function hasProfileSnapshot(username: string): Promise<boolean> {
  const db = getClient();
  if (!db) return false;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT 1 FROM profile_snapshots WHERE username = ? LIMIT 1`,
      args: [username.toLowerCase()],
    });
    return res.rows.length > 0;
  } catch (e) {
    console.error("hasProfileSnapshot failed:", e);
    return false;
  }
}

/** Numeric metrics pulled out of the stored `metrics` blob for the specialty
 * "brag cards" (contributor / PR / trajectory / signature-work). All coerced to
 * safe numbers so a card never renders `NaN` for a scan cached before a field
 * existed. */
export interface ProfileCardMetrics {
  account_age_years: number;
  created_at: string | null;
  followers: number;
  public_repos: number;
  total_stars: number;
  max_stars: number;
  original_repo_count: number;
  merged_pr_count: number;
  impact_pr_count: number;
  verified_impact_pr_count: number;
  core_impact_pr_count: number;
  impact_repo_count: number;
  max_impact_repo_stars: number;
  last_year_contributions: number;
  contribution_years_active: number;
}

/** Parsed view of the latest profile snapshot, for the detail page's evidence
 * blocks (contributions, featured work, stack, orgs). Read-only/slow path —
 * decoupled from the lean `getAccountDetail` hot read. */
export interface ProfileSnapshotView {
  top_repos: TopRepo[];
  impact_repos: ImpactRepo[];
  pinned_repos: string[];
  organizations: string[];
  bio: string | null;
  company: string | null;
  metrics: ProfileCardMetrics;
  scanned_at: number;
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** Latest sedimented profile snapshot for an account, or null if none exists
 * (low-score/old accounts never backfilled). Fire-and-forget tolerant. */
export async function getProfileSnapshot(
  username: string,
): Promise<ProfileSnapshotView | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT top_repos, impact_repos, pinned_repos, organizations, metrics, scanned_at
            FROM profile_snapshots
            WHERE username = ?
            ORDER BY scanned_at DESC
            LIMIT 1`,
      args: [username.toLowerCase()],
    });
    const r = res.rows[0];
    if (!r) return null;
    let bio: string | null = null;
    let company: string | null = null;
    let m: Record<string, unknown> = {};
    try {
      m = JSON.parse((r.metrics as string) || "{}") as Record<string, unknown>;
      bio = typeof m.bio === "string" && m.bio ? m.bio : null;
      company = typeof m.company === "string" && m.company ? m.company : null;
    } catch {
      // leave bio/company null, metrics blank
    }
    const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const metrics: ProfileCardMetrics = {
      account_age_years: num(m.account_age_years),
      created_at: typeof m.created_at === "string" ? m.created_at : null,
      followers: num(m.followers),
      public_repos: num(m.public_repos),
      total_stars: num(m.total_stars),
      max_stars: num(m.max_stars),
      original_repo_count: num(m.original_repo_count),
      merged_pr_count: num(m.merged_pr_count),
      impact_pr_count: num(m.impact_pr_count),
      verified_impact_pr_count: num(m.verified_impact_pr_count),
      core_impact_pr_count: num(m.core_impact_pr_count),
      impact_repo_count: num(m.impact_repo_count),
      max_impact_repo_stars: num(m.max_impact_repo_stars),
      last_year_contributions: num(m.last_year_contributions),
      contribution_years_active: num(m.contribution_years_active),
    };
    return {
      top_repos: parseJsonArray<TopRepo>(r.top_repos),
      impact_repos: parseJsonArray<ImpactRepo>(r.impact_repos),
      pinned_repos: parseJsonArray<string>(r.pinned_repos),
      organizations: parseJsonArray<string>(r.organizations),
      bio,
      company,
      metrics,
      scanned_at: Number(r.scanned_at),
    };
  } catch (e) {
    console.error("getProfileSnapshot failed:", e);
    return null;
  }
}

/**
 * Distinct usernames that have at least one profile snapshot, paginated for the
 * facet backfill. `profile_snapshots` is append-only (many rows per user), so
 * DISTINCT collapses to one per account; ordering by username keeps offset-based
 * batches stable across calls. Returns [] without Turso.
 */
export async function listSnapshotUsernames(
  limit = 500,
  offset = 0,
): Promise<string[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT DISTINCT username FROM profile_snapshots
            ORDER BY username
            LIMIT ? OFFSET ?`,
      args: [Math.max(1, Math.min(2000, limit)), Math.max(0, offset)],
    });
    return res.rows.map((r) => String(r.username));
  } catch (e) {
    console.error("listSnapshotUsernames failed:", e);
    return [];
  }
}

/**
 * Attach the finished roast markdown to an account row. Called after the LLM
 * stream completes (the full text isn't known at {@link recordScore} time, which
 * runs before streaming so the percentile reflects this scan). No-op if the row
 * doesn't exist yet (e.g. a BYO-key roast that was never recorded).
 */
export async function updateRoast(username: string, roast: string, lang: Lang): Promise<void> {
  const db = getClient();
  if (!db) return;
  // Column name comes from a fixed allowlist (never from user input).
  const col = lang === "en" ? "roast_en" : "roast";
  const versionCol = lang === "en" ? "roast_en_version" : "roast_version";
  try {
    await ensureSchema(db);
    const normalizedUsername = username.toLowerCase();
    const generatedAt = Date.now();
    await db.execute({
      sql: `UPDATE scores SET ${col} = ?, ${versionCol} = ? WHERE username = ?`,
      args: [roast, ROAST_CACHE_VERSION, normalizedUsername],
    });
    await db.execute({
      sql: `INSERT INTO score_snapshots
              (id, username, display_name, avatar_url, profile_url, final_score, tier,
               tags, roast_line, score_version, roast_version, roast_lang, bot_score,
               sub_scores, generated_at)
            SELECT ?, username, display_name, avatar_url, profile_url, final_score, tier,
                   tags, roast_line, COALESCE(score_version, ?), ?, ?, bot_score,
                   sub_scores, ?
            FROM scores
            WHERE username = ?`,
      args: [
        randomUUID(),
        SCORE_CACHE_VERSION,
        ROAST_CACHE_VERSION,
        lang,
        generatedAt,
        normalizedUsername,
      ],
    });
  } catch (e) {
    console.error("updateRoast failed:", e);
  }
}

/** Counts for percentile: accounts strictly below `score`, and the total. */
export async function getPercentile(
  score: number,
): Promise<{ below: number; total: number } | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM scores WHERE final_score < ?) AS below,
              (SELECT COUNT(*) FROM scores) AS total`,
      args: [score],
    });
    const row = res.rows[0];
    if (!row) return null;
    const counts = { below: Number(row.below), total: Number(row.total) };
    return counts.total > 0 ? counts : null;
  } catch (e) {
    console.error("getPercentile failed:", e);
    return null;
  }
}

/**
 * Global score ranking for `score`: `rank` (1-based, by `final_score` desc),
 * `total` ranked accounts, and `below` (accounts scoring strictly lower).
 *
 * Excludes hidden accounts so the rank lines up with what the score leaderboard
 * shows. `rank` = (accounts scoring strictly higher) + 1. Returns null when there
 * is no one to compare against (≤1 ranked account), matching `beatPercent`.
 */
export async function getRank(
  score: number,
): Promise<{ rank: number; total: number; below: number } | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT
              SUM(CASE WHEN final_score > ? THEN 1 ELSE 0 END) AS above,
              SUM(CASE WHEN final_score < ? THEN 1 ELSE 0 END) AS below,
              COUNT(*) AS total
            FROM scores WHERE hidden = 0`,
      args: [score, score],
    });
    const row = res.rows[0];
    if (!row) return null;
    const total = Number(row.total);
    if (total <= 1) return null;
    return { rank: Number(row.above) + 1, total, below: Number(row.below) };
  } catch (e) {
    console.error("getRank failed:", e);
    return null;
  }
}

export interface FacetRank {
  facetType: FacetType;
  /** The bucket value, e.g. "Rust" — also the display string and URL segment. */
  facetValue: string;
  /** 1-based position within the bucket (ties share, mirroring {@link getRank}). */
  rank: number;
  total: number;
  /** The developer immediately above — powers the "上一位 @x →" hook. */
  ahead: { username: string; final_score: number } | null;
}

/**
 * Where `username` ranks inside their strongest language bucket on the
 * /developers directory — the "you're #12 on the Rust board, one spot behind
 * @yyy" hook that turns a profile into a transit station.
 *
 * Uses the dev's highest-weight `language` facet and the exact same filters as
 * {@link getDevelopersByFacet} (hidden = 0, final_score ≥ FACET_MIN_SCORE) so the
 * rank matches the board the link lands on. Returns null when the dev has no
 * language facet, is below the directory floor, or the bucket has ≤1 ranked dev.
 * Every join is an index seek via idx_developer_facets_lookup. Best-effort like
 * the rest of this module.
 */
export async function getFacetRank(
  username: string,
  score: number,
): Promise<FacetRank | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const uname = username.toLowerCase();
    // The dev's primary language (the directory only ranks devs above the floor,
    // so a below-floor dev has no meaningful position to show).
    if (score < FACET_MIN_SCORE) return null;
    const topRes = await db.execute({
      sql: `SELECT facet_value FROM developer_facets
            WHERE username = ? AND facet_type = 'language'
            ORDER BY weight DESC LIMIT 1`,
      args: [uname],
    });
    const facetValue = topRes.rows[0]?.facet_value;
    if (typeof facetValue !== "string" || !facetValue) return null;
    // rank + total, and the nearest dev above, in one round trip.
    const [rankRes, aheadRes] = await db.batch(
      [
        {
          sql: `SELECT
                  SUM(CASE WHEN s.final_score > ? THEN 1 ELSE 0 END) AS above,
                  COUNT(*) AS total
                FROM developer_facets AS f
                JOIN scores AS s ON s.username = f.username
                WHERE f.facet_type = 'language'
                  AND f.facet_value = ?
                  AND s.hidden = 0
                  AND s.final_score >= ?`,
          args: [score, facetValue, FACET_MIN_SCORE],
        },
        {
          sql: `SELECT s.username, s.final_score
                FROM developer_facets AS f
                JOIN scores AS s ON s.username = f.username
                WHERE f.facet_type = 'language'
                  AND f.facet_value = ?
                  AND s.hidden = 0
                  AND s.final_score > ?
                ORDER BY s.final_score ASC
                LIMIT 1`,
          args: [facetValue, score],
        },
      ],
      "read",
    );
    const row = rankRes.rows[0];
    if (!row) return null;
    const total = Number(row.total);
    if (total <= 1) return null;
    const aheadRow = aheadRes.rows[0];
    return {
      facetType: "language",
      facetValue,
      rank: Number(row.above) + 1,
      total,
      ahead: aheadRow
        ? {
            username: String(aheadRow.username),
            final_score: Number(aheadRow.final_score),
          }
        : null,
    };
  } catch (e) {
    console.error("getFacetRank failed:", e);
    return null;
  }
}

/** Total number of accounts ever evaluated (for the "N developers" counter). */
export async function getScoreCount(): Promise<number | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute("SELECT COUNT(*) AS n FROM scores");
    return Number(res.rows[0]?.n ?? 0);
  } catch (e) {
    console.error("getScoreCount failed:", e);
    return null;
  }
}

interface LeaderboardRow {
  username: unknown;
  display_name: unknown;
  avatar_url: unknown;
  profile_url: unknown;
  final_score: unknown;
  tier: unknown;
  tags: unknown;
  lookup_count: unknown;
  recent_lookup_count?: unknown;
  last_lookup_at?: unknown;
}

function toLeaderboardEntry(r: LeaderboardRow, now = Date.now()): LeaderboardEntry {
  const username = String(r.username);
  const final_score = Number(r.final_score);
  const lookup_count = normalizeLookupCount(r.lookup_count);
  const recent_lookup_count = normalizeRecentLookupCount(r.recent_lookup_count);
  const last_lookup_at = normalizeLastLookupAt(r.last_lookup_at);
  return {
    username,
    display_name: r.display_name as string | null,
    avatar_url: r.avatar_url as string | null,
    profile_url: r.profile_url as string | null,
    final_score,
    tier: String(r.tier) as Tier,
    tags: parseTags(r.tags),
    lookup_count,
    recent_lookup_count,
    trending_score: computeTrendingScore(
      { username, final_score, lookup_count, recent_lookup_count, last_lookup_at },
      now,
    ),
  };
}

/** Default 名人堂 board: score lifted by recent unique lookup heat. */
export async function getTrendingLeaderboard(
  limit = 100,
  minScore = 60,
  window: LeaderboardWindow = "all",
): Promise<LeaderboardEntry[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const now = Date.now();
    const { recentCutoff, activeOnly } = resolveLeaderboardWindow(window, now);
    const res = await db.execute({
      sql: `SELECT s.username, s.display_name, s.avatar_url, s.profile_url,
                   s.final_score, s.tier, s.tags,
                   MAX(COALESCE(stats.lookup_count, 0), ${MIN_RECORDED_LOOKUP_COUNT}) AS lookup_count,
                   COALESCE(recent.recent_lookup_count, 0) AS recent_lookup_count,
                   stats.last_lookup_at AS last_lookup_at
            FROM scores AS s
            LEFT JOIN account_stats AS stats ON stats.username = s.username
            LEFT JOIN (
              SELECT username, COUNT(*) AS recent_lookup_count
              FROM account_lookup_limits
              WHERE last_counted_at >= ?
              GROUP BY username
            ) AS recent ON recent.username = s.username
            WHERE s.hidden = 0 AND s.final_score >= ?
            ${activeOnly ? "AND recent.recent_lookup_count > 0" : ""}`,
      args: [recentCutoff, minScore],
    });
    return rankTrending(
      res.rows.map((r) => ({
        ...toLeaderboardEntry(r as unknown as LeaderboardRow, now),
        last_lookup_at: normalizeLastLookupAt(r.last_lookup_at),
      })),
      now,
    )
      .slice(0, limit)
      .map(({ last_lookup_at: _lastLookupAt, ...entry }) => entry);
  } catch (e) {
    console.error("getTrendingLeaderboard failed:", e);
    return [];
  }
}

/** One indexable profile: its canonical slug + when it was last scored. */
export interface PublicProfile {
  username: string;
  scanned_at: number;
}

/**
 * All profiles eligible for the sitemap: non-hidden and scoring at/above the
 * public index floor. Ordered by score so the highest-value pages lead. Used by
 * `app/sitemap.ts`; returns [] when Turso is unconfigured.
 */
export async function getAllPublicUsernames(minScore = 60): Promise<PublicProfile[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT username, scanned_at
            FROM scores
            WHERE hidden = 0 AND final_score >= ?
            ORDER BY final_score DESC`,
      args: [minScore],
    });
    return res.rows.map((r) => ({
      username: String(r.username),
      scanned_at: Number(r.scanned_at),
    }));
  } catch (e) {
    console.error("getAllPublicUsernames failed:", e);
    return [];
  }
}

/** Top high-scoring accounts for the public 名人堂 board (excludes hidden). */
export async function getLeaderboard(
  limit = 100,
  minScore = 60,
  window: LeaderboardWindow = "all",
): Promise<LeaderboardEntry[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const { recentCutoff, activeOnly } = resolveLeaderboardWindow(window, Date.now());
    const res = await db.execute({
      sql: `SELECT s.username, s.display_name, s.avatar_url, s.profile_url,
                   s.final_score, s.tier, s.tags,
                   MAX(COALESCE(stats.lookup_count, 0), ${MIN_RECORDED_LOOKUP_COUNT}) AS lookup_count,
                   COALESCE(recent.recent_lookup_count, 0) AS recent_lookup_count,
                   stats.last_lookup_at AS last_lookup_at
            FROM scores AS s
            LEFT JOIN account_stats AS stats ON stats.username = s.username
            LEFT JOIN (
              SELECT username, COUNT(*) AS recent_lookup_count
              FROM account_lookup_limits
              WHERE last_counted_at >= ?
              GROUP BY username
            ) AS recent ON recent.username = s.username
            WHERE s.hidden = 0 AND s.final_score >= ?
            ${activeOnly ? "AND recent.recent_lookup_count > 0" : ""}
            ORDER BY s.final_score DESC, s.scanned_at DESC
            LIMIT ?`,
      args: [recentCutoff, minScore, limit],
    });
    const now = Date.now();
    return res.rows.map((r) => toLeaderboardEntry(r as unknown as LeaderboardRow, now));
  } catch (e) {
    console.error("getLeaderboard failed:", e);
    return [];
  }
}

/** Public board sorted by successful lookup count, highest heat first. */
export async function getHeatLeaderboard(
  limit = 100,
  minScore = 60,
  window: LeaderboardWindow = "all",
): Promise<LeaderboardEntry[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const { recentCutoff, activeOnly } = resolveLeaderboardWindow(window, Date.now());
    // "all" ranks by cumulative lookups; a window ranks by the unique-visitor
    // count within that window so the order matches the heat figure shown.
    const heatOrder = activeOnly ? "recent_lookup_count DESC" : "lookup_count DESC";
    const res = await db.execute({
      sql: `SELECT s.username, s.display_name, s.avatar_url, s.profile_url,
                   s.final_score, s.tier, s.tags,
                   MAX(COALESCE(stats.lookup_count, 0), ${MIN_RECORDED_LOOKUP_COUNT}) AS lookup_count,
                   COALESCE(recent.recent_lookup_count, 0) AS recent_lookup_count,
                   stats.last_lookup_at AS last_lookup_at
            FROM scores AS s
            LEFT JOIN account_stats AS stats ON stats.username = s.username
            LEFT JOIN (
              SELECT username, COUNT(*) AS recent_lookup_count
              FROM account_lookup_limits
              WHERE last_counted_at >= ?
              GROUP BY username
            ) AS recent ON recent.username = s.username
            WHERE s.hidden = 0 AND s.final_score >= ?
            ${activeOnly ? "AND recent.recent_lookup_count > 0" : ""}
            ORDER BY ${heatOrder}, s.final_score DESC, s.scanned_at DESC
            LIMIT ?`,
      args: [recentCutoff, minScore, limit],
    });
    const now = Date.now();
    return res.rows.map((r) => toLeaderboardEntry(r as unknown as LeaderboardRow, now));
  } catch (e) {
    console.error("getHeatLeaderboard failed:", e);
    return [];
  }
}

/** Public 进步榜 board: accounts whose latest score beats their previous one,
 *  biggest gain first. No minScore floor — a 20→40 climb belongs here too. */
export async function getProgressLeaderboard(
  limit = 100,
  window: LeaderboardWindow = "all",
): Promise<LeaderboardEntry[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const { recentCutoff, activeOnly } = resolveLeaderboardWindow(window, Date.now());
    const res = await db.execute({
      sql: `SELECT s.username, s.display_name, s.avatar_url, s.profile_url,
                   s.final_score, s.tier, s.tags, s.prev_score,
                   MAX(COALESCE(stats.lookup_count, 0), ${MIN_RECORDED_LOOKUP_COUNT}) AS lookup_count,
                   COALESCE(recent.recent_lookup_count, 0) AS recent_lookup_count,
                   stats.last_lookup_at AS last_lookup_at
            FROM scores AS s
            LEFT JOIN account_stats AS stats ON stats.username = s.username
            LEFT JOIN (
              SELECT username, COUNT(*) AS recent_lookup_count
              FROM account_lookup_limits
              WHERE last_counted_at >= ?
              GROUP BY username
            ) AS recent ON recent.username = s.username
            WHERE s.hidden = 0
              AND s.prev_score IS NOT NULL
              AND s.final_score > s.prev_score
              ${activeOnly ? "AND recent.recent_lookup_count > 0" : ""}
            ORDER BY (s.final_score - s.prev_score) DESC, s.scanned_at DESC
            LIMIT ?`,
      args: [recentCutoff, limit],
    });
    const now = Date.now();
    return res.rows.map((r) => {
      const entry = toLeaderboardEntry(r as unknown as LeaderboardRow, now);
      const final_score = Number(r.final_score);
      const prev_score = Number(r.prev_score);
      return {
        ...entry,
        final_score,
        prev_score,
        delta: final_score - prev_score,
      };
    });
  } catch (e) {
    console.error("getProgressLeaderboard failed:", e);
    return [];
  }
}

function metricNumber(metrics: Record<string, unknown>, key: string): number {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseMetricsObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function growthFromMetrics(
  latestMetrics: Record<string, unknown>,
  previousMetrics: Record<string, unknown>,
  hasPrevious: boolean,
) {
  const latestContrib = metricNumber(latestMetrics, "last_year_contributions");
  const previousContrib = metricNumber(previousMetrics, "last_year_contributions");
  const latestMergedPr = metricNumber(latestMetrics, "recent_merged_pr_sample");
  const previousMergedPr = metricNumber(previousMetrics, "recent_merged_pr_sample");
  const latestImpactCommits = metricNumber(latestMetrics, "impact_commit_count");
  const previousImpactCommits = metricNumber(previousMetrics, "impact_commit_count");

  const contributionDelta = hasPrevious
    ? Math.max(0, latestContrib - previousContrib)
    : Math.min(latestContrib, 30);
  const mergedPrDelta = hasPrevious
    ? Math.max(0, latestMergedPr - previousMergedPr)
    : Math.min(latestMergedPr, 10);
  const impactCommitDelta = hasPrevious
    ? Math.max(0, latestImpactCommits - previousImpactCommits)
    : Math.min(latestImpactCommits, 20);

  return {
    contributionDelta,
    mergedPrDelta,
    impactCommitDelta,
    growthScore: contributionDelta + mergedPrDelta * 3 + impactCommitDelta * 0.5,
  };
}

/** Growth board sorted by recent public contribution gains, not all-time score.
 * Uses the latest two profile snapshots as a pragmatic baseline. When a user has
 * only one snapshot, a capped slice of current public contribution activity lets
 * new entrants appear without letting all-time giants dominate. */
export async function getContributionGrowthLeaderboard(
  limit = 100,
  window: LeaderboardWindow = "30d",
): Promise<GrowthLeaderboardEntry[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const now = Date.now();
    const windowCutoff =
      window === "all" ? 0 : now - LEADERBOARD_WINDOW_MS[window];
    const cutoffDate =
      window === "all"
        ? "0000-01-01"
        : new Date(windowCutoff).toISOString().slice(0, 10);
    const res = await db.execute({
      sql: `WITH ranked_snapshots AS (
              SELECT username, scanned_at, metrics,
                     ROW_NUMBER() OVER (PARTITION BY username ORDER BY scanned_at DESC) AS rn
              FROM profile_snapshots
            ),
            daily AS (
              SELECT username,
                     SUM(contribution_count) AS window_contribution_count,
                     MAX(contribution_date) AS latest_contribution_date
              FROM github_contribution_days
              WHERE contribution_date >= ?
              GROUP BY username
            )
            SELECT s.username, s.display_name, s.avatar_url, s.final_score, s.tier,
                   latest.metrics AS latest_metrics,
                   latest.scanned_at AS latest_snapshot_at,
                   previous.metrics AS previous_metrics,
                   previous.scanned_at AS previous_snapshot_at,
                   daily.window_contribution_count AS window_contribution_count,
                   daily.latest_contribution_date AS latest_contribution_date
            FROM scores AS s
            JOIN ranked_snapshots AS latest
              ON latest.username = s.username AND latest.rn = 1
            LEFT JOIN ranked_snapshots AS previous
              ON previous.username = s.username AND previous.rn = 2
            JOIN daily ON daily.username = s.username
            WHERE s.hidden = 0
              AND s.final_score > ?
              AND COALESCE(s.bot_score, 0) < ?
              AND latest.scanned_at >= ?
            LIMIT ?`,
      args: [
        cutoffDate,
        GROWTH_MIN_FINAL_SCORE,
        GROWTH_MAX_SPAM_BOT_SCORE,
        windowCutoff,
        Math.max(limit * 4, limit),
      ],
    });

    return res.rows
      .map((r) => {
        const previousSnapshotAt =
          r.previous_snapshot_at == null ? null : Number(r.previous_snapshot_at);
        const growth = growthFromMetrics(
          parseMetricsObject(r.latest_metrics),
          parseMetricsObject(r.previous_metrics),
          previousSnapshotAt !== null,
        );
        const windowContributionCount = Math.max(
          0,
          Math.floor(Number(r.window_contribution_count) || 0),
        );
        return {
          username: String(r.username),
          display_name: (r.display_name as string | null) ?? null,
          avatar_url: (r.avatar_url as string | null) ?? null,
          final_score: Number(r.final_score),
          tier: String(r.tier) as Tier,
          contribution_delta: windowContributionCount,
          merged_pr_delta: growth.mergedPrDelta,
          impact_commit_delta: growth.impactCommitDelta,
          growth_score: windowContributionCount,
          latest_snapshot_at: Number(r.latest_snapshot_at),
          previous_snapshot_at: previousSnapshotAt,
        };
      })
      .filter((entry) => entry.growth_score > 0)
      .sort((a, b) => b.growth_score - a.growth_score || b.latest_snapshot_at - a.latest_snapshot_at)
      .slice(0, limit);
  } catch (e) {
    console.error("getContributionGrowthLeaderboard failed:", e);
    return [];
  }
}

/** One score reading in a user's trajectory: score at a point in time. */
export interface GrowthTrajectoryStep {
  /** generated_at (ms epoch) of the score snapshot */
  t: number;
  /** final_score at that time */
  score: number;
}

export interface GrowthTimelinePoint {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  band: string;
  final_score: number;
  growth_score: number;
  contribution_delta: number;
  merged_pr_delta: number;
  impact_commit_delta: number;
  /** Contribution event date (ms epoch) — where the avatar node sits. */
  snapshot_at: number;
  contribution_count: number;
  primary_language: string | null;
  primary_repo: string | null;
  /** Daily contribution events within the window. Keeps the chart tied to
 *  public commit dates instead of scan dates. */
  steps: GrowthTrajectoryStep[];
}

export interface ProfileSnapshotOptions {
  /**
   * Optional final score after the roast-time AI adjustment. Cron and deterministic
   * scans omit this and use `scan.scoring.final_score`.
   */
  growthFinalScore?: number;
}

function hasRecentContributionDay(
  days: { date: string; contribution_count: number }[],
  now: number,
): boolean {
  const cutoff = new Date(now - GROWTH_RECENT_WINDOW_MS).toISOString().slice(0, 10);
  return days.some(
    (day) => day.date >= cutoff && Math.floor(day.contribution_count) > 0,
  );
}

function isGrowthEligible(scan: ScanResult, days: { date: string; contribution_count: number }[], finalScore: number, now: number): boolean {
  if (!(finalScore > GROWTH_MIN_FINAL_SCORE)) return false;
  if (!hasRecentContributionDay(days, now)) return false;
  if (spamBotScore(scan.metrics) >= GROWTH_MAX_SPAM_BOT_SCORE) return false;
  return !scan.scoring.red_flags.some((flag) => GROWTH_FARMING_FLAGS.has(flag.flag));
}

function contributionDateToMs(date: string): number {
  const [year, month, day] = date.split("-").map((part) => Number(part));
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day).getTime();
}

/** Growth timeline data. The X axis is the GitHub contribution date, persisted
 *  from commit contributions during scan, not when ghsphere scanned the account.
 *  Users are still ranked/filtered by recent contribution growth so
 *  only genuinely-growing accounts appear. */
export async function getGrowthTimeline(
  limit = 120,
  window: LeaderboardWindow = "30d",
): Promise<GrowthTimelinePoint[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const now = Date.now();
    const windowCutoff =
      window === "all" ? 0 : now - LEADERBOARD_WINDOW_MS[window];
    const cutoffDate =
      window === "all"
        ? "0000-01-01"
        : new Date(windowCutoff).toISOString().slice(0, 10);

    // 1) Rank qualifying users by recent growth (latest vs previous profile
    //    snapshot) — decides who appears and their growth_score / deltas /
    //    primary repo+language.
    const rankRes = await db.execute({
      sql: `WITH ranked_snapshots AS (
              SELECT username, scanned_at, metrics, top_repos,
                     ROW_NUMBER() OVER (PARTITION BY username ORDER BY scanned_at DESC) AS rn
              FROM profile_snapshots
            ),
            daily AS (
              SELECT username,
                     SUM(contribution_count) AS window_contribution_count,
                     MAX(contribution_date) AS latest_contribution_date
              FROM github_contribution_days
              WHERE contribution_date >= ?
              GROUP BY username
            )
            SELECT s.username, s.display_name, s.avatar_url, s.final_score,
                   latest.metrics AS latest_metrics,
                   latest.scanned_at AS latest_snapshot_at,
                   latest.top_repos AS latest_top_repos,
                   previous.metrics AS previous_metrics,
                   previous.scanned_at AS previous_snapshot_at,
                   daily.window_contribution_count AS window_contribution_count,
                   daily.latest_contribution_date AS latest_contribution_date
            FROM scores AS s
            JOIN ranked_snapshots AS latest
              ON latest.username = s.username AND latest.rn = 1
            LEFT JOIN ranked_snapshots AS previous
              ON previous.username = s.username AND previous.rn = 2
            JOIN daily ON daily.username = s.username
            WHERE s.hidden = 0
              AND s.final_score > ?
              AND COALESCE(s.bot_score, 0) < ?
            LIMIT ?`,
      args: [
        cutoffDate,
        GROWTH_MIN_FINAL_SCORE,
        GROWTH_MAX_SPAM_BOT_SCORE,
        Math.max(limit * 4, limit),
      ],
    });

    const ranked = rankRes.rows
      .map((r) => {
        const previousSnapshotAt =
          r.previous_snapshot_at == null ? null : Number(r.previous_snapshot_at);
        const growth = growthFromMetrics(
          parseMetricsObject(r.latest_metrics),
          parseMetricsObject(r.previous_metrics),
          previousSnapshotAt !== null,
        );
        const topRepos = parseJsonArray<{ name: string; name_with_owner?: string; language?: string | null }>(
          r.latest_top_repos,
        );
        const primaryRepo = topRepos[0]
          ? (topRepos[0].name_with_owner ?? topRepos[0].name ?? null)
          : null;
        const primaryLanguage = topRepos[0]?.language ?? null;
        const finalScore = Number(r.final_score);
        const windowContributionCount = Math.max(
          0,
          Math.floor(Number(r.window_contribution_count) || 0),
        );
        return {
          username: String(r.username),
          display_name: (r.display_name as string | null) ?? null,
          avatar_url: (r.avatar_url as string | null) ?? null,
          band: bandFor(finalScore),
          final_score: finalScore,
          growth_score: windowContributionCount,
          contribution_delta: windowContributionCount,
          merged_pr_delta: growth.mergedPrDelta,
          impact_commit_delta: growth.impactCommitDelta,
          snapshot_at: Number(r.latest_snapshot_at),
          primary_language: primaryLanguage,
          primary_repo: primaryRepo,
        };
      })
      .filter((p) => p.growth_score > 0)
      .sort((a, b) => b.growth_score - a.growth_score || b.snapshot_at - a.snapshot_at)
      .slice(0, limit);

    if (ranked.length === 0) return [];

    // 2) Pull each ranked user's public commit contribution dates. This is the
    //    event time users expect to see on the chart; scan timestamps are not
    //    used for point placement.
    const usernames = ranked.map((p) => p.username);
    const placeholders = usernames.map(() => "?").join(",");
    const daysRes = await db.execute({
      sql: `SELECT username, contribution_date, contribution_count
            FROM github_contribution_days
            WHERE username IN (${placeholders})
              AND contribution_date >= ?
              AND contribution_count > 0
            ORDER BY contribution_date ASC, username ASC`,
      args: [...usernames, cutoffDate],
    });

    const daysByUser = new Map<
      string,
      { t: number; count: number; date: string }[]
    >();
    for (const row of daysRes.rows) {
      const u = String(row.username);
      const date = String(row.contribution_date);
      const t = contributionDateToMs(date);
      if (!t) continue;
      const arr = daysByUser.get(u) ?? [];
      arr.push({
        t,
        count: Math.max(0, Math.floor(Number(row.contribution_count))),
        date,
      });
      daysByUser.set(u, arr);
    }

    const timeline: GrowthTimelinePoint[] = [];
    for (const p of ranked) {
      const days = daysByUser.get(p.username) ?? [];
      const latestDay = days[days.length - 1];
      if (!latestDay) continue;
      timeline.push({
        ...p,
        snapshot_at: latestDay.t,
        contribution_count: p.contribution_delta,
        steps: days.map((day) => ({ t: day.t, score: p.final_score })),
      });
    }

    return timeline
      .sort((a, b) => b.growth_score - a.growth_score || b.contribution_count - a.contribution_count)
      .slice(0, limit);
  } catch (e) {
    console.error("getGrowthTimeline failed:", e);
    return [];
  }
}

/** One bucket in the /developers directory: a language/org and how many
 *  qualifying (public, at/above the floor) developers it holds. */
export interface FacetCategory {
  value: string;
  count: number;
}

export interface FacetSearchResult extends FacetCategory {
  type: FacetType;
}

function escapeSqlLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Directory categories for a facet type ("language" | "org"), each with its
 * qualifying-developer count, busiest bucket first. Powers the /developers
 * landing grid. Counts join to `scores` so hidden/low-score accounts don't
 * inflate a bucket. Read behind a long-TTL cache (the GROUP BY is the expensive
 * part) — see lib/developers.ts.
 */
export async function getFacetCategories(
  facetType: FacetType,
  limit = 100,
): Promise<FacetCategory[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT f.facet_value AS value, COUNT(*) AS count
            FROM developer_facets AS f
            JOIN scores AS s ON s.username = f.username
            WHERE f.facet_type = ?
              AND s.hidden = 0
              AND s.final_score >= ?
            GROUP BY f.facet_value
            ORDER BY count DESC, f.facet_value ASC
            LIMIT ?`,
      args: [facetType, FACET_MIN_SCORE, Math.max(1, Math.min(500, limit))],
    });
    return res.rows.map((r) => ({ value: String(r.value), count: Number(r.count) }));
  } catch (e) {
    console.error("getFacetCategories failed:", e);
    return [];
  }
}

/**
 * Search directory facet labels across language/project/org buckets. This is
 * intentionally facet-first: future natural-language search can compile a user
 * intent into the same facet refs, while today's UI gets fast tag lookup.
 */
export async function searchFacetCategories(
  query: string,
  options: { type?: FacetType | null; limit?: number } = {},
): Promise<FacetSearchResult[]> {
  const db = getClient();
  const term = query.trim().toLowerCase();
  if (!db || !term) return [];
  try {
    await ensureSchema(db);
    const capped = Math.max(1, Math.min(100, options.limit ?? 30));
    const escaped = escapeSqlLike(term);
    const contains = `%${escaped}%`;
    const startsWith = `${escaped}%`;
    const typeClause = options.type ? "AND f.facet_type = ?" : "";
    const args: (string | number)[] = [FACET_MIN_SCORE, contains];
    if (options.type) args.push(options.type);
    args.push(term, startsWith, capped);
    const res = await db.execute({
      sql: `SELECT f.facet_type AS type, f.facet_value AS value, COUNT(*) AS count
            FROM developer_facets AS f
            JOIN scores AS s ON s.username = f.username
            WHERE s.hidden = 0
              AND s.final_score >= ?
              AND LOWER(f.facet_value) LIKE ? ESCAPE '\\'
              ${typeClause}
            GROUP BY f.facet_type, f.facet_value
            ORDER BY CASE
                       WHEN LOWER(f.facet_value) = ? THEN 0
                       WHEN LOWER(f.facet_value) LIKE ? ESCAPE '\\' THEN 1
                       ELSE 2
                     END,
                     count DESC,
                     f.facet_value ASC
            LIMIT ?`,
      args,
    });
    return res.rows.map((r) => ({
      type: String(r.type) as FacetType,
      value: String(r.value),
      count: Number(r.count),
    }));
  } catch (e) {
    console.error("searchFacetCategories failed:", e);
    return [];
  }
}

/**
 * The head of one directory bucket: public developers tagged with
 * (facetType, facetValue), ranked by final_score. Returns the same
 * {@link LeaderboardEntry} shape the boards use, so the directory reuses the
 * leaderboard card renderer unchanged. All-time and score-sorted (no time
 * window), and hard-capped at {@link DEVELOPERS_PER_FACET_LIMIT}. Every join is
 * an index seek (facet index → scores PK → account_stats PK), so the query stays
 * cheap regardless of bucket size; reads go through a cache (lib/developers.ts).
 */
export async function getDevelopersByFacet(
  facetType: FacetType,
  facetValue: string,
  limit = DEVELOPERS_PER_FACET_LIMIT,
): Promise<LeaderboardEntry[]> {
  const db = getClient();
  if (!db || !facetValue) return [];
  try {
    await ensureSchema(db);
    const capped = Math.max(1, Math.min(DEVELOPERS_PER_FACET_LIMIT, limit));
    const res = await db.execute({
      sql: `SELECT s.username, s.display_name, s.avatar_url, s.profile_url,
                   s.final_score, s.tier, s.tags,
                   MAX(COALESCE(stats.lookup_count, 0), ${MIN_RECORDED_LOOKUP_COUNT}) AS lookup_count,
                   stats.last_lookup_at AS last_lookup_at
            FROM developer_facets AS f
            JOIN scores AS s ON s.username = f.username
            LEFT JOIN account_stats AS stats ON stats.username = s.username
            WHERE f.facet_type = ?
              AND f.facet_value = ?
              AND s.hidden = 0
              AND s.final_score >= ?
            ORDER BY s.final_score DESC, s.scanned_at DESC
            LIMIT ?`,
      args: [facetType, facetValue, FACET_MIN_SCORE, capped],
    });
    const now = Date.now();
    return res.rows.map((r) => toLeaderboardEntry(r as unknown as LeaderboardRow, now));
  } catch (e) {
    console.error("getDevelopersByFacet failed:", e);
    return [];
  }
}

export interface AccountDetail {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  final_score: number;
  tier: Tier;
  tags: Tags;
  sub_scores: SubScores;
  /** Bilingual savage one-liner {zh,en}; empty for legacy rows (see `roast`). */
  roast_line: RoastLine;
  /** Chinese roast report (legacy single-language column). */
  roast: string | null;
  /** English roast report; null until an `/en` roast has been generated. */
  roast_en: string | null;
  scanned_at: number;
}

export interface ArchivedRoast {
  username: string;
  final_score: number;
  tier: Tier;
  tags: Tags;
  roast_line: RoastLine;
  report: string;
}

export interface ScoreBrief {
  username: string;
  display_name: string | null;
  final_score: number;
  tier: Tier;
}

export interface ProjectContributorEntry {
  login: string;
  avatar_url: string | null;
  html_url: string | null;
  contributions: number;
  role: "owner" | "maintainer" | "contributor";
  profile_score: number | null;
  profile_tier: Tier | null;
  profile_display_name: string | null;
}

export interface ProjectScoreDetail {
  owner: string;
  repo: string;
  full_name: string;
  html_url: string;
  owner_avatar_url: string | null;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics: string[];
  license: string | null;
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;
  size: number;
  default_branch: string | null;
  created_at: string | null;
  pushed_at: string | null;
  latest_release_at: string | null;
  score: number;
  band: ProjectBand;
  breakdown: ProjectScanResult["breakdown"];
  roast_line: ProjectScanResult["roast_line"];
  readme: ProjectScanResult["readme"];
  languages: { name: string; size: number }[];
  contributors: ProjectContributorEntry[];
  scanned_at: number;
  domain_slug: string;
}

function parseProjectJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function projectDomainSlug(owner: string, repo: string): string {
  return facetDomainSlug("repo", `${owner}/${repo}`);
}

function projectDisplayName(fullName: string): { zh: string; en: string } {
  const repo = fullName.split("/").pop() || fullName;
  return {
    zh: `${repo} 项目圈`,
    en: `${repo} project circle`,
  };
}

function projectBandFromScore(score: number): ProjectBand {
  if (score >= 92) return "S+";
  if (score >= 84) return "S";
  if (score >= 76) return "A+";
  if (score >= 68) return "A";
  if (score >= 58) return "B+";
  if (score >= 48) return "B";
  if (score >= 36) return "C+";
  return "C";
}

function daysSinceIso(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((now - ts) / HEAT_LOOKUP_WINDOW_MS));
}

function normalizeSnapshotRepo(repo: TopRepo): {
  owner: string;
  repo: string;
  fullName: string;
} | null {
  const nameWithOwner =
    typeof repo.name_with_owner === "string" ? repo.name_with_owner.trim() : "";
  const owner = (repo.owner_login || nameWithOwner.split("/")[0] || "").trim();
  const name = (repo.name || nameWithOwner.split("/")[1] || "").replace(/\.git$/i, "").trim();
  const nameRe = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !name || !nameRe.test(owner) || !nameRe.test(name)) return null;
  return { owner, repo: name, fullName: `${owner}/${name}` };
}

function scoreSnapshotProject(repo: TopRepo, developerScore: number): {
  score: number;
  band: ProjectBand;
  breakdown: ProjectScanResult["breakdown"];
} {
  const readme = repo.readme?.features;
  const pushedDays = daysSinceIso(repo.pushed_at);
  const activity = clampScore(
    (pushedDays === null ? 1 : pushedDays <= 14 ? 10 : pushedDays <= 60 ? 7 : pushedDays <= 180 ? 4 : 1) +
      logRatio((repo.open_issues || 0) + (repo.forks || 0), 2000) * 5,
  );
  const quality = clampScore(
    (readme?.content_depth_score ?? 0) * 9 +
      (readme ? Math.max(0, 1 - readme.placeholder_score) * 3 : 0) +
      (repo.topics?.length ? Math.min(3, repo.topics.length * 0.75) : 0) +
      (repo.languages?.length ? 3 : repo.language ? 1.5 : 0) +
      logRatio(repo.size || 0, 200000) * 4,
  );
  const collaboration = clampScore(
    logRatio(repo.forks || 0, 5000) * 7 +
      ((repo.open_issues || 0) > 0 ? logRatio(repo.open_issues || 0, 5000) * 4 : 1),
  );
  const impact = clampScore(
    logRatio(repo.stars || 0, 50000) * 16 + logRatio(repo.forks || 0, 12000) * 6,
  );
  const authenticity = clampScore(
    10 +
      Math.min(5, Math.max(0, developerScore - 50) / 10) -
      ((readme?.placeholder_score ?? 0) >= 0.6 ? 4 : 0) -
      ((repo.stars || 0) >= 100 && (repo.forks || 0) <= Math.max(1, (repo.stars || 0) * 0.006)
        ? 3
        : 0),
  );
  const breakdown = {
    activity: Math.round(activity * 100) / 100,
    quality: Math.round(quality * 100) / 100,
    collaboration: Math.round(collaboration * 100) / 100,
    impact: Math.round(impact * 100) / 100,
    authenticity: Math.round(authenticity * 100) / 100,
  };
  const score = clampScore(
    breakdown.activity +
      breakdown.quality +
      breakdown.collaboration +
      breakdown.impact +
      breakdown.authenticity,
  );
  return { score, band: projectBandFromScore(score), breakdown };
}

/** Minimal score lookup for the SVG badge — avoids fetching the heavy roast text. */
export async function getScoreBrief(username: string): Promise<ScoreBrief | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT username, display_name, final_score, tier
            FROM scores
            WHERE username = ? AND hidden = 0
            LIMIT 1`,
      args: [username.toLowerCase()],
    });
    const r = res.rows[0];
    if (!r) return null;
    return {
      username: String(r.username),
      display_name: r.display_name as string | null,
      final_score: Number(r.final_score),
      tier: String(r.tier) as Tier,
    };
  } catch (e) {
    console.error("getScoreBrief failed:", e);
    return null;
  }
}

export async function recordProjectScan(project: ProjectScanResult): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    const fullName = project.full_name.toLowerCase();
    const owner = project.owner.toLowerCase();
    const repo = project.repo.toLowerCase();
    const now = project.scanned_at || Date.now();
    const domainSlug = projectDomainSlug(project.owner, project.repo);
    const domainName = projectDisplayName(project.full_name);
    const description = JSON.stringify({ tag: project.full_name, project: true });
    const scoredContributorLogins = project.contributors.map((c) => c.login.toLowerCase());

    await db.batch(
      [
        {
          sql: `INSERT INTO project_scores
                  (full_name, owner, repo, html_url, owner_avatar_url, description,
                   homepage, language, topics, license, stars, forks, watchers,
                   open_issues, size, default_branch, created_at_iso, pushed_at_iso,
                   latest_release_at, score, band, breakdown, roast_line, readme,
                   languages, scanned_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(full_name) DO UPDATE SET
                  owner = excluded.owner,
                  repo = excluded.repo,
                  html_url = excluded.html_url,
                  owner_avatar_url = excluded.owner_avatar_url,
                  description = excluded.description,
                  homepage = excluded.homepage,
                  language = excluded.language,
                  topics = excluded.topics,
                  license = excluded.license,
                  stars = excluded.stars,
                  forks = excluded.forks,
                  watchers = excluded.watchers,
                  open_issues = excluded.open_issues,
                  size = excluded.size,
                  default_branch = excluded.default_branch,
                  created_at_iso = excluded.created_at_iso,
                  pushed_at_iso = excluded.pushed_at_iso,
                  latest_release_at = excluded.latest_release_at,
                  score = excluded.score,
                  band = excluded.band,
                  breakdown = excluded.breakdown,
                  roast_line = excluded.roast_line,
                  readme = excluded.readme,
                  languages = excluded.languages,
                  scanned_at = excluded.scanned_at`,
          args: [
            fullName,
            owner,
            repo,
            project.html_url,
            project.owner_avatar_url,
            project.description,
            project.homepage,
            project.language,
            JSON.stringify(project.topics),
            project.license,
            project.stars,
            project.forks,
            project.watchers,
            project.open_issues,
            project.size,
            project.default_branch,
            project.created_at,
            project.pushed_at,
            project.latest_release_at,
            project.score,
            project.band,
            JSON.stringify(project.breakdown),
            JSON.stringify(project.roast_line),
            JSON.stringify(project.readme),
            JSON.stringify(project.languages),
            now,
          ],
        },
        {
          sql: `INSERT INTO project_snapshots
                  (id, full_name, owner, repo, scanned_at, project_json, contributors)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            randomUUID(),
            fullName,
            owner,
            repo,
            now,
            JSON.stringify(project),
            JSON.stringify(project.contributors),
          ],
        },
        {
          sql: `DELETE FROM project_contributors WHERE full_name = ?`,
          args: [fullName],
        },
        ...project.contributors.map((c) => ({
          sql: `INSERT INTO project_contributors
                  (full_name, owner, repo, login, avatar_url, html_url, contributions, role, scanned_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            fullName,
            owner,
            repo,
            c.login.toLowerCase(),
            c.avatar_url,
            c.html_url,
            c.contributions,
            c.role,
            now,
          ] as (string | number | null)[],
        })),
        {
          sql: `INSERT INTO circle_domains
                  (slug, name_zh, name_en, description_zh, description_en,
                   source, status, member_count, heat_score, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET
                  name_zh = excluded.name_zh,
                  name_en = excluded.name_en,
                  description_zh = excluded.description_zh,
                  description_en = excluded.description_en,
                  source = 'admin',
                  status = 'active',
                  member_count = excluded.member_count,
                  heat_score = excluded.heat_score,
                  updated_at = excluded.updated_at`,
          args: [
            domainSlug,
            domainName.zh,
            domainName.en,
            description,
            description,
            project.contributors.length,
            Math.round(project.score * 10 + project.stars + project.forks * 2),
            now,
            now,
          ],
        },
        {
          sql: `DELETE FROM circle_domain_members WHERE domain_slug = ?`,
          args: [domainSlug],
        },
        ...scoredContributorLogins.map((login, index) => ({
          sql: `INSERT INTO circle_domain_members
                  (domain_slug, login, weight, reason_zh, reason_en, created_at, updated_at)
                SELECT ?, s.username, ?, ?, ?, ?, ?
                FROM scores AS s
                WHERE s.username = ? AND s.hidden = 0`,
          args: [
            domainSlug,
            Math.max(1, (project.contributors[index]?.contributions ?? 0) || 1),
            `${project.full_name} 贡献者`,
            `${project.full_name} contributor`,
            now,
            now,
            login,
          ] as (string | number)[],
        })),
      ],
      "write",
    );
  } catch (e) {
    console.error("recordProjectScan failed:", e);
  }
}

export interface ProjectCircleBackfillOptions {
  limit?: number;
  offset?: number;
  minDeveloperScore?: number;
  minProjectScore?: number;
  minStars?: number;
  dryRun?: boolean;
}

export interface ProjectCircleBackfillSummary {
  dryRun: boolean;
  scannedDevelopers: number;
  candidateProjects: number;
  writtenProjects: number;
  skippedProjects: number;
  nextOffset: number | null;
  projects: {
    full_name: string;
    score: number;
    band: ProjectBand;
    stars: number;
    contributors: number;
  }[];
}

type SnapshotProjectContributor = {
  login: string;
  avatar_url: string | null;
  html_url: string | null;
  score: number;
  contributionWeight: number;
};

type SnapshotProjectCandidate = {
  repo: TopRepo;
  owner: string;
  name: string;
  fullName: string;
  bestDeveloperScore: number;
  candidateScore: number;
  contributors: Map<string, SnapshotProjectContributor>;
};

function snapshotProjectToScanResult(candidate: SnapshotProjectCandidate): ProjectScanResult {
  const { repo, owner, name, fullName } = candidate;
  const scored = scoreSnapshotProject(repo, candidate.bestDeveloperScore);
  const contributors = [...candidate.contributors.values()]
    .sort((a, b) => b.contributionWeight - a.contributionWeight || b.score - a.score)
    .slice(0, 12)
    .map((c): ProjectScanResult["contributors"][number] => ({
      login: c.login,
      avatar_url: c.avatar_url,
      html_url: c.html_url,
      contributions: Math.max(1, Math.round(c.contributionWeight)),
      role: c.login.toLowerCase() === owner.toLowerCase() ? "owner" : "contributor",
    }));
  const readme = repo.readme?.features
    ? {
        length: repo.readme.features.length,
        heading_count: repo.readme.features.heading_count,
        content_depth_score: repo.readme.features.content_depth_score,
        placeholder_score: repo.readme.features.placeholder_score,
        prompt_summary: repo.readme.features.prompt_summary,
      }
    : null;
  const languages =
    repo.languages && repo.languages.length > 0
      ? repo.languages
      : repo.language
        ? [{ name: repo.language, size: Math.max(1, repo.size || 1) }]
        : [];
  const htmlUrl = `https://github.com/${fullName}`;

  return {
    owner,
    repo: name,
    full_name: fullName,
    html_url: htmlUrl,
    owner_avatar_url: null,
    description: repo.description ?? null,
    homepage: null,
    language: repo.language,
    topics: (repo.topics ?? []).slice(0, 12),
    license: null,
    stars: Math.max(0, Number(repo.stars) || 0),
    forks: Math.max(0, Number(repo.forks) || 0),
    watchers: Math.max(0, Number(repo.stars) || 0),
    open_issues: Math.max(0, Number(repo.open_issues) || 0),
    size: Math.max(0, Number(repo.size) || 0),
    default_branch: "main",
    created_at: null,
    pushed_at: repo.pushed_at ?? null,
    latest_release_at: null,
    contributors,
    languages,
    readme,
    score: scored.score,
    band: scored.band,
    breakdown: scored.breakdown,
    roast_line: {
      zh: `${fullName} 已经从开发者锐评里浮出来，适合作为一个项目维度的圈子入口。`,
      en: `${fullName} surfaced from developer scans and is ready to become a project circle.`,
    },
    scanned_at: Date.now(),
  };
}

/**
 * Seed project circles from already-roasted developers. This reads the persisted
 * profile snapshots only: no GitHub calls and no LLM calls. It picks the best
 * repositories from high-scoring developers, dedupes by owner/repo, then records
 * them as project circles with any already-scored developers attached as members.
 */
export async function backfillProjectCirclesFromSnapshots(
  options: ProjectCircleBackfillOptions = {},
): Promise<ProjectCircleBackfillSummary> {
  const db = getClient();
  const dryRun = options.dryRun === true;
  const limit = Math.max(1, Math.min(2000, options.limit ?? 500));
  const offset = Math.max(0, options.offset ?? 0);
  const minDeveloperScore = Math.max(0, Math.min(100, options.minDeveloperScore ?? 60));
  const minProjectScore = Math.max(0, Math.min(100, options.minProjectScore ?? 48));
  const minStars = Math.max(0, options.minStars ?? 5);
  if (!db) {
    return {
      dryRun,
      scannedDevelopers: 0,
      candidateProjects: 0,
      writtenProjects: 0,
      skippedProjects: 0,
      nextOffset: null,
      projects: [],
    };
  }

  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT ps.username, ps.top_repos, s.avatar_url, s.profile_url, s.final_score
            FROM profile_snapshots AS ps
            JOIN (
              SELECT username, MAX(scanned_at) AS scanned_at
              FROM profile_snapshots
              GROUP BY username
            ) AS latest
              ON latest.username = ps.username AND latest.scanned_at = ps.scanned_at
            JOIN scores AS s ON s.username = ps.username
            WHERE s.hidden = 0 AND s.final_score >= ?
            ORDER BY s.final_score DESC, ps.scanned_at DESC
            LIMIT ? OFFSET ?`,
      args: [minDeveloperScore, limit, offset],
    });

    const candidates = new Map<string, SnapshotProjectCandidate>();
    for (const row of res.rows) {
      const username = String(row.username).toLowerCase();
      const developerScore = Number(row.final_score) || 0;
      const repos = parseJsonArray<TopRepo>(row.top_repos);
      for (const repo of repos) {
        const normalized = normalizeSnapshotRepo(repo);
        if (!normalized) continue;
        if (
          normalized.owner.toLowerCase() === username &&
          normalized.repo.toLowerCase() === username &&
          !repo.attributed_original
        ) {
          continue;
        }
        if ((Number(repo.stars) || 0) < minStars && !repo.attributed_original) continue;

        const scored = scoreSnapshotProject(repo, developerScore);
        if (scored.score < minProjectScore) continue;

        const key = normalized.fullName.toLowerCase();
        const existing = candidates.get(key);
        const candidateScore =
          scored.score * 100 +
          Math.min(5000, Number(repo.stars) || 0) +
          Math.min(2000, Number(repo.forks) || 0) * 2 +
          developerScore;
        const candidate =
          existing ??
          ({
            repo,
            owner: normalized.owner,
            name: normalized.repo,
            fullName: normalized.fullName,
            bestDeveloperScore: developerScore,
            candidateScore,
            contributors: new Map<string, SnapshotProjectContributor>(),
          } satisfies SnapshotProjectCandidate);
        if (!existing || candidateScore > existing.candidateScore) {
          candidate.repo = repo;
          candidate.owner = normalized.owner;
          candidate.name = normalized.repo;
          candidate.fullName = normalized.fullName;
          candidate.bestDeveloperScore = developerScore;
          candidate.candidateScore = candidateScore;
        }
        const contributionWeight =
          Math.max(1, developerScore) +
          Math.min(500, Number(repo.stars) || 0) / 10 +
          (repo.attributed_original ? 25 : 0);
        const current = candidate.contributors.get(username);
        if (!current || contributionWeight > current.contributionWeight) {
          candidate.contributors.set(username, {
            login: username,
            avatar_url: (row.avatar_url as string | null) ?? null,
            html_url: (row.profile_url as string | null) ?? `https://github.com/${username}`,
            score: developerScore,
            contributionWeight,
          });
        }
        candidates.set(key, candidate);
      }
    }

    const selected = [...candidates.values()]
      .sort((a, b) => b.candidateScore - a.candidateScore)
      .slice(0, Math.min(100, limit))
      .map(snapshotProjectToScanResult);

    let writtenProjects = 0;
    for (const project of selected) {
      if (!dryRun) await recordProjectScan(project);
      writtenProjects++;
    }

    return {
      dryRun,
      scannedDevelopers: res.rows.length,
      candidateProjects: candidates.size,
      writtenProjects,
      skippedProjects: Math.max(0, candidates.size - selected.length),
      nextOffset: res.rows.length === limit ? offset + limit : null,
      projects: selected.slice(0, 30).map((project) => ({
        full_name: project.full_name,
        score: project.score,
        band: project.band,
        stars: project.stars,
        contributors: project.contributors.length,
      })),
    };
  } catch (e) {
    console.error("backfillProjectCirclesFromSnapshots failed:", e);
    return {
      dryRun,
      scannedDevelopers: 0,
      candidateProjects: 0,
      writtenProjects: 0,
      skippedProjects: 0,
      nextOffset: null,
      projects: [],
    };
  }
}

export async function getProjectScore(
  ownerInput: string,
  repoInput: string,
): Promise<ProjectScoreDetail | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const owner = ownerInput.toLowerCase();
    const repo = repoInput.toLowerCase();
    const res = await db.execute({
      sql: `SELECT * FROM project_scores
            WHERE owner = ? AND repo = ?
            LIMIT 1`,
      args: [owner, repo],
    });
    const row = res.rows[0];
    if (!row) return null;
    const fullName = String(row.full_name);
    const contributorRes = await db.execute({
      sql: `SELECT pc.login, pc.avatar_url, pc.html_url, pc.contributions, pc.role,
                   s.display_name, s.final_score, s.tier
            FROM project_contributors AS pc
            LEFT JOIN scores AS s ON s.username = pc.login AND s.hidden = 0
            WHERE pc.full_name = ?
            ORDER BY pc.contributions DESC, pc.login ASC`,
      args: [fullName],
    });
    const displayFullName = `${String(row.owner)}/${String(row.repo)}`;
    return {
      owner: String(row.owner),
      repo: String(row.repo),
      full_name: displayFullName,
      html_url: String(row.html_url),
      owner_avatar_url: (row.owner_avatar_url as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      homepage: (row.homepage as string | null) ?? null,
      language: (row.language as string | null) ?? null,
      topics: parseProjectJson<string[]>(row.topics, []),
      license: (row.license as string | null) ?? null,
      stars: Number(row.stars) || 0,
      forks: Number(row.forks) || 0,
      watchers: Number(row.watchers) || 0,
      open_issues: Number(row.open_issues) || 0,
      size: Number(row.size) || 0,
      default_branch: (row.default_branch as string | null) ?? null,
      created_at: (row.created_at_iso as string | null) ?? null,
      pushed_at: (row.pushed_at_iso as string | null) ?? null,
      latest_release_at: (row.latest_release_at as string | null) ?? null,
      score: Number(row.score) || 0,
      band: String(row.band) as ProjectBand,
      breakdown: parseProjectJson<ProjectScanResult["breakdown"]>(row.breakdown, {
        activity: 0,
        quality: 0,
        collaboration: 0,
        impact: 0,
        authenticity: 0,
      }),
      roast_line: parseProjectJson<ProjectScanResult["roast_line"]>(row.roast_line, {
        zh: "",
        en: "",
      }),
      readme: parseProjectJson<ProjectScanResult["readme"]>(row.readme, null),
      languages: parseProjectJson<{ name: string; size: number }[]>(row.languages, []),
      contributors: contributorRes.rows.map((r) => ({
        login: String(r.login),
        avatar_url: (r.avatar_url as string | null) ?? null,
        html_url: (r.html_url as string | null) ?? null,
        contributions: Number(r.contributions) || 0,
        role: String(r.role) as ProjectContributorEntry["role"],
        profile_score: r.final_score == null ? null : Number(r.final_score),
        profile_tier: r.tier == null ? null : (String(r.tier) as Tier),
        profile_display_name: (r.display_name as string | null) ?? null,
      })),
      scanned_at: Number(row.scanned_at) || 0,
      domain_slug: projectDomainSlug(String(row.owner), String(row.repo)),
    };
  } catch (e) {
    console.error("getProjectScore failed:", e);
    return null;
  }
}

/** A scored account surfaced by the Omnibox autocomplete (already in the DB). */
export interface UserSuggestion {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  final_score: number;
  tier: Tier;
}

/**
 * Prefix-search already-scored, non-hidden accounts for the Omnibox typeahead —
 * so a handle we've already judged is offered directly (with its score) for both
 * roast and PK. Prefix match on the lowercased `username` PK is index-friendly;
 * ties break by score so the strongest match leads.
 */
export async function searchScoredUsers(
  query: string,
  limit = 6,
): Promise<UserSuggestion[]> {
  const db = getClient();
  if (!db) return [];
  const q = query.trim().replace(/^@/, "").toLowerCase();
  if (!q) return [];
  try {
    await ensureSchema(db);
    // Escape LIKE wildcards in user input so `_`/`%` are matched literally.
    const like = `${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const res = await db.execute({
      sql: `SELECT username, display_name, avatar_url, final_score, tier
            FROM scores
            WHERE hidden = 0 AND username LIKE ? ESCAPE '\\'
            ORDER BY final_score DESC
            LIMIT ?`,
      args: [like, limit],
    });
    return res.rows.map((r) => ({
      username: String(r.username),
      display_name: (r.display_name as string | null) ?? null,
      avatar_url: (r.avatar_url as string | null) ?? null,
      final_score: Number(r.final_score),
      tier: String(r.tier) as Tier,
    }));
  } catch (e) {
    console.error("searchScoredUsers failed:", e);
    return [];
  }
}

/** Parse a JSON `{zh,en}` column, returning null when the column is empty/null
 *  (so callers can tell "no LLM verdict yet" from an empty one). */
function parseNullableRoastLine(raw: unknown): RoastLine | null {
  if (typeof raw !== "string" || !raw) return null;
  return parseRoastLine(raw);
}

/** A stored PK matchup (canonical lowercased+sorted pair). */
export interface VsMatchup {
  handleA: string;
  handleB: string;
  winner: string | null;
  bucket: string;
  gap: number;
  scoreA: number;
  scoreB: number;
  /** Bilingual LLM savage verdict; null until generated. */
  verdict: RoastLine | null;
  /** Bilingual self-improvement advice; null until generated. */
  advice: RoastLine | null;
  verdictSource: string | null;
  viewCount: number;
  createdAt: number;
  updatedAt: number;
}

function mapMatchupRow(r: Record<string, unknown>): VsMatchup {
  return {
    handleA: String(r.handle_a),
    handleB: String(r.handle_b),
    winner: (r.winner as string | null) ?? null,
    bucket: String(r.bucket),
    gap: Number(r.gap),
    scoreA: Number(r.score_a),
    scoreB: Number(r.score_b),
    verdict: parseNullableRoastLine(r.verdict),
    advice: parseNullableRoastLine(r.advice),
    verdictSource: (r.verdict_source as string | null) ?? null,
    viewCount: Number(r.view_count ?? 0),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export interface MatchupInput {
  /** Canonical (lowercased, dictionary-sorted) handles. */
  a: string;
  b: string;
  winner: string | null;
  bucket: string;
  gap: number;
  scoreA: number;
  scoreB: number;
  verdict?: RoastLine | null;
  advice?: RoastLine | null;
  source?: "template" | "llm" | null;
}

/**
 * Upsert a matchup. A null verdict/advice never overwrites an existing one
 * (COALESCE), so re-recording the base result on later views can't wipe a
 * generated LLM verdict; `verdict_source` only advances when a verdict is set.
 * `created_at` and `view_count` are preserved on conflict. Best-effort.
 */
export async function recordMatchup(m: MatchupInput): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO vs_matchups
              (handle_a, handle_b, winner, bucket, gap, score_a, score_b, verdict, advice, verdict_source, view_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(handle_a, handle_b) DO UPDATE SET
              winner         = excluded.winner,
              bucket         = excluded.bucket,
              gap            = excluded.gap,
              score_a        = excluded.score_a,
              score_b        = excluded.score_b,
              verdict        = COALESCE(excluded.verdict, vs_matchups.verdict),
              advice         = COALESCE(excluded.advice, vs_matchups.advice),
              verdict_source = CASE WHEN excluded.verdict IS NOT NULL
                                    THEN excluded.verdict_source ELSE vs_matchups.verdict_source END,
              updated_at     = excluded.updated_at`,
      args: [
        m.a.toLowerCase(),
        m.b.toLowerCase(),
        m.winner,
        m.bucket,
        m.gap,
        m.scoreA,
        m.scoreB,
        m.verdict ? JSON.stringify(m.verdict) : null,
        m.advice ? JSON.stringify(m.advice) : null,
        m.source ?? null,
        now,
        now,
      ],
    });
  } catch (e) {
    console.error("recordMatchup failed:", e);
  }
}

/** Increment a matchup's human view count (fed by the client verdict ping). */
export async function bumpMatchupView(a: string, b: string): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    await db.execute({
      sql: `UPDATE vs_matchups SET view_count = view_count + 1
            WHERE handle_a = ? AND handle_b = ?`,
      args: [a.toLowerCase(), b.toLowerCase()],
    });
  } catch (e) {
    console.error("bumpMatchupView failed:", e);
  }
}

/** One matchup by canonical pair (null if never recorded). */
export async function getMatchup(a: string, b: string): Promise<VsMatchup | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT * FROM vs_matchups WHERE handle_a = ? AND handle_b = ? LIMIT 1`,
      args: [a.toLowerCase(), b.toLowerCase()],
    });
    const r = res.rows[0];
    return r ? mapMatchupRow(r as Record<string, unknown>) : null;
  } catch (e) {
    console.error("getMatchup failed:", e);
    return null;
  }
}

/** A user's recent battles (either side), newest first. */
export async function getUserMatchups(username: string, limit = 8): Promise<VsMatchup[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const u = username.toLowerCase();
    const n = Math.max(1, Math.min(50, limit));
    const res = await db.execute({
      sql: `SELECT * FROM vs_matchups
            WHERE handle_a = ? OR handle_b = ?
            ORDER BY updated_at DESC LIMIT ?`,
      args: [u, u, n],
    });
    return res.rows.map((r) => mapMatchupRow(r as Record<string, unknown>));
  } catch (e) {
    console.error("getUserMatchups failed:", e);
    return [];
  }
}

/** Trending battles for the /vs board — LLM-judged, both sides above the floor,
 *  hottest first. */
export async function getTrendingMatchups(limit = 40): Promise<VsMatchup[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const n = Math.max(1, Math.min(100, limit));
    const res = await db.execute({
      sql: `SELECT * FROM vs_matchups
            WHERE verdict_source = 'llm' AND score_a >= ? AND score_b >= ?
            ORDER BY view_count DESC, updated_at DESC LIMIT ?`,
      args: [VS_MIN_SCORE, VS_MIN_SCORE, n],
    });
    return res.rows.map((r) => mapMatchupRow(r as Record<string, unknown>));
  } catch (e) {
    console.error("getTrendingMatchups failed:", e);
    return [];
  }
}

/** Indexable matchups for the sitemap: has an LLM verdict and both sides clear
 *  the floor. */
export async function getIndexableMatchups(): Promise<
  { a: string; b: string; updatedAt: number }[]
> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT handle_a, handle_b, updated_at FROM vs_matchups
            WHERE verdict IS NOT NULL AND score_a >= ? AND score_b >= ?`,
      args: [VS_MIN_SCORE, VS_MIN_SCORE],
    });
    return res.rows.map((r) => ({
      a: String(r.handle_a),
      b: String(r.handle_b),
      updatedAt: Number(r.updated_at),
    }));
  } catch (e) {
    console.error("getIndexableMatchups failed:", e);
    return [];
  }
}

/** Full persisted record for one account's detail page (null if absent/hidden). */
export async function getAccountDetail(username: string): Promise<AccountDetail | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT username, display_name, avatar_url, profile_url, final_score, tier,
                   tags, roast_line, sub_scores, roast, roast_en, scanned_at
            FROM scores
            WHERE username = ? AND hidden = 0
            LIMIT 1`,
      args: [username.toLowerCase()],
    });
    const r = res.rows[0];
    if (!r) return null;
    return {
      username: String(r.username),
      display_name: r.display_name as string | null,
      avatar_url: r.avatar_url as string | null,
      profile_url: r.profile_url as string | null,
      final_score: Number(r.final_score),
      tier: String(r.tier) as Tier,
      tags: parseTags(r.tags),
      roast_line: parseRoastLine(r.roast_line),
      sub_scores: parseSubScores(r.sub_scores),
      roast: (r.roast as string | null) ?? null,
      roast_en: (r.roast_en as string | null) ?? null,
      scanned_at: Number(r.scanned_at),
    };
  } catch (e) {
    console.error("getAccountDetail failed:", e);
    return null;
  }
}

/**
 * Stored roast report for replaying a previous default-model generation. The
 * language column is fixed by allowlist, so the SQL never uses user input for a
 * column name.
 */
export async function getArchivedRoast(
  username: string,
  lang: Lang,
): Promise<ArchivedRoast | null> {
  if (bypassGeneratedCaches()) return null;
  const db = getClient();
  if (!db) return null;
  const col = lang === "en" ? "roast_en" : "roast";
  const versionCol = lang === "en" ? "roast_en_version" : "roast_version";
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT username, final_score, tier, tags, roast_line, ${col} AS report
            FROM scores
            WHERE username = ?
              AND hidden = 0
              AND score_version = ?
              AND ${versionCol} = ?
              AND ${col} IS NOT NULL
              AND ${col} != ''
            LIMIT 1`,
      args: [username.toLowerCase(), SCORE_CACHE_VERSION, ROAST_CACHE_VERSION],
    });
    const r = res.rows[0];
    if (!r) return null;
    return {
      username: String(r.username),
      final_score: Number(r.final_score),
      tier: String(r.tier) as Tier,
      tags: parseTags(r.tags),
      roast_line: parseRoastLine(r.roast_line),
      report: String(r.report),
    };
  } catch (e) {
    console.error("getArchivedRoast failed:", e);
    return null;
  }
}

/** Score band (± points) used to pre-filter candidates before profile ranking. */
const SIMILAR_SCORE_BAND = 10;
/** Cap on candidates scanned, so this stays cheap as the table grows. */
const SIMILAR_POOL = 300;

/**
 * Developers most similar to `username`: pre-filter by a score band (uses the
 * final_score index — the cost-safe lever), then rank that pool by 6-dim profile
 * distance and return the closest `limit`. The target's score/profile are passed
 * in (the caller already has them) to avoid a second lookup. Returns [] on any
 * failure or when the DB is unconfigured.
 */
export async function getSimilarAccounts(
  username: string,
  finalScore: number,
  subScores: SubScores,
  limit = 6,
): Promise<LeaderboardEntry[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT s.username, s.display_name, s.avatar_url, s.profile_url,
                   s.final_score, s.tier, s.tags, s.sub_scores,
                   MAX(COALESCE(stats.lookup_count, 0), ${MIN_RECORDED_LOOKUP_COUNT}) AS lookup_count
            FROM scores AS s
            LEFT JOIN account_stats AS stats ON stats.username = s.username
            WHERE s.hidden = 0
              AND s.username != ?
              AND s.final_score BETWEEN ? AND ?
            ORDER BY s.final_score DESC
            LIMIT ?`,
      args: [
        username.toLowerCase(),
        finalScore - SIMILAR_SCORE_BAND,
        finalScore + SIMILAR_SCORE_BAND,
        SIMILAR_POOL,
      ],
    });
    const candidates = res.rows.map((r) => ({
      ...toLeaderboardEntry(r as unknown as LeaderboardRow),
      sub_scores: parseSubScores(r.sub_scores),
    }));
    const ranked = rankSimilar(subScores, candidates, limit).map((e) => ({
      username: e.username,
      display_name: e.display_name,
      avatar_url: e.avatar_url,
      profile_url: e.profile_url,
      final_score: e.final_score,
      tier: e.tier,
      tags: e.tags,
      lookup_count: e.lookup_count,
      recent_lookup_count: e.recent_lookup_count,
      trending_score: e.trending_score,
    }));
    return ranked;
  } catch (e) {
    console.error("getSimilarAccounts failed:", e);
    return [];
  }
}

/** Remove an account from the public board (still counted in the percentile). */
export async function hideUser(username: string): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    await db.execute({
      sql: `UPDATE scores SET hidden = 1 WHERE username = ?`,
      args: [username.toLowerCase()],
    });
  } catch (e) {
    console.error("hideUser failed:", e);
  }
}

export interface UserUpsert {
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

/**
 * Upsert a logged-in GitHub user. Best-effort; no-ops without Turso. `login` is
 * stored lowercased to match the `scores.username` convention for later linking.
 */
export async function upsertUser(u: UserUpsert): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO users (github_id, login, name, avatar_url, created_at, last_login)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(github_id) DO UPDATE SET
              login      = excluded.login,
              name       = excluded.name,
              avatar_url = excluded.avatar_url,
              last_login = excluded.last_login`,
      args: [u.github_id, u.login.toLowerCase(), u.name, u.avatar_url, now, now],
    });
  } catch (e) {
    console.error("upsertUser failed:", e);
  }
}

// ============================================================================
// Inbox
// ============================================================================

export type InboxSenderKind = "system" | "user";

export interface InboxMessage {
  id: string;
  recipient_github_id: number;
  recipient_login: string;
  sender_kind: InboxSenderKind;
  sender_github_id: number | null;
  sender_login: string | null;
  title: string;
  body: string;
  action_href: string | null;
  read_at: number | null;
  created_at: number;
}

export interface CreateInboxMessageInput {
  recipient_github_id: number;
  recipient_login: string;
  sender_kind?: InboxSenderKind;
  sender_github_id?: number | null;
  sender_login?: string | null;
  title: string;
  body: string;
  action_href?: string | null;
  created_at?: number;
}

function toInboxMessage(row: Record<string, unknown>): InboxMessage {
  return {
    id: String(row.id),
    recipient_github_id: Number(row.recipient_github_id),
    recipient_login: String(row.recipient_login),
    sender_kind: row.sender_kind === "user" ? "user" : "system",
    sender_github_id:
      row.sender_github_id == null ? null : Number(row.sender_github_id),
    sender_login:
      typeof row.sender_login === "string" && row.sender_login
        ? row.sender_login
        : null,
    title: String(row.title),
    body: String(row.body),
    action_href:
      typeof row.action_href === "string" && row.action_href
        ? row.action_href
        : null,
    read_at: row.read_at == null ? null : Number(row.read_at),
    created_at: Number(row.created_at),
  };
}

function normalizeInboxActionHref(href: string | null | undefined): string | null {
  const value = href?.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function getInboxSummary(
  githubId: number,
): Promise<{ unread: number }> {
  const db = getClient();
  if (!db || !validGithubId(githubId)) return { unread: 0 };
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT COUNT(*) AS unread
            FROM inbox_messages
            WHERE recipient_github_id = ? AND read_at IS NULL`,
      args: [githubId],
    });
    return { unread: Number(res.rows[0]?.unread) || 0 };
  } catch (e) {
    console.error("getInboxSummary failed:", e);
    return { unread: 0 };
  }
}

export async function listInboxMessages(
  githubId: number,
  limit = 50,
): Promise<InboxMessage[]> {
  const db = getClient();
  if (!db || !validGithubId(githubId)) return [];
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT id, recipient_github_id, recipient_login, sender_kind,
                   sender_github_id, sender_login, title, body, action_href,
                   read_at, created_at
            FROM inbox_messages
            WHERE recipient_github_id = ?
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [githubId, Math.max(1, Math.min(100, limit))],
    });
    return res.rows.map((row) => toInboxMessage(row as Record<string, unknown>));
  } catch (e) {
    console.error("listInboxMessages failed:", e);
    return [];
  }
}

export async function createInboxMessage(
  input: CreateInboxMessageInput,
): Promise<InboxMessage | null> {
  const db = getClient();
  const recipientLogin = normalizeGitHubUsername(input.recipient_login);
  const senderLogin = input.sender_login
    ? normalizeGitHubUsername(input.sender_login)
    : null;
  const title = input.title.trim().slice(0, 160);
  const body = input.body.trim().slice(0, 4000);
  const senderKind = input.sender_kind === "user" ? "user" : "system";
  const actionHref = normalizeInboxActionHref(input.action_href);
  if (
    !db ||
    !validGithubId(input.recipient_github_id) ||
    !recipientLogin ||
    !title ||
    !body
  ) {
    return null;
  }

  const id = randomUUID();
  const now = input.created_at ?? Date.now();
  try {
    await ensureSchema(db);
    await db.execute({
      sql: `INSERT INTO inbox_messages
              (id, recipient_github_id, recipient_login, sender_kind,
               sender_github_id, sender_login, title, body, action_href,
               created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.recipient_github_id,
        recipientLogin,
        senderKind,
        senderKind === "user" ? input.sender_github_id ?? null : null,
        senderKind === "user" ? senderLogin : null,
        title,
        body,
        actionHref,
        now,
      ],
    });
    return {
      id,
      recipient_github_id: input.recipient_github_id,
      recipient_login: recipientLogin,
      sender_kind: senderKind,
      sender_github_id: senderKind === "user" ? input.sender_github_id ?? null : null,
      sender_login: senderKind === "user" ? senderLogin : null,
      title,
      body,
      action_href: actionHref,
      read_at: null,
      created_at: now,
    };
  } catch (e) {
    console.error("createInboxMessage failed:", e);
    return null;
  }
}

export async function markInboxMessageRead(
  githubId: number,
  id: string,
): Promise<boolean> {
  const db = getClient();
  const messageId = id.trim();
  if (!db || !validGithubId(githubId) || !messageId) return false;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `UPDATE inbox_messages
            SET read_at = COALESCE(read_at, ?)
            WHERE recipient_github_id = ? AND id = ?`,
      args: [Date.now(), githubId, messageId],
    });
    if (Number(res.rowsAffected ?? 0) > 0) return true;
    const existing = await db.execute({
      sql: `SELECT id FROM inbox_messages
            WHERE recipient_github_id = ? AND id = ?
            LIMIT 1`,
      args: [githubId, messageId],
    });
    return existing.rows.length > 0;
  } catch (e) {
    console.error("markInboxMessageRead failed:", e);
    return false;
  }
}

export async function markAllInboxMessagesRead(
  githubId: number,
): Promise<number> {
  const db = getClient();
  if (!db || !validGithubId(githubId)) return 0;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `UPDATE inbox_messages
            SET read_at = ?
            WHERE recipient_github_id = ? AND read_at IS NULL`,
      args: [Date.now(), githubId],
    });
    return Number(res.rowsAffected ?? 0);
  } catch (e) {
    console.error("markAllInboxMessagesRead failed:", e);
    return 0;
  }
}

// ============================================================================
// Growth Scan Subscriptions
// ============================================================================

export type GrowthScanSubscriptionStatus = "active" | "inactive";

export interface GrowthScanSubscription {
  github_id: number;
  login: string;
  status: GrowthScanSubscriptionStatus;
  created_at: number;
  updated_at: number;
  last_scanned_at: number | null;
  last_error: string | null;
}

function toGrowthScanSubscription(
  row: Record<string, unknown>,
): GrowthScanSubscription {
  return {
    github_id: Number(row.github_id),
    login: String(row.login),
    status: row.status === "inactive" ? "inactive" : "active",
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    last_scanned_at:
      row.last_scanned_at == null ? null : Number(row.last_scanned_at),
    last_error: (row.last_error as string | null) ?? null,
  };
}

export async function getGrowthScanSubscription(
  githubId: number,
): Promise<GrowthScanSubscription | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT github_id, login, status, created_at, updated_at,
                   last_scanned_at, last_error
            FROM growth_scan_subscriptions
            WHERE github_id = ?
            LIMIT 1`,
      args: [githubId],
    });
    const row = res.rows[0];
    return row ? toGrowthScanSubscription(row as Record<string, unknown>) : null;
  } catch (e) {
    console.error("getGrowthScanSubscription failed:", e);
    return null;
  }
}

export async function upsertGrowthScanSubscription(input: {
  github_id: number;
  login: string;
  status?: GrowthScanSubscriptionStatus;
}): Promise<GrowthScanSubscription | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const now = Date.now();
    const status = input.status ?? "active";
    await db.execute({
      sql: `INSERT INTO growth_scan_subscriptions
              (github_id, login, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(github_id) DO UPDATE SET
              login      = excluded.login,
              status     = excluded.status,
              updated_at = excluded.updated_at,
              last_error = NULL`,
      args: [input.github_id, input.login.toLowerCase(), status, now, now],
    });
    return getGrowthScanSubscription(input.github_id);
  } catch (e) {
    console.error("upsertGrowthScanSubscription failed:", e);
    return null;
  }
}

export async function updateGrowthScanSubscriptionStatus(
  githubId: number,
  status: GrowthScanSubscriptionStatus,
): Promise<GrowthScanSubscription | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    await db.execute({
      sql: `UPDATE growth_scan_subscriptions
            SET status = ?, updated_at = ?
            WHERE github_id = ?`,
      args: [status, Date.now(), githubId],
    });
    return getGrowthScanSubscription(githubId);
  } catch (e) {
    console.error("updateGrowthScanSubscriptionStatus failed:", e);
    return null;
  }
}

export async function listDueGrowthScanSubscriptions(
  limit = 10,
  minIntervalMs = 24 * 60 * 60 * 1000,
): Promise<GrowthScanSubscription[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const cutoff = Date.now() - Math.max(0, minIntervalMs);
    const res = await db.execute({
      sql: `SELECT github_id, login, status, created_at, updated_at,
                   last_scanned_at, last_error
            FROM growth_scan_subscriptions
            WHERE status = 'active'
              AND (last_scanned_at IS NULL OR last_scanned_at <= ?)
            ORDER BY COALESCE(last_scanned_at, 0) ASC, updated_at ASC
            LIMIT ?`,
      args: [cutoff, Math.min(50, Math.max(1, limit))],
    });
    return res.rows.map((row) =>
      toGrowthScanSubscription(row as Record<string, unknown>),
    );
  } catch (e) {
    console.error("listDueGrowthScanSubscriptions failed:", e);
    return [];
  }
}

export async function markGrowthScanSubscriptionRun(
  githubId: number,
  result: { last_scanned_at?: number; last_error?: string | null },
): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    await db.execute({
      sql: `UPDATE growth_scan_subscriptions
            SET last_scanned_at = COALESCE(?, last_scanned_at),
                last_error = ?,
                updated_at = ?
            WHERE github_id = ?`,
      args: [
        result.last_scanned_at ?? null,
        result.last_error ? result.last_error.slice(0, 500) : null,
        Date.now(),
        githubId,
      ],
    });
  } catch (e) {
    console.error("markGrowthScanSubscriptionRun failed:", e);
  }
}

// ============================================================================
// Community Profiles
// ============================================================================

export interface CommunityProfile {
  github_id: number;
  login: string;
  status: "pending" | "active" | "inactive";
  visibility: "public" | "private";
  working_on: { zh: string; en: string } | null;
  want_to_meet: { zh: string; en: string } | null;
  contact_method: { zh: string; en: string } | null;
  chat_topics: { zh: string; en: string } | null;
  no_recommend_for: { zh: string; en: string } | null;
  ai_card: { zh: string; en: string; generated_at?: number } | null;
  ai_card_approved: boolean;
  joined_at: number;
  updated_at: number;
}

function parseBilingualField(raw: unknown): { zh: string; en: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.zh === "string" &&
      typeof parsed.en === "string"
    ) {
      return { zh: parsed.zh, en: parsed.en };
    }
    return null;
  } catch {
    return null;
  }
}

function parseBilingualCardField(raw: unknown): { zh: string; en: string; generated_at?: number } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.zh === "string" &&
      typeof parsed.en === "string"
    ) {
      return {
        zh: parsed.zh,
        en: parsed.en,
        generated_at: typeof parsed.generated_at === "number" ? parsed.generated_at : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function stringifyBilingualField(
  val: { zh: string; en: string; generated_at?: number } | null | undefined,
): string | null {
  return val ? JSON.stringify(val) : null;
}

function toCommunityProfile(row: Record<string, unknown>): CommunityProfile {
  return {
    github_id: Number(row.github_id),
    login: String(row.login),
    status: String(row.status) as "pending" | "active" | "inactive",
    visibility: String(row.visibility) as "public" | "private",
    working_on: parseBilingualField(row.working_on),
    want_to_meet: parseBilingualField(row.want_to_meet),
    contact_method: parseBilingualField(row.contact_method),
    chat_topics: parseBilingualField(row.chat_topics),
    no_recommend_for: parseBilingualField(row.no_recommend_for),
    ai_card: parseBilingualCardField(row.ai_card),
    ai_card_approved: Boolean(row.ai_card_approved),
    joined_at: Number(row.joined_at),
    updated_at: Number(row.updated_at),
  };
}

/**
 * Get a community profile by GitHub ID.
 */
export async function getCommunityProfile(githubId: number): Promise<CommunityProfile | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT github_id, login, status, visibility, working_on, want_to_meet,
                   contact_method, chat_topics, no_recommend_for, ai_card,
                   ai_card_approved, joined_at, updated_at
            FROM community_profiles
            WHERE github_id = ?`,
      args: [githubId],
    });
    if (res.rows.length === 0) return null;
    return toCommunityProfile(res.rows[0] as Record<string, unknown>);
  } catch (e) {
    console.error("getCommunityProfile failed:", e);
    return null;
  }
}

/**
 * Get a community profile by GitHub login (username). Useful when github_id is not available.
 */
export async function getCommunityProfileByLogin(login: string): Promise<CommunityProfile | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT github_id, login, status, visibility, working_on, want_to_meet,
                   contact_method, chat_topics, no_recommend_for, ai_card,
                   ai_card_approved, joined_at, updated_at
            FROM community_profiles
            WHERE login = ?
            LIMIT 1`,
      args: [login.toLowerCase()],
    });
    if (res.rows.length === 0) return null;
    return toCommunityProfile(res.rows[0] as Record<string, unknown>);
  } catch (e) {
    console.error("getCommunityProfileByLogin failed:", e);
    return null;
  }
}

/**
 * Upsert a community profile. Preserves existing fields if not provided.
 */
export async function upsertCommunityProfile(
  profile: Partial<CommunityProfile> & { github_id: number; login: string },
): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    const now = Date.now();
    const hasStatus = profile.status !== undefined;
    const hasVisibility = profile.visibility !== undefined;
    const hasAiCardApproved = profile.ai_card_approved !== undefined;
    const hasJoinedAt = profile.joined_at !== undefined;

    await db.execute({
      sql: `INSERT INTO community_profiles
              (github_id, login, status, visibility, working_on, want_to_meet,
               contact_method, chat_topics, no_recommend_for, ai_card,
               ai_card_approved, joined_at, updated_at)
            VALUES (?, ?, COALESCE(?, 'pending'), COALESCE(?, 'public'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(github_id) DO UPDATE SET
              login            = COALESCE(excluded.login, community_profiles.login),
              status           = CASE
                                    WHEN ? = 1 THEN excluded.status
                                    ELSE community_profiles.status
                                  END,
              visibility       = CASE
                                    WHEN ? = 1 THEN excluded.visibility
                                    ELSE community_profiles.visibility
                                  END,
              working_on       = COALESCE(excluded.working_on, community_profiles.working_on),
              want_to_meet     = COALESCE(excluded.want_to_meet, community_profiles.want_to_meet),
              contact_method   = COALESCE(excluded.contact_method, community_profiles.contact_method),
              chat_topics      = COALESCE(excluded.chat_topics, community_profiles.chat_topics),
              no_recommend_for = COALESCE(excluded.no_recommend_for, community_profiles.no_recommend_for),
              ai_card          = COALESCE(excluded.ai_card, community_profiles.ai_card),
              ai_card_approved = CASE
                                    WHEN ? = 1 THEN excluded.ai_card_approved
                                    ELSE community_profiles.ai_card_approved
                                  END,
              joined_at        = CASE
                                    WHEN ? = 1 THEN excluded.joined_at
                                    ELSE community_profiles.joined_at
                                  END,
              updated_at       = excluded.updated_at`,
      args: [
        profile.github_id,
        profile.login.toLowerCase(),
        profile.status ?? null,
        profile.visibility ?? null,
        stringifyBilingualField(profile.working_on),
        stringifyBilingualField(profile.want_to_meet),
        stringifyBilingualField(profile.contact_method),
        stringifyBilingualField(profile.chat_topics),
        stringifyBilingualField(profile.no_recommend_for),
        stringifyBilingualField(profile.ai_card),
        profile.ai_card_approved ? 1 : 0,
        profile.joined_at ?? now,
        now,
        hasStatus ? 1 : 0,
        hasVisibility ? 1 : 0,
        hasAiCardApproved ? 1 : 0,
        hasJoinedAt ? 1 : 0,
      ],
    });
  } catch (e) {
    console.error("upsertCommunityProfile failed:", e);
  }
}

/**
 * Create or lightly refresh an auto-generated community draft. This is used by
 * scans/profile pages to give the owner a starting point, so it must never
 * overwrite an active or already user-edited profile.
 */
export async function ensureCommunityProfileDraft(
  profile: Pick<CommunityProfile, "github_id" | "login"> &
    Partial<
      Pick<
        CommunityProfile,
        | "working_on"
        | "want_to_meet"
        | "contact_method"
        | "chat_topics"
        | "no_recommend_for"
        | "ai_card"
      >
    >,
): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO community_profiles
              (github_id, login, status, visibility, working_on, want_to_meet,
               contact_method, chat_topics, no_recommend_for, ai_card,
               ai_card_approved, joined_at, updated_at)
            VALUES (?, ?, 'pending', 'public', ?, ?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(github_id) DO UPDATE SET
              login            = excluded.login,
              working_on       = COALESCE(NULLIF(community_profiles.working_on, ''), excluded.working_on),
              want_to_meet     = COALESCE(NULLIF(community_profiles.want_to_meet, ''), excluded.want_to_meet),
              contact_method   = COALESCE(NULLIF(community_profiles.contact_method, ''), excluded.contact_method),
              chat_topics      = COALESCE(NULLIF(community_profiles.chat_topics, ''), excluded.chat_topics),
              no_recommend_for = COALESCE(NULLIF(community_profiles.no_recommend_for, ''), excluded.no_recommend_for),
              ai_card          = COALESCE(NULLIF(community_profiles.ai_card, ''), excluded.ai_card),
              updated_at       = excluded.updated_at
            WHERE community_profiles.status != 'active'`,
      args: [
        profile.github_id,
        profile.login.toLowerCase(),
        stringifyBilingualField(profile.working_on),
        stringifyBilingualField(profile.want_to_meet),
        stringifyBilingualField(profile.contact_method),
        stringifyBilingualField(profile.chat_topics),
        stringifyBilingualField(profile.no_recommend_for),
        stringifyBilingualField(profile.ai_card),
        now,
        now,
      ],
    });
  } catch (e) {
    console.error("ensureCommunityProfileDraft failed:", e);
  }
}

/**
 * Update community profile status (active/inactive).
 */
export async function updateCommunityStatus(
  githubId: number,
  status: "active" | "inactive",
): Promise<boolean> {
  const db = getClient();
  if (!db) return false;
  try {
    await ensureSchema(db);
    const now = Date.now();
    const res = await db.execute({
      sql: `UPDATE community_profiles
            SET status = ?, updated_at = ?
            WHERE github_id = ?`,
      args: [status, now, githubId],
    });
    return res.rowsAffected > 0;
  } catch (e) {
    console.error("updateCommunityStatus failed:", e);
    return false;
  }
}

// ============================================================================
// Email-based circle matching
// ============================================================================

export interface CircleEmailSubscriptionInput {
  email: string;
  username: string;
  source?: string;
  consentVersion?: string;
}

export interface CircleEmailRecommendationTarget {
  emailHash: string;
  email: string;
  username: string;
  matchedFacets: string[];
}

const CIRCLE_EMAIL_CONSENT_VERSION = "circle-email-v1";

export function normalizeCircleEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidCircleEmail(raw: string): boolean {
  const email = normalizeCircleEmail(raw);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function circleEmailHash(email: string): string {
  const salt = process.env.AUTH_SECRET ?? "github-roast-circle-email-v1";
  return createHash("sha256").update(salt).update("\0").update(email).digest("hex");
}

export async function upsertCircleEmailSubscription({
  email,
  username,
  source = "roast",
  consentVersion = CIRCLE_EMAIL_CONSENT_VERSION,
}: CircleEmailSubscriptionInput): Promise<boolean> {
  const db = getClient();
  if (!db) return false;
  const normalizedEmail = normalizeCircleEmail(email);
  if (!isValidCircleEmail(normalizedEmail)) return false;
  try {
    await ensureSchema(db);
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO circle_email_subscriptions
              (email_hash, email, username, status, source, consent_version,
               unsubscribe_token, created_at, updated_at)
            VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
            ON CONFLICT(email_hash) DO UPDATE SET
              email              = excluded.email,
              username           = excluded.username,
              status             = 'active',
              source             = excluded.source,
              consent_version    = excluded.consent_version,
              unsubscribe_token  = COALESCE(circle_email_subscriptions.unsubscribe_token, excluded.unsubscribe_token),
              updated_at         = excluded.updated_at`,
      args: [
        circleEmailHash(normalizedEmail),
        normalizedEmail,
        username.toLowerCase(),
        source,
        consentVersion,
        randomUUID(),
        now,
        now,
      ],
    });
    return true;
  } catch (e) {
    console.error("upsertCircleEmailSubscription failed:", e);
    return false;
  }
}

async function facetPairsForUsername(username: string): Promise<string[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT facet_type, facet_value FROM developer_facets
            WHERE username = ? AND facet_type IN ('language', 'org', 'repo')`,
      args: [username.toLowerCase()],
    });
    return [
      ...new Set(
        res.rows.map((r) => `${String(r.facet_type)}:${String(r.facet_value).toLowerCase()}`),
      ),
    ];
  } catch (e) {
    console.error("facetPairsForUsername failed:", e);
    return [];
  }
}

export async function getCircleEmailTargetsForMember(
  memberLogin: string,
  limit = 25,
): Promise<CircleEmailRecommendationTarget[]> {
  const db = getClient();
  if (!db) return [];
  const member = memberLogin.toLowerCase();
  const facetPairs = await facetPairsForUsername(member);
  if (facetPairs.length === 0) return [];
  try {
    await ensureSchema(db);
    const placeholders = facetPairs.map(() => "?").join(", ");
    const res = await db.execute({
      sql: `SELECT ces.email_hash, ces.email, ? AS username,
                   GROUP_CONCAT(DISTINCT df.facet_value) AS matched_facet_list,
                   COUNT(DISTINCT df.facet_type || ':' || LOWER(df.facet_value)) AS shared_facets
            FROM circle_email_subscriptions AS ces
            JOIN developer_facets AS df ON df.username = ces.username
            WHERE ces.status = 'active'
              AND ces.username != ?
              AND df.facet_type IN ('language', 'org', 'repo')
              AND (df.facet_type || ':' || LOWER(df.facet_value)) IN (${placeholders})
              AND NOT EXISTS (
                SELECT 1 FROM circle_email_recommendation_logs AS log
                WHERE log.email_hash = ces.email_hash
                  AND log.match_login = ?
              )
            GROUP BY ces.email_hash, ces.email
            ORDER BY shared_facets DESC, ces.updated_at DESC
            LIMIT ?`,
      args: [member, member, ...facetPairs, member, limit],
    });
    return res.rows.map((r) => ({
      emailHash: String(r.email_hash),
      email: String(r.email),
      username: String(r.username),
      matchedFacets: String(r.matched_facet_list ?? "")
        .split(",")
        .filter(Boolean),
    }));
  } catch (e) {
    console.error("getCircleEmailTargetsForMember failed:", e);
    return [];
  }
}

export async function getCircleEmailTargetsForSubscriber(
  username: string,
  limit = 6,
): Promise<CircleEmailRecommendationTarget[]> {
  const db = getClient();
  if (!db) return [];
  const subscriber = username.toLowerCase();
  const facetPairs = await facetPairsForUsername(subscriber);
  if (facetPairs.length === 0) return [];
  try {
    await ensureSchema(db);
    const subRes = await db.execute({
      sql: `SELECT email_hash, email, username FROM circle_email_subscriptions
            WHERE username = ? AND status = 'active'
            ORDER BY updated_at DESC LIMIT 1`,
      args: [subscriber],
    });
    const sub = subRes.rows[0];
    if (!sub) return [];

    const placeholders = facetPairs.map(() => "?").join(", ");
    const res = await db.execute({
      sql: `SELECT ? AS email_hash, ? AS email, cp.login AS username,
                   GROUP_CONCAT(DISTINCT df.facet_value) AS matched_facet_list,
                   COUNT(DISTINCT df.facet_type || ':' || LOWER(df.facet_value)) AS shared_facets,
                   s.final_score
            FROM community_profiles AS cp
            JOIN scores AS s ON s.username = cp.login
            JOIN developer_facets AS df ON df.username = cp.login
            WHERE cp.status = 'active'
              AND cp.visibility = 'public'
              AND cp.login != ?
              AND s.hidden = 0
              AND df.facet_type IN ('language', 'org', 'repo')
              AND (df.facet_type || ':' || LOWER(df.facet_value)) IN (${placeholders})
              AND NOT EXISTS (
                SELECT 1 FROM circle_email_recommendation_logs AS log
                WHERE log.email_hash = ?
                  AND log.match_login = cp.login
              )
            GROUP BY cp.login
            ORDER BY shared_facets DESC, s.final_score DESC, cp.updated_at DESC
            LIMIT ?`,
      args: [
        String(sub.email_hash),
        String(sub.email),
        subscriber,
        ...facetPairs,
        String(sub.email_hash),
        limit,
      ],
    });
    return res.rows.map((r) => ({
      emailHash: String(r.email_hash),
      email: String(r.email),
      username: String(r.username),
      matchedFacets: String(r.matched_facet_list ?? "")
        .split(",")
        .filter(Boolean),
    }));
  } catch (e) {
    console.error("getCircleEmailTargetsForSubscriber failed:", e);
    return [];
  }
}

export async function markCircleEmailRecommendationSent(
  emailHash: string,
  matchLogin: string,
): Promise<void> {
  const db = getClient();
  if (!db) return;
  try {
    await ensureSchema(db);
    const now = Date.now();
    await db.batch(
      [
        {
          sql: `INSERT OR IGNORE INTO circle_email_recommendation_logs
                  (email_hash, match_login, sent_at)
                VALUES (?, ?, ?)`,
          args: [emailHash, matchLogin.toLowerCase(), now],
        },
        {
          sql: `UPDATE circle_email_subscriptions
                SET last_recommended_at = ?, updated_at = ?
                WHERE email_hash = ?`,
          args: [now, now, emailHash],
        },
      ],
      "write",
    );
  } catch (e) {
    console.error("markCircleEmailRecommendationSent failed:", e);
  }
}

export async function getUnsubscribeToken(emailHash: string): Promise<string | null> {
  const db = getClient();
  if (!db) return null;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT unsubscribe_token FROM circle_email_subscriptions WHERE email_hash = ?`,
      args: [emailHash],
    });
    const row = res.rows[0];
    if (!row) return null;
    if (row.unsubscribe_token) return String(row.unsubscribe_token);
    // Back-fill token for rows created before this column was added.
    const token = randomUUID();
    await db.execute({
      sql: `UPDATE circle_email_subscriptions SET unsubscribe_token = ? WHERE email_hash = ?`,
      args: [token, emailHash],
    });
    return token;
  } catch (e) {
    console.error("getUnsubscribeToken failed:", e);
    return null;
  }
}

export async function unsubscribeByToken(token: string): Promise<boolean> {
  const db = getClient();
  if (!db) return false;
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `UPDATE circle_email_subscriptions
            SET status = 'unsubscribed', updated_at = ?
            WHERE unsubscribe_token = ? AND status = 'active'`,
      args: [Date.now(), token],
    });
    return (res.rowsAffected ?? 0) > 0;
  } catch (e) {
    console.error("unsubscribeByToken failed:", e);
    return false;
  }
}

export interface AdminRoastEmailStats {
  totalRoasts: number;
  roastsWithEmail: number;
  roastsWithoutEmail: number;
  activeEmailSubscriptions: number;
  activeEmailUsernames: number;
}

export async function getAdminRoastEmailStats(): Promise<AdminRoastEmailStats> {
  const db = getClient();
  if (!db) {
    return {
      totalRoasts: 0,
      roastsWithEmail: 0,
      roastsWithoutEmail: 0,
      activeEmailSubscriptions: 0,
      activeEmailUsernames: 0,
    };
  }

  try {
    await ensureSchema(db);
    const [roastRes, emailRes] = await Promise.all([
      db.execute({
        sql: `WITH active_email_usernames AS (
                SELECT DISTINCT lower(username) AS username
                FROM circle_email_subscriptions
                WHERE status = 'active'
              )
              SELECT
                COUNT(*) AS total_roasts,
                SUM(CASE WHEN a.username IS NOT NULL THEN 1 ELSE 0 END) AS roasts_with_email,
                SUM(CASE WHEN a.username IS NULL THEN 1 ELSE 0 END) AS roasts_without_email
              FROM scores AS s
              LEFT JOIN active_email_usernames AS a
                ON lower(s.username) = a.username
              WHERE s.hidden = 0`,
      }),
      db.execute({
        sql: `SELECT
                COUNT(*) AS active_email_subscriptions,
                COUNT(DISTINCT lower(username)) AS active_email_usernames
              FROM circle_email_subscriptions
              WHERE status = 'active'`,
      }),
    ]);

    const roastRow = roastRes.rows[0] ?? {};
    const emailRow = emailRes.rows[0] ?? {};
    return {
      totalRoasts: Number(roastRow.total_roasts ?? 0),
      roastsWithEmail: Number(roastRow.roasts_with_email ?? 0),
      roastsWithoutEmail: Number(roastRow.roasts_without_email ?? 0),
      activeEmailSubscriptions: Number(emailRow.active_email_subscriptions ?? 0),
      activeEmailUsernames: Number(emailRow.active_email_usernames ?? 0),
    };
  } catch (e) {
    console.error("getAdminRoastEmailStats failed:", e);
    return {
      totalRoasts: 0,
      roastsWithEmail: 0,
      roastsWithoutEmail: 0,
      activeEmailSubscriptions: 0,
      activeEmailUsernames: 0,
    };
  }
}


export interface CommunityWaterfallEntry {
  login: string;
  avatar_url: string | null;
  final_score: number;
  tier: Tier;
  /** Facet values (language/org/repo) shared with the VS players — drives both ranking and the card's tag display. */
  matched_facets: string[];
  working_on: { zh: string; en: string } | null;
  want_to_meet: { zh: string; en: string } | null;
}

/**
 * Fetch active, public community profiles relevant to a VS matchup.
 *
 * Relevance is based on developer_facets (language + org + repo overlap).
 * Only members with at least one shared facet are returned — no score-based
 * fallback that would surface unrelated developers.
 *
 * Strategy:
 * 1. Pull language/org/repo facets for both players in one query.
 * 2. Bail immediately if neither player has any facets.
 * 3. Count shared facets per community member in a correlated subquery
 *    (ORDER BY shared_facets DESC, score DESC applied to the full set).
 * 4. Wrap in a subquery so WHERE shared_facets > 0 filters before LIMIT.
 * 5. Also return the matched facet names for display on the card.
 */
export async function getCommunityWaterfall(
  playerLogins: [string, string],
  limit = 8,
): Promise<CommunityWaterfallEntry[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const [a, b] = playerLogins.map((l) => l.toLowerCase());

    // Step 1: fetch all facet types for both players.
    const facetRes = await db.execute({
      sql: `SELECT facet_type, facet_value FROM developer_facets
            WHERE username IN (?, ?) AND facet_type IN ('language', 'org', 'repo')`,
      args: [a, b],
    });

    if (facetRes.rows.length === 0) return [];

    // Key as "type:value" so "language:go" and "org:go" are distinct signals.
    const facetPairs = [
      ...new Set(
        facetRes.rows.map(
          (r) => `${String(r.facet_type)}:${String(r.facet_value).toLowerCase()}`,
        ),
      ),
    ];

    const placeholders = facetPairs.map(() => "?").join(", ");

    // Step 2: count shared facets per community member, filter to > 0, then LIMIT.
    // The outer WHERE shared_facets > 0 runs after the correlated subquery so we
    // never return unrelated members regardless of their score.
    const res = await db.execute({
      sql: `SELECT login, avatar_url, final_score, tier,
                   working_on, want_to_meet, matched_facet_list
            FROM (
              SELECT cp.login,
                     s.avatar_url,
                     s.final_score,
                     s.tier,
                     cp.working_on,
                     cp.want_to_meet,
                     (
                       SELECT GROUP_CONCAT(ordered.facet_value)
                       FROM (
                         SELECT DISTINCT df2.facet_value
                         FROM developer_facets AS df2
                         WHERE df2.username    = cp.login
                           AND df2.facet_type IN ('language', 'org', 'repo')
                           AND (df2.facet_type || ':' || LOWER(df2.facet_value)) IN (${placeholders})
                         ORDER BY df2.facet_type, df2.facet_value
                       ) AS ordered
                     ) AS matched_facet_list,
                     (
                       SELECT COUNT(DISTINCT df.facet_type || ':' || LOWER(df.facet_value))
                       FROM developer_facets AS df
                       WHERE df.username    = cp.login
                         AND df.facet_type IN ('language', 'org', 'repo')
                         AND (df.facet_type || ':' || LOWER(df.facet_value)) IN (${placeholders})
                     ) AS shared_facets
              FROM community_profiles AS cp
              JOIN scores AS s ON s.username = cp.login
              WHERE cp.status     = 'active'
                AND cp.visibility = 'public'
                AND cp.login     != ?
                AND cp.login     != ?
                AND s.hidden      = 0
            )
            WHERE shared_facets > 0
            ORDER BY shared_facets DESC, final_score DESC
            LIMIT ?`,
      // facetPairs appears twice (matched_facet_list + shared_facets subqueries)
      args: [...facetPairs, ...facetPairs, a, b, limit],
    });

    return res.rows.map((r) => {
      const raw = (r.matched_facet_list as string | null) ?? "";
      const matched_facets = raw ? raw.split(",").filter(Boolean) : [];
      return {
        login: String(r.login),
        avatar_url: (r.avatar_url as string | null) ?? null,
        final_score: Number(r.final_score),
        tier: String(r.tier) as Tier,
        matched_facets,
        working_on: parseBilingualField(r.working_on),
        want_to_meet: parseBilingualField(r.want_to_meet),
      };
    });
  } catch (e) {
    console.error("getCommunityWaterfall failed:", e);
    return [];
  }
}

/**
 * Fetch the public community feed for the standalone circle page.
 *
 * This intentionally does not call an LLM. It surfaces users who have opted in
 * to the community, then lets profile content and developer facets provide the
 * initial discovery hooks.
 */
export async function getCommunityFeed(limit = 30): Promise<CommunityWaterfallEntry[]> {
  const db = getClient();
  if (!db) return [];
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT cp.login,
                   s.avatar_url,
                   s.final_score,
                   s.tier,
                   cp.working_on,
                   cp.want_to_meet,
                   (
                     SELECT GROUP_CONCAT(f.facet_value)
                     FROM (
                       SELECT DISTINCT df.facet_value
                       FROM developer_facets AS df
                       WHERE df.username = cp.login
                         AND df.facet_type IN ('language', 'org', 'repo')
                       ORDER BY df.weight DESC, df.facet_type, df.facet_value
                       LIMIT 3
                     ) AS f
                   ) AS matched_facet_list
            FROM community_profiles AS cp
            JOIN scores AS s ON s.username = cp.login
            WHERE cp.status = 'active'
              AND cp.visibility = 'public'
              AND s.hidden = 0
            ORDER BY cp.updated_at DESC, s.final_score DESC
            LIMIT ?`,
      args: [limit],
    });

    return res.rows.map((r) => {
      const raw = (r.matched_facet_list as string | null) ?? "";
      return {
        login: String(r.login),
        avatar_url: (r.avatar_url as string | null) ?? null,
        final_score: Number(r.final_score),
        tier: String(r.tier) as Tier,
        matched_facets: raw ? raw.split(",").filter(Boolean) : [],
        working_on: parseBilingualField(r.working_on),
        want_to_meet: parseBilingualField(r.want_to_meet),
      };
    });
  } catch (e) {
    console.error("getCommunityFeed failed:", e);
    return [];
  }
}

/**
 * Fetch active public community members that match discovery facets.
 *
 * AI search resolves vague intent into facet filters first; this function keeps
 * the final people results inside the opt-in community layer.
 */
export async function getCommunityEntriesByFacets(
  facets: { type: FacetType; value: string }[],
  limit = 30,
): Promise<CommunityWaterfallEntry[]> {
  const db = getClient();
  if (!db) return [];
  const facetPairs = [
    ...new Set(
      facets
        .map((facet) => `${facet.type}:${facet.value.trim().toLowerCase()}`)
        .filter((key) => !key.endsWith(":")),
    ),
  ];
  if (facetPairs.length === 0) return getCommunityFeed(limit);

  try {
    await ensureSchema(db);
    const placeholders = facetPairs.map(() => "?").join(", ");
    const res = await db.execute({
      sql: `SELECT login, avatar_url, final_score, tier,
                   working_on, want_to_meet, matched_facet_list
            FROM (
              SELECT cp.login,
                     s.avatar_url,
                     s.final_score,
                     s.tier,
                     cp.working_on,
                     cp.want_to_meet,
                     cp.updated_at,
                     (
                       SELECT GROUP_CONCAT(ordered.facet_value)
                       FROM (
                         SELECT DISTINCT df2.facet_value
                         FROM developer_facets AS df2
                         WHERE df2.username = cp.login
                           AND df2.facet_type IN ('language', 'org', 'repo')
                           AND (df2.facet_type || ':' || LOWER(df2.facet_value)) IN (${placeholders})
                         ORDER BY df2.facet_type, df2.facet_value
                       ) AS ordered
                     ) AS matched_facet_list,
                     (
                       SELECT COUNT(DISTINCT df.facet_type || ':' || LOWER(df.facet_value))
                       FROM developer_facets AS df
                       WHERE df.username = cp.login
                         AND df.facet_type IN ('language', 'org', 'repo')
                         AND (df.facet_type || ':' || LOWER(df.facet_value)) IN (${placeholders})
                     ) AS shared_facets
              FROM community_profiles AS cp
              JOIN scores AS s ON s.username = cp.login
              WHERE cp.status = 'active'
                AND cp.visibility = 'public'
                AND s.hidden = 0
            )
            WHERE shared_facets > 0
            ORDER BY shared_facets DESC, final_score DESC, updated_at DESC
            LIMIT ?`,
      args: [...facetPairs, ...facetPairs, limit],
    });

    return res.rows.map((r) => {
      const raw = (r.matched_facet_list as string | null) ?? "";
      return {
        login: String(r.login),
        avatar_url: (r.avatar_url as string | null) ?? null,
        final_score: Number(r.final_score),
        tier: String(r.tier) as Tier,
        matched_facets: raw ? raw.split(",").filter(Boolean) : [],
        working_on: parseBilingualField(r.working_on),
        want_to_meet: parseBilingualField(r.want_to_meet),
      };
    });
  } catch (e) {
    console.error("getCommunityEntriesByFacets failed:", e);
    return [];
  }
}

/** A representative member node rendered inside a domain planet card. */
export interface CircleDomainMember {
  login: string;
  avatar_url: string | null;
  tier: Tier;
  final_score: number;
}

/** One domain planet in the community galaxy waterfall. Bilingual name/description
 *  are resolved to the viewer's language in the API/page layer (mirrors the
 *  {@link CommunityWaterfallEntry} convention). */
export interface CircleDomain {
  slug: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string } | null;
  source: "facet" | "ai" | "admin";
  member_count: number;
  heat_score: number;
  /** Facet-derived tag hints for the card (e.g. the facet type). */
  tags: string[];
  members: CircleDomainMember[];
}

/** A page of the domain waterfall plus the opaque cursor for the next page. */
export interface CircleDomainPage {
  domains: CircleDomain[];
  nextCursor: string | null;
}

/** Minimum members a facet bucket needs before it becomes a public domain — a
 *  1-2 person "domain" is just a card, not a planet, and floods the waterfall. */
const MIN_DOMAIN_MEMBERS = 3;
const FALLBACK_MIN_DOMAIN_MEMBERS = 2;
/** Cap on member rows stored per domain. The card shows 3-6; the extra rows let
 *  the future detail page and shuffling pick from a deeper pool without a re-query. */
const MAX_DOMAIN_MEMBERS_STORED = 60;
/** How many representative members each waterfall card carries. */
const DOMAIN_CARD_MEMBERS = 6;

/** Human-readable bilingual name for a facet-derived domain. Kept deterministic
 *  so a rebuild never churns names. `repo` values are "owner/name" — we surface
 *  the repo name (the recognizable half) but keep the full slug as the key. */
function facetDomainName(
  type: FacetType,
  value: string,
): { name: { zh: string; en: string }; tag: string } {
  if (type === "language") {
    return { name: { zh: `${value} 开发者`, en: `${value} developers` }, tag: value };
  }
  if (type === "org") {
    return { name: { zh: `${value} 圈子`, en: `${value} circle` }, tag: value };
  }
  // repo — "owner/name"
  const repoName = value.includes("/") ? value.slice(value.indexOf("/") + 1) : value;
  return { name: { zh: `${repoName} 贡献者`, en: `${repoName} contributors` }, tag: repoName };
}

function facetDomainSlug(type: FacetType, value: string): string {
  const normalized = `${type}:${value.trim().toLowerCase()}`;
  const readable =
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "domain";
  const suffix = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${type}:${readable}-${suffix}`;
}

/**
 * Rebuild the facet-derived community domains (Phase 1) from `developer_facets`
 * joined to the opt-in `community_profiles` + `scores`. Makes no external calls:
 * it reads the local data moat and rewrites the `source = 'facet'` domains and
 * their member rows wholesale in one transaction, so it self-heals as scores and
 * facets refresh and is safe to re-run. AI-merged domains (source = 'ai') are
 * left untouched. No-op without Turso; best-effort like the rest of this module.
 *
 * Returns a small summary for the admin backfill route.
 */
export async function rebuildCircleDomainsFromFacets(): Promise<{
  domains: number;
  members: number;
}> {
  const db = getClient();
  if (!db) return { domains: 0, members: 0 };
  try {
    await ensureSchema(db);
    // Every (facet, member) pair for active public community members that have a
    // score. One index-driven scan; the community layer is opt-in so this set is
    // small (hundreds), making the in-JS grouping below cheap.
    const res = await db.execute({
      sql: `SELECT df.facet_type  AS facet_type,
                   df.facet_value AS facet_value,
                   df.weight      AS weight,
                   cp.login       AS login,
                   s.avatar_url   AS avatar_url,
                   s.final_score  AS final_score,
                   s.tier         AS tier
            FROM developer_facets AS df
            JOIN community_profiles AS cp ON cp.login = df.username
            JOIN scores AS s ON s.username = df.username
            WHERE df.facet_type IN ('language', 'org', 'repo')
              AND cp.status = 'active'
              AND cp.visibility = 'public'
              AND s.hidden = 0`,
      args: [],
    });

    type Bucket = {
      type: FacetType;
      value: string;
      members: {
        login: string;
        weight: number;
        avatar_url: string | null;
        final_score: number;
        tier: Tier;
      }[];
      scoreSum: number;
    };
    const buckets = new Map<string, Bucket>();
    for (const r of res.rows) {
      const type = String(r.facet_type) as FacetType;
      const value = String(r.facet_value);
      const slug = facetDomainSlug(type, value);
      let bucket = buckets.get(slug);
      if (!bucket) {
        bucket = { type, value, members: [], scoreSum: 0 };
        buckets.set(slug, bucket);
      }
      const finalScore = Number(r.final_score) || 0;
      bucket.members.push({
        login: String(r.login),
        weight: Number(r.weight) || 0,
        avatar_url: (r.avatar_url as string | null) ?? null,
        final_score: finalScore,
        tier: String(r.tier) as Tier,
      });
      bucket.scoreSum += finalScore;
    }

    const now = Date.now();
    const domainStatements: { sql: string; args: (string | number)[] }[] = [];
    const memberStatements: { sql: string; args: (string | number)[] }[] = [];
    let memberCount = 0;

    for (const [slug, bucket] of buckets) {
      if (bucket.members.length < MIN_DOMAIN_MEMBERS) continue;
      const size = bucket.members.length;
      const avgScore = size > 0 ? bucket.scoreSum / size : 0;
      // Heat blends reach (member count) with quality (avg score) so a big bucket
      // of strong developers floats to the top of the waterfall.
      const heatScore = Math.round(size * 100 + avgScore);
      const { name, tag } = facetDomainName(bucket.type, bucket.value);

      domainStatements.push({
        sql: `INSERT INTO circle_domains
                (slug, name_zh, name_en, description_zh, description_en,
                 source, status, member_count, heat_score, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'facet', 'active', ?, ?, ?, ?)
              ON CONFLICT(slug) DO UPDATE SET
                name_zh = excluded.name_zh,
                name_en = excluded.name_en,
                member_count = excluded.member_count,
                heat_score = excluded.heat_score,
                status = 'active',
                updated_at = excluded.updated_at`,
        args: [
          slug,
          name.zh,
          name.en,
          JSON.stringify({ tag }),
          JSON.stringify({ tag }),
          size,
          heatScore,
          now,
          now,
        ],
      });

      const topMembers = [...bucket.members]
        .sort((a, b) => b.weight - a.weight || b.final_score - a.final_score)
        .slice(0, MAX_DOMAIN_MEMBERS_STORED);
      for (const m of topMembers) {
        memberStatements.push({
          sql: `INSERT INTO circle_domain_members
                  (domain_slug, login, weight, reason_zh, reason_en, created_at, updated_at)
                VALUES (?, ?, ?, NULL, NULL, ?, ?)
                ON CONFLICT(domain_slug, login) DO UPDATE SET
                  weight = excluded.weight,
                  updated_at = excluded.updated_at`,
          args: [slug, m.login, m.weight, now, now],
        });
        memberCount += 1;
      }
    }

    // Rewrite the facet-source domains wholesale: drop the old facet domains and
    // their member rows first (so a bucket that fell below the floor disappears),
    // then reinsert. AI-source domains are never touched.
    await db.batch(
      [
        {
          sql: `DELETE FROM circle_domain_members
                WHERE domain_slug IN (
                  SELECT slug FROM circle_domains WHERE source = 'facet'
                )`,
          args: [],
        },
        { sql: `DELETE FROM circle_domains WHERE source = 'facet'`, args: [] },
        ...domainStatements,
        ...memberStatements,
      ],
      "write",
    );

    return { domains: domainStatements.length, members: memberCount };
  } catch (e) {
    console.error("rebuildCircleDomainsFromFacets failed:", e);
    return { domains: 0, members: 0 };
  }
}

/** Parse the domain description blob, which today stores only a `{tag}` hint. */
function parseDomainTags(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.tag === "string") {
      return [parsed.tag];
    }
  } catch {
    // legacy/plain string — ignore
  }
  return [];
}

function domainFromFacetRows(rows: unknown[]): CircleDomain[] {
  type Bucket = {
    type: FacetType;
    value: string;
    members: CircleDomainMember[];
    scoreSum: number;
    weightSum: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const row of rows as Record<string, unknown>[]) {
    const type = String(row.facet_type) as FacetType;
    if (type !== "language" && type !== "org" && type !== "repo") continue;
    const value = String(row.facet_value ?? "").trim();
    if (!value) continue;
    const slug = facetDomainSlug(type, value);
    let bucket = buckets.get(slug);
    if (!bucket) {
      bucket = { type, value, members: [], scoreSum: 0, weightSum: 0 };
      buckets.set(slug, bucket);
    }
    const finalScore = Number(row.final_score) || 0;
    const weight = Number(row.weight) || 0;
    bucket.members.push({
      login: String(row.login),
      avatar_url: (row.avatar_url as string | null) ?? null,
      final_score: finalScore,
      tier: String(row.tier) as Tier,
    });
    bucket.scoreSum += finalScore;
    bucket.weightSum += weight;
  }

  const domains: CircleDomain[] = [];
  for (const [slug, bucket] of buckets) {
    if (bucket.members.length < FALLBACK_MIN_DOMAIN_MEMBERS) continue;
    const size = bucket.members.length;
    const avgScore = size > 0 ? bucket.scoreSum / size : 0;
    const { name, tag } = facetDomainName(bucket.type, bucket.value);
    domains.push({
      slug,
      name,
      description: null,
      source: "facet",
      member_count: size,
      heat_score: Math.round(size * 100 + avgScore + bucket.weightSum),
      tags: [tag],
      members: bucket.members
        .sort((a, b) => b.final_score - a.final_score)
        .slice(0, DOMAIN_CARD_MEMBERS),
    });
  }
  return domains.sort(
    (a, b) =>
      b.heat_score - a.heat_score ||
      b.member_count - a.member_count ||
      a.slug.localeCompare(b.slug),
  );
}

async function getCommunityDomainsFromFacets(
  db: Client,
  limit: number,
  offset: number,
): Promise<CircleDomainPage> {
  const rowLimit = Math.min(2000, Math.max(200, (offset + limit + 1) * 80));
  const res = await db.execute({
    sql: `SELECT df.facet_type,
                 df.facet_value,
                 df.weight,
                 s.username AS login,
                 s.avatar_url,
                 s.final_score,
                 s.tier
          FROM developer_facets AS df
          JOIN scores AS s ON s.username = df.username
          LEFT JOIN community_profiles AS cp ON cp.login = df.username
          WHERE df.facet_type IN ('language', 'org', 'repo')
            AND s.hidden = 0
            AND (
              cp.github_id IS NULL
              OR (cp.status = 'active' AND cp.visibility = 'public')
            )
          ORDER BY
            CASE WHEN cp.status = 'active' AND cp.visibility = 'public' THEN 1 ELSE 0 END DESC,
            df.weight DESC,
            s.final_score DESC
          LIMIT ?`,
    args: [rowLimit],
  });

  const domains = domainFromFacetRows(res.rows);
  const page = domains.slice(offset, offset + limit);
  const hasMore = domains.length > offset + limit;
  return {
    domains: page,
    nextCursor: hasMore ? String(offset + limit) : null,
  };
}

async function getCommunityDomainFromFacets(
  db: Client,
  slug: string,
): Promise<CircleDomain | null> {
  const type = slug.split(":", 1)[0] as FacetType;
  if (type !== "language" && type !== "org" && type !== "repo") return null;

  const valuesRes = await db.execute({
    sql: `SELECT DISTINCT df.facet_value
          FROM developer_facets AS df
          JOIN scores AS s ON s.username = df.username
          LEFT JOIN community_profiles AS cp ON cp.login = df.username
          WHERE df.facet_type = ?
            AND s.hidden = 0
            AND (
              cp.github_id IS NULL
              OR (cp.status = 'active' AND cp.visibility = 'public')
            )
          LIMIT 5000`,
    args: [type],
  });
  const value = valuesRes.rows
    .map((r) => String(r.facet_value ?? "").trim())
    .find((v) => v && facetDomainSlug(type, v) === slug);
  if (!value) return null;

  const statsRes = await db.execute({
    sql: `SELECT COUNT(*) AS member_count,
                 AVG(s.final_score) AS avg_score,
                 SUM(df.weight) AS weight_sum
          FROM developer_facets AS df
          JOIN scores AS s ON s.username = df.username
          LEFT JOIN community_profiles AS cp ON cp.login = df.username
          WHERE df.facet_type = ?
            AND df.facet_value = ?
            AND s.hidden = 0
            AND (
              cp.github_id IS NULL
              OR (cp.status = 'active' AND cp.visibility = 'public')
            )`,
    args: [type, value],
  });
  const stats = statsRes.rows[0] ?? {};
  const memberCount = Number(stats.member_count) || 0;
  if (memberCount < FALLBACK_MIN_DOMAIN_MEMBERS) return null;

  const memberRes = await db.execute({
    sql: `SELECT df.username AS login,
                 s.avatar_url,
                 s.final_score,
                 s.tier
          FROM developer_facets AS df
          JOIN scores AS s ON s.username = df.username
          LEFT JOIN community_profiles AS cp ON cp.login = df.username
          WHERE df.facet_type = ?
            AND df.facet_value = ?
            AND s.hidden = 0
            AND (
              cp.github_id IS NULL
              OR (cp.status = 'active' AND cp.visibility = 'public')
            )
          ORDER BY df.weight DESC, s.final_score DESC
          LIMIT ?`,
    args: [type, value, MAX_DOMAIN_MEMBERS_STORED],
  });
  const { name, tag } = facetDomainName(type, value);
  const avgScore = Number(stats.avg_score) || 0;
  const weightSum = Number(stats.weight_sum) || 0;

  return {
    slug,
    name,
    description: null,
    source: "facet",
    member_count: memberCount,
    heat_score: Math.round(memberCount * 100 + avgScore + weightSum),
    tags: [tag],
    members: memberRes.rows.map((r) => ({
      login: String(r.login),
      avatar_url: (r.avatar_url as string | null) ?? null,
      final_score: Number(r.final_score),
      tier: String(r.tier) as Tier,
    })),
  };
}

/**
 * One page of the community galaxy waterfall: active domains ordered by heat,
 * each with its top {@link DOMAIN_CARD_MEMBERS} representative members. The
 * cursor is an opaque numeric offset; a rebuild is infrequent enough that offset
 * paging won't visibly skip/dup during a scroll. No-op-safe without Turso.
 */
export async function getCommunityDomains(options: {
  cursor?: string | null;
  limit?: number;
} = {}): Promise<CircleDomainPage> {
  const db = getClient();
  if (!db) return { domains: [], nextCursor: null };
  try {
    await ensureSchema(db);
    const limit = Math.max(1, Math.min(24, options.limit ?? 8));
    const offset = Math.max(0, Number(options.cursor) || 0);

    // Fetch one extra row to know whether a next page exists.
    const domainRes = await db.execute({
      sql: `SELECT slug, name_zh, name_en, description_zh, source,
                   member_count, heat_score
            FROM circle_domains
            WHERE status = 'active'
            ORDER BY heat_score DESC, member_count DESC, slug ASC
            LIMIT ? OFFSET ?`,
      args: [limit + 1, offset],
    });

    const pageRows = domainRes.rows.slice(0, limit);
    const hasMore = domainRes.rows.length > limit;
    if (pageRows.length === 0) {
      return getCommunityDomainsFromFacets(db, limit, offset);
    }

    const slugs = pageRows.map((r) => String(r.slug));
    const placeholders = slugs.map(() => "?").join(", ");

    // Top members for every domain on this page in one round trip. ROW_NUMBER
    // partitions per domain so we cap at DOMAIN_CARD_MEMBERS without N queries.
    const memberRes = await db.execute({
      sql: `SELECT domain_slug, login, avatar_url, final_score, tier
            FROM (
              SELECT dm.domain_slug,
                     dm.login,
                     s.avatar_url,
                     s.final_score,
                     s.tier,
                     ROW_NUMBER() OVER (
                       PARTITION BY dm.domain_slug
                       ORDER BY dm.weight DESC, s.final_score DESC
                     ) AS rn
              FROM circle_domain_members AS dm
              JOIN scores AS s ON s.username = dm.login
              WHERE dm.domain_slug IN (${placeholders})
                AND s.hidden = 0
            )
            WHERE rn <= ?`,
      args: [...slugs, DOMAIN_CARD_MEMBERS],
    });

    const membersBySlug = new Map<string, CircleDomainMember[]>();
    for (const r of memberRes.rows) {
      const slug = String(r.domain_slug);
      const list = membersBySlug.get(slug) ?? [];
      list.push({
        login: String(r.login),
        avatar_url: (r.avatar_url as string | null) ?? null,
        final_score: Number(r.final_score),
        tier: String(r.tier) as Tier,
      });
      membersBySlug.set(slug, list);
    }

    const domains: CircleDomain[] = pageRows.map((r) => {
      const slug = String(r.slug);
      return {
        slug,
        name: { zh: String(r.name_zh), en: String(r.name_en ?? r.name_zh) },
        description: null,
        source: String(r.source) as CircleDomain["source"],
        member_count: Number(r.member_count),
        heat_score: Number(r.heat_score),
        tags: parseDomainTags(r.description_zh),
        members: membersBySlug.get(slug) ?? [],
      };
    });

    return { domains, nextCursor: hasMore ? String(offset + limit) : null };
  } catch (e) {
    console.error("getCommunityDomains failed:", e);
    return { domains: [], nextCursor: null };
  }
}

/** Full detail for a single domain: metadata plus its stored member pool ranked
 *  by weight then score. Used by the domain detail page. */
export async function getCommunityDomain(
  slug: string,
): Promise<CircleDomain | null> {
  const db = getClient();
  if (!db || !slug) return null;
  try {
    await ensureSchema(db);
    const domainRes = await db.execute({
      sql: `SELECT slug, name_zh, name_en, description_zh, source,
                   member_count, heat_score
            FROM circle_domains
            WHERE slug = ? AND status = 'active'`,
      args: [slug],
    });
    const row = domainRes.rows[0];
    if (!row) return getCommunityDomainFromFacets(db, slug);

    const memberRes = await db.execute({
      sql: `SELECT dm.login, s.avatar_url, s.final_score, s.tier
            FROM circle_domain_members AS dm
            JOIN scores AS s ON s.username = dm.login
            WHERE dm.domain_slug = ? AND s.hidden = 0
            ORDER BY dm.weight DESC, s.final_score DESC
            LIMIT ?`,
      args: [slug, MAX_DOMAIN_MEMBERS_STORED],
    });

    return {
      slug: String(row.slug),
      name: { zh: String(row.name_zh), en: String(row.name_en ?? row.name_zh) },
      description: null,
      source: String(row.source) as CircleDomain["source"],
      member_count: Number(row.member_count),
      heat_score: Number(row.heat_score),
      tags: parseDomainTags(row.description_zh),
      members: memberRes.rows.map((r) => ({
        login: String(r.login),
        avatar_url: (r.avatar_url as string | null) ?? null,
        final_score: Number(r.final_score),
        tier: String(r.tier) as Tier,
      })),
    };
  } catch (e) {
    console.error("getCommunityDomain failed:", e);
    return null;
  }
}

interface CreateProfileCommentInput {
  targetUsername: string;
  text: string;
  author: ProfileCommentAuthor;
  authorGithubId?: number;
}

function toProfileComment(row: Record<string, unknown>): ProfileComment {
  const authorLogin =
    typeof row.author_login === "string" && row.author_login
      ? row.author_login
      : null;
  const authorAvatarUrl =
    typeof row.author_avatar_url === "string" && row.author_avatar_url
      ? row.author_avatar_url
      : null;
  const author: ProfileCommentAuthor =
    row.author_kind === "github" && authorLogin
      ? { type: "github", username: authorLogin, avatarUrl: authorAvatarUrl }
      : { type: "anonymous" };

  return {
    id: String(row.id),
    targetUsername: String(row.target_username),
    author,
    text: String(row.body),
    createdAt: Number(row.created_at),
  };
}

export async function getProfileComments(
  targetUsername: string,
  limit = 24,
): Promise<ProfileComment[]> {
  const db = getClient();
  if (!db) return [];
  const target = normalizeGitHubUsername(targetUsername);
  if (!target) return [];
  try {
    await ensureSchema(db);
    const res = await db.execute({
      sql: `SELECT id, target_username, body, author_kind, author_login,
                   author_avatar_url, created_at
            FROM (
              SELECT rowid AS sort_rowid, id, target_username, body, author_kind,
                     author_login, author_avatar_url, created_at
              FROM profile_comments
              WHERE target_username = ? AND hidden = 0
              ORDER BY created_at DESC, rowid DESC
              LIMIT ?
            )
            ORDER BY created_at ASC, sort_rowid ASC`,
      args: [target, Math.max(1, Math.min(100, limit))],
    });
    return res.rows.map((row) => toProfileComment(row as Record<string, unknown>));
  } catch (e) {
    console.error("getProfileComments failed:", e);
    return [];
  }
}

export async function createProfileComment(
  input: CreateProfileCommentInput,
): Promise<ProfileComment | null> {
  const db = getClient();
  if (!db) return null;
  const target = normalizeGitHubUsername(input.targetUsername);
  const text = normalizeCommentText(input.text);
  if (!target || !text) return null;

  const githubAuthor =
    input.author.type === "github"
      ? normalizeGitHubUsername(input.author.username)
      : null;
  const authorKind = githubAuthor ? "github" : "anonymous";
  const authorAvatarUrl =
    input.author.type === "github" ? input.author.avatarUrl ?? null : null;
  const now = Date.now();
  const id = randomUUID();

  try {
    await ensureSchema(db);
    await db.execute({
      sql: `INSERT INTO profile_comments
              (id, target_username, body, author_kind, author_github_id,
               author_login, author_avatar_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        target,
        text,
        authorKind,
        authorKind === "github" ? input.authorGithubId ?? null : null,
        githubAuthor,
        authorKind === "github" ? authorAvatarUrl : null,
        now,
      ],
    });
    return {
      id,
      targetUsername: target,
      author: githubAuthor
        ? { type: "github", username: githubAuthor, avatarUrl: authorAvatarUrl }
        : { type: "anonymous" },
      text,
      createdAt: now,
    };
  } catch (e) {
    console.error("createProfileComment failed:", e);
    return null;
  }
}

interface SetProfileReactionInput {
  targetUsername: string;
  voterGithubId: number;
  voterLogin: string;
  reaction: ProfileReaction;
}

interface RemoveProfileReactionInput {
  targetUsername: string;
  voterGithubId: number;
}

function validGithubId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Cache-aside read of a profile's global reaction tallies. A hit skips the
 *  GROUP BY entirely — the hot path for crawlers and logged-out visitors. */
async function readReactionCounts(
  db: Client,
  target: string,
): Promise<ProfileReactionCounts> {
  const cached = await getCachedReactionCounts(target);
  if (cached) return cached;
  const counts = emptyReactionCounts();
  const res = await db.execute({
    sql: `SELECT reaction, COUNT(*) AS count
          FROM profile_reactions
          WHERE target_username = ?
          GROUP BY reaction`,
    args: [target],
  });
  for (const row of res.rows) {
    if (isProfileReaction(row.reaction)) counts[row.reaction] = Number(row.count) || 0;
  }
  await setCachedReactionCounts(target, counts);
  return counts;
}

export async function getProfileReactionState(
  targetUsername: string,
  viewerGithubId?: number,
): Promise<ProfileReactionState> {
  const db = getClient();
  const target = normalizeGitHubUsername(targetUsername);
  if (!db || !target) return { counts: emptyReactionCounts(), viewerReaction: null };

  try {
    await ensureSchema(db);
    const [counts, viewerResult] = await Promise.all([
      readReactionCounts(db, target),
      validGithubId(viewerGithubId ?? 0)
        ? db.execute({
            sql: `SELECT reaction
                  FROM profile_reactions
                  WHERE target_username = ? AND voter_github_id = ?`,
            args: [target, viewerGithubId!],
          })
        : Promise.resolve(null),
    ]);

    const viewerValue = viewerResult?.rows[0]?.reaction;
    return {
      counts,
      viewerReaction: isProfileReaction(viewerValue) ? viewerValue : null,
    };
  } catch (e) {
    console.error("getProfileReactionState failed:", e);
    return { counts: emptyReactionCounts(), viewerReaction: null };
  }
}

export async function setProfileReaction(
  input: SetProfileReactionInput,
): Promise<ProfileReactionState | null> {
  const db = getClient();
  const target = normalizeGitHubUsername(input.targetUsername);
  const voterLogin = normalizeGitHubUsername(input.voterLogin);
  if (
    !db ||
    !target ||
    !voterLogin ||
    !validGithubId(input.voterGithubId) ||
    !isProfileReaction(input.reaction)
  ) {
    return null;
  }

  try {
    await ensureSchema(db);
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO profile_reactions
              (target_username, voter_github_id, voter_login, reaction, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(target_username, voter_github_id) DO UPDATE SET
              voter_login = excluded.voter_login,
              reaction = excluded.reaction,
              updated_at = excluded.updated_at`,
      args: [target, input.voterGithubId, voterLogin, input.reaction, now, now],
    });
    await clearCachedReactionCounts(target);
    return getProfileReactionState(target, input.voterGithubId);
  } catch (e) {
    console.error("setProfileReaction failed:", e);
    return null;
  }
}

export async function removeProfileReaction(
  input: RemoveProfileReactionInput,
): Promise<ProfileReactionState | null> {
  const db = getClient();
  const target = normalizeGitHubUsername(input.targetUsername);
  if (!db || !target || !validGithubId(input.voterGithubId)) return null;

  try {
    await ensureSchema(db);
    await db.execute({
      sql: `DELETE FROM profile_reactions
            WHERE target_username = ? AND voter_github_id = ?`,
      args: [target, input.voterGithubId],
    });
    await clearCachedReactionCounts(target);
    return getProfileReactionState(target, input.voterGithubId);
  } catch (e) {
    console.error("removeProfileReaction failed:", e);
    return null;
  }
}
