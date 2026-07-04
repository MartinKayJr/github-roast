import { getTranslations } from "next-intl/server";
import { BAND_KEYS, bandFor, DEFAULT_BAND, type BandKey } from "@/lib/band";
import { getContributionGrowthLeaderboard, type GrowthLeaderboardEntry } from "@/lib/db";
import { HomeGrowthLeaderboardClient, type GrowthLabels } from "./HomeGrowthLeaderboardClient";

const GROWTH_WINDOW = "30d" as const;
const DEFAULT_BAND_PRIORITY: BandKey[] = ["A", "B+", "C+", "B", "C", "A+", "S", "S+"];
const GROWTH_LIMIT = 500;

export type GrowthEntry = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  band: BandKey;
  contribution_delta: number;
  merged_pr_delta: number;
  impact_commit_delta: number;
  growth_score: number;
  latest_snapshot_at: number;
};

function toGrowthEntry(e: GrowthLeaderboardEntry): GrowthEntry | null {
  if (e.growth_score <= 0) return null;
  return {
    username: e.username,
    display_name: e.display_name ?? null,
    avatar_url: e.avatar_url ?? null,
    band: bandFor(e.final_score),
    contribution_delta: e.contribution_delta,
    merged_pr_delta: e.merged_pr_delta,
    impact_commit_delta: e.impact_commit_delta,
    growth_score: e.growth_score,
    latest_snapshot_at: e.latest_snapshot_at,
  };
}

function selectDefaultBand(bandCounts: Record<BandKey, number>): BandKey {
  return DEFAULT_BAND_PRIORITY.find((band) => bandCounts[band] > 0) ?? DEFAULT_BAND;
}

export async function HomeGrowthLeaderboard() {
  const t = await getTranslations("growth");

  const labels: GrowthLabels = {
    heading: t("heading"),
    subtitle: t("subtitle"),
    bandLabel: t("bandLabel"),
    growthLabel: t("growthLabel"),
    growthTitle: t("growthTitle"),
    commitsLabel: t("commitsLabel"),
    commitsTitle: t("commitsTitle"),
    mergedPrs: t("mergedPrs"),
    impactCommits: t("impactCommits"),
    loading: t("loading"),
    loadError: t("loadError"),
    empty: t("empty"),
    scanCta: t("scanCta"),
    bandAria: t("bandAria"),
    sinceLastScan: t("sinceLastScan"),
    lastActive: t("lastActive"),
    allTab: t("allTab"),
    timelineTitle: t("timelineTitle"),
    timelineEmpty: t("timelineEmpty"),
    tooltipBand: t("tooltipBand"),
    tooltipGrowth: t("tooltipGrowth"),
    tooltipCommits: t("tooltipCommits"),
    tooltipMergedPrs: t("tooltipMergedPrs"),
    tooltipImpact: t("tooltipImpact"),
    tooltipScan: t("tooltipScan"),
    tooltipRepo: t("tooltipRepo"),
    tooltipLanguage: t("tooltipLanguage"),
    listLabel: t("listLabel"),
    clusterTitle: t("clusterTitle", { count: "{count}" }),
    close: t("close"),
    subscribeAfterLogin: t("subscribeAfterLogin"),
    subscribe: t("subscribe"),
    subscribed: t("subscribed"),
    unsubscribe: t("unsubscribe"),
    subscribeFailed: t("subscribeFailed"),
  };

  const growthEntries = await getContributionGrowthLeaderboard(GROWTH_LIMIT, GROWTH_WINDOW);

  const byBand = Object.fromEntries(
    BAND_KEYS.map((k) => [k, [] as GrowthEntry[]]),
  ) as Record<BandKey, GrowthEntry[]>;

  for (const e of growthEntries) {
    const g = toGrowthEntry(e);
    if (g) byBand[g.band].push(g);
  }

  // bandCounts for the tab display
  const bandCounts = Object.fromEntries(
    BAND_KEYS.map((k) => [k, byBand[k].length]),
  ) as Record<BandKey, number>;

  const defaultBand = selectDefaultBand(bandCounts);
  const defaultEntries = byBand[defaultBand].slice(0, 12);

  return (
    <HomeGrowthLeaderboardClient
      labels={labels}
      bandCounts={bandCounts}
      defaultBand={defaultBand}
      defaultEntries={defaultEntries}
      allByBand={byBand}
    />
  );
}
