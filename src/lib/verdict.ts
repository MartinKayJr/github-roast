/**
 * Deterministic PK verdict engine — no LLM. Given two account details it buckets
 * the matchup by score gap (碾压 / 险胜 / 五五开), picks the winner, computes the
 * per-dimension winners, and selects a savage verdict template *deterministically*
 * from the pair identity so the SSR page and the OG image always render the same
 * line for a given /vs URL.
 *
 * The verdict *sentences* live in the `vs` i18n namespace (`verdictCrush.0` …),
 * so translators own them. This module returns a message key + interpolation
 * slots; the page / OG route render them via `getTranslations`.
 */
import type { AccountDetail } from "./db";
import { DIMENSIONS } from "./dimensions";
import type { SubScoreKey } from "./types";

export type VerdictBucket = "crush" | "edge" | "even";

/** Score-gap thresholds (points) for each bucket. Tunable. */
export const CRUSH_GAP = 15;
export const EDGE_GAP = 4;

/** How many verdict templates exist per bucket in the `vs` messages. MUST stay
 *  in sync with `verdictCrush`/`verdictEdge`/`verdictEven` array lengths in
 *  `src/messages/{zh,en}.json` (guarded by the messages test). */
export const VERDICT_TEMPLATE_COUNT: Record<VerdictBucket, number> = {
  crush: 8,
  edge: 8,
  even: 8,
};

export interface Verdict {
  /** True when a side has no scored data yet — page shows a summon CTA, no line. */
  missing: boolean;
  bucket: VerdictBucket;
  winner: "a" | "b" | "tie";
  gap: number;
  /** Fully-qualified `vs` message key, e.g. "verdictCrush.3". Empty when missing. */
  templateKey: string;
  /** Interpolation values for the template (always the full set; templates use a subset). */
  slots: Record<string, string>;
  dimWinners: Record<SubScoreKey, "a" | "b" | "tie">;
}

const BUCKET_MSG: Record<VerdictBucket, string> = {
  crush: "verdictCrush",
  edge: "verdictEdge",
  even: "verdictEven",
};

/** Stable string hash (djb2) — deterministic template pick without Math.random. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function bucketFor(gap: number): VerdictBucket {
  if (gap >= CRUSH_GAP) return "crush";
  if (gap >= EDGE_GAP) return "edge";
  return "even";
}

/** Compute the PK verdict for two accounts (either may be null when unscored). */
export function verdict(
  a: AccountDetail | null,
  b: AccountDetail | null,
): Verdict {
  const emptyDims = Object.fromEntries(
    DIMENSIONS.map((k) => [k, "tie"]),
  ) as Record<SubScoreKey, "a" | "b" | "tie">;

  if (!a || !b) {
    return {
      missing: true,
      bucket: "even",
      winner: "tie",
      gap: 0,
      templateKey: "",
      slots: {},
      dimWinners: emptyDims,
    };
  }

  const gap = Math.abs(a.final_score - b.final_score);
  const bucket = bucketFor(gap);
  const winner: "a" | "b" | "tie" =
    gap < 0.005 ? "tie" : a.final_score > b.final_score ? "a" : "b";

  const dimWinners = Object.fromEntries(
    DIMENSIONS.map((k) => {
      const va = a.sub_scores[k] ?? 0;
      const vb = b.sub_scores[k] ?? 0;
      const w = Math.abs(va - vb) < 0.005 ? "tie" : va > vb ? "a" : "b";
      return [k, w];
    }),
  ) as Record<SubScoreKey, "a" | "b" | "tie">;

  const winSide = winner === "b" ? b : a;
  const loseSide = winner === "b" ? a : b;

  // Deterministic template index from the canonical (order-independent) pair.
  const pairKey = [a.username.toLowerCase(), b.username.toLowerCase()].sort().join("|");
  const index = hashString(pairKey) % VERDICT_TEMPLATE_COUNT[bucket];

  return {
    missing: false,
    bucket,
    winner,
    gap,
    templateKey: `${BUCKET_MSG[bucket]}.${index}`,
    slots: {
      winner: winSide.username,
      loser: loseSide.username,
      gap: gap.toFixed(1),
      winnerScore: winSide.final_score.toFixed(2),
      loserScore: loseSide.final_score.toFixed(2),
    },
    dimWinners,
  };
}
