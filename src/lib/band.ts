/** Growth band — score-range segments shown on the home growth leaderboard. */
export type BandKey = "S+" | "S" | "A+" | "A" | "B+" | "B" | "C+" | "C";

export const BAND_KEYS: BandKey[] = ["S+", "S", "A+", "A", "B+", "B", "C+", "C"];

/** Default band shown when the page first loads — large enough to have entries. */
export const DEFAULT_BAND: BandKey = "A";

interface BandThreshold {
  band: BandKey;
  min: number;
  /** Tailwind text color class */
  text: string;
  /** Tailwind ring/border color class */
  ring: string;
}

export const BAND_THRESHOLDS: BandThreshold[] = [
  { band: "S+", min: 95, text: "text-amber-300", ring: "ring-amber-400/50" },
  { band: "S", min: 90, text: "text-yellow-300", ring: "ring-yellow-400/50" },
  { band: "A+", min: 85, text: "text-violet-300", ring: "ring-violet-400/50" },
  { band: "A", min: 80, text: "text-indigo-300", ring: "ring-indigo-400/50" },
  { band: "B+", min: 75, text: "text-emerald-300", ring: "ring-emerald-400/50" },
  { band: "B", min: 70, text: "text-teal-300", ring: "ring-teal-400/50" },
  { band: "C+", min: 60, text: "text-sky-300", ring: "ring-sky-400/40" },
  { band: "C", min: 0, text: "text-slate-300", ring: "ring-slate-400/30" },
];

export function bandFor(score: number): BandKey {
  for (const { band, min } of BAND_THRESHOLDS) {
    if (score >= min) return band;
  }
  return "C";
}

export function bandStyle(band: BandKey): BandThreshold {
  return BAND_THRESHOLDS.find((b) => b.band === band) ?? BAND_THRESHOLDS[BAND_THRESHOLDS.length - 1];
}
