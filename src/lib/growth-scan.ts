import {
  markGrowthScanSubscriptionRun,
  recordProfileSnapshot,
  recordScore,
} from "./db";
import { scanErrorResponse, buildScanResult } from "./scan-core";
import { spamBotScore } from "./score";

const EMPTY_TAGS = { zh: [], en: [] };
const EMPTY_ROAST_LINE = { zh: "", en: "" };

export interface GrowthScanRunResult {
  login: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export async function runGrowthScanForSubscription(input: {
  github_id: number;
  login: string;
}): Promise<GrowthScanRunResult> {
  const attemptedAt = Date.now();
  try {
    const scan = await buildScanResult(input.login);
    await recordScore({
      username: scan.metrics.username,
      display_name: scan.metrics.name,
      avatar_url: scan.metrics.avatar_url,
      profile_url: scan.metrics.profile_url,
      final_score: scan.scoring.final_score,
      tier: scan.scoring.tier,
      tags: EMPTY_TAGS,
      roast_line: EMPTY_ROAST_LINE,
      bot_score: spamBotScore(scan.metrics),
      sub_scores: scan.scoring.sub_scores,
      scanned_at: attemptedAt,
    });
    await recordProfileSnapshot(scan);
    await markGrowthScanSubscriptionRun(input.github_id, {
      last_scanned_at: attemptedAt,
      last_error: null,
    });
    return { login: input.login, ok: true };
  } catch (e) {
    const mapped = scanErrorResponse(e);
    const message = mapped.error || (e instanceof Error ? e.message : String(e));
    await markGrowthScanSubscriptionRun(input.github_id, {
      last_scanned_at: attemptedAt,
      last_error: message,
    });
    return {
      login: input.login,
      ok: false,
      error: message,
      status: mapped.status,
    };
  }
}
