/**
 * Pure classification helpers that turn a developer's profile snapshot into
 * queryable *facets* — the discovery axes for the `/developers` directory.
 *
 * Two facet types ship in phase 1:
 *   - `language` — the dev's primary programming languages (by byte share across
 *     their top repos), so the directory can list "top Rust developers".
 *   - `org` — the GitHub organizations they belong to (huggingface, pytorch …),
 *     a strong circle/affiliation signal.
 *
 * Side-effect free and dependency-light (mirrors {@link ./profile-insights}) so
 * it's trivially unit-tested and reused by both the fire-and-forget write path in
 * `recordProfileSnapshot` and the one-off facet backfill. The DB layer turns the
 * returned {@link Facet}[] into `developer_facets` rows.
 */
import { aggregateLanguages } from "./profile-insights";
import type { TopRepo } from "./types";

export type FacetType = "language" | "org";

export interface Facet {
  type: FacetType;
  /** Canonical, groupable value — e.g. "Rust", "huggingface". Also the display
   *  string (no separate label column), so it stays human-readable. */
  value: string;
  /** language: percent byte-share among the dev's *kept* languages (0–100);
   *  org: always 1. Lets the reader pick a dev's single primary language later. */
  weight: number;
}

/** Cap on how many of each facet type one developer contributes. Languages are
 *  narrow (a dev "is" 1–3 languages); orgs are higher-signal so we keep more. */
const MAX_LANGUAGES_PER_DEV = 3;
const MAX_ORGS_PER_DEV = 5;
/** A language must own at least this byte-share (of the dev's real code) to be a
 *  facet — unless it's their single top language, which is always kept so any
 *  dev with real code lands in at least one language bucket. */
const MIN_LANGUAGE_PCT = 15;

/**
 * GitHub Linguist reports markup, build, and doc formats as "languages". Nobody
 * discovers a "CSS developer" or a "Makefile developer", so these are dropped
 * before ranking to keep the directory buckets meaningful. Curated and
 * intentionally conservative — tune here, it's the one knob for language noise.
 */
const LANGUAGE_EXCLUDE = new Set(
  [
    "HTML",
    "CSS",
    "SCSS",
    "Sass",
    "Less",
    "Stylus",
    "Makefile",
    "CMake",
    "Dockerfile",
    "Batchfile",
    "Shell",
    "PowerShell",
    "Roff",
    "TeX",
    "Rich Text Format",
    "Jupyter Notebook",
    "Vim Snippet",
  ].map((n) => n.toLowerCase()),
);

function isRealLanguage(name: string): boolean {
  return !LANGUAGE_EXCLUDE.has(name.trim().toLowerCase());
}

/**
 * The dev's primary language facets: aggregate byte share across their repos
 * (via {@link aggregateLanguages}), drop markup/build noise, re-normalize the
 * remaining shares to sum ~100, then keep those clearing {@link MIN_LANGUAGE_PCT}
 * (always keeping the single top one). Returns [] when there's no real-code
 * signal at all.
 */
function languageFacets(topRepos: TopRepo[]): Facet[] {
  const shares = aggregateLanguages(topRepos, 12).filter((l) => isRealLanguage(l.name));
  if (shares.length === 0) return [];

  const total = shares.reduce((sum, l) => sum + l.pct, 0);
  if (total === 0) return [];

  const renormalized = shares.map((l) => ({
    value: l.name,
    weight: Math.round((l.pct / total) * 100),
  }));

  const kept = renormalized.filter((l, i) => i === 0 || l.weight >= MIN_LANGUAGE_PCT);
  return kept
    .slice(0, MAX_LANGUAGES_PER_DEV)
    .map((l) => ({ type: "language" as const, value: l.value, weight: l.weight }));
}

/** Org facets: trimmed, deduped org logins the dev belongs to (weight 1). */
function orgFacets(organizations: string[]): Facet[] {
  const seen = new Set<string>();
  const out: Facet[] = [];
  for (const raw of organizations) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: "org", value, weight: 1 });
    if (out.length >= MAX_ORGS_PER_DEV) break;
  }
  return out;
}

/**
 * All discovery facets for one developer, derived from the raw signals a profile
 * snapshot carries. Deterministic and side-effect free.
 */
export function extractFacets(input: {
  top_repos?: TopRepo[] | null;
  organizations?: string[] | null;
}): Facet[] {
  return [
    ...languageFacets(input.top_repos ?? []),
    ...orgFacets(input.organizations ?? []),
  ];
}
