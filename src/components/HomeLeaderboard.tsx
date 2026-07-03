import { getTranslations } from "next-intl/server";
import { getLeaderboardCached } from "@/lib/leaderboard";
import { HomeLeaderboardClient, type HomeLeaderboardLabels } from "./HomeLeaderboardClient";
import type { LeaderboardLabels } from "./LeaderboardClient";
import { withDevLeaderboardPreview } from "./devLeaderboardPreview";

const HOME_PREVIEW_LIMIT = 50;

export async function HomeLeaderboard({ pageSize = 10 }: { pageSize?: number }) {
  const tHome = await getTranslations("home");
  const tBoard = await getTranslations("leaderboard");
  const leaderboardLabels: LeaderboardLabels = {
    empty: tBoard("empty"),
    prev: tBoard("prev"),
    next: tBoard("next"),
    pageJumpLabel: tBoard("pageJumpLabel"),
    collapse: tBoard("collapse"),
    viewDetail: tBoard("viewDetail", { username: "{username}" }),
    trendLabel: tBoard("trendLabel"),
    trendTitle: tBoard("trendTitle"),
    scoreLabel: tBoard("scoreLabel"),
    scoreTitle: tBoard("scoreTitle"),
    heatLabel: tBoard("heatLabel"),
    heatTitle: tBoard("heatTitle"),
    vsButton: tBoard("vsButton"),
  };
  const labels: HomeLeaderboardLabels = {
    openBoard: tHome("openBoard"),
    trendView: tBoard("trendView"),
    scoreView: tBoard("scoreView"),
    heatView: tBoard("heatView"),
    windowAria: tBoard("windowAria"),
    window24h: tBoard("window24h"),
    window7d: tBoard("window7d"),
    window30d: tBoard("window30d"),
    windowAll: tBoard("windowAll"),
    loading: tBoard("loading"),
    loadError: tBoard("loadError"),
  };

  const [trending, score, heat] = await Promise.all([
    getLeaderboardCached("trending"),
    getLeaderboardCached("score"),
    getLeaderboardCached("heat"),
  ]);
  // Only seed the preview depth: the full 500-entry boards serialize to ~700KB
  // of RSC payload in the homepage HTML (3×500 entries), drowning the page's
  // readable text for crawlers. Deeper browsing lives behind the full-board link.
  const trendingEntries = trending.entries.slice(0, HOME_PREVIEW_LIMIT);
  const scoreEntries = score.entries.slice(0, HOME_PREVIEW_LIMIT);
  const heatEntries = heat.entries.slice(0, HOME_PREVIEW_LIMIT);

  return (
    <HomeLeaderboardClient
      labels={labels}
      leaderboardLabels={leaderboardLabels}
      pageSize={pageSize}
      scoreEntries={withDevLeaderboardPreview("score", scoreEntries)}
      heatEntries={withDevLeaderboardPreview("heat", heatEntries)}
      trendingEntries={withDevLeaderboardPreview("trending", trendingEntries)}
    />
  );
}
