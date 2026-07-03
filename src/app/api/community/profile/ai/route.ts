import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProfileSnapshot, getScoreBrief } from "@/lib/db";
import {
  buildCommunityProfileAiMessages,
  buildCommunityProfileDraft,
  parseCommunityProfileDraft,
  sourceFromSnapshot,
} from "@/lib/community-profile";
import { defaultLlmConfig, fallbackLlmConfig, getCompletionWithFallback, LlmQuotaError } from "@/lib/llm";
import { checkCommunityProfileAiRateLimit } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.githubId || !session.user.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiterKey = `${session.user.githubId}:${clientIp(req)}`;
  const { success } = await checkCommunityProfileAiRateLimit(limiterKey);
  if (!success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const brief = await getScoreBrief(session.user.login);
  if (!brief) {
    return NextResponse.json({ error: "roast_required" }, { status: 400 });
  }

  const snapshot = await getProfileSnapshot(session.user.login);
  if (!snapshot) {
    return NextResponse.json({ error: "snapshot_required" }, { status: 404 });
  }

  const source = sourceFromSnapshot(session.user.login, snapshot, session.user.name);
  const localDraft = buildCommunityProfileDraft(source);
  const primary = defaultLlmConfig();
  if (!primary) {
    return NextResponse.json({ profile: localDraft, source: "local", error: "no_llm_configured" });
  }

  const fallback = fallbackLlmConfig();
  const configs = fallback ? [primary, fallback] : [primary];

  try {
    const raw = await getCompletionWithFallback(configs, buildCommunityProfileAiMessages(source), {
      temperature: 0.35,
      connectTimeoutMs: 20_000,
      idleTimeoutMs: 20_000,
      deadlineMs: Date.now() + 45_000,
      attemptBudgetMs: 30_000,
    });
    const profile = parseCommunityProfileDraft(raw) ?? localDraft;
    return NextResponse.json({ profile, source: "ai" });
  } catch (e) {
    if (e instanceof LlmQuotaError) {
      return NextResponse.json(
        { profile: localDraft, source: "local", error: "llm_quota" },
        { status: 200 },
      );
    }
    console.error("POST /api/community/profile/ai error:", e);
    return NextResponse.json({ profile: localDraft, source: "local", error: "ai_failed" });
  }
}
