import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCommunityProfile, upsertCommunityProfile, getScoreBrief } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/community/profile
 * Returns the current user's community profile + whether they have a roast.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.githubId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getCommunityProfile(session.user.githubId);
  const brief = await getScoreBrief(session.user.login);

  return NextResponse.json({
    profile,
    hasRoast: Boolean(brief),
  });
}

/**
 * PUT /api/community/profile
 * Update community profile fields. Validates input and enforces character limits.
 */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.githubId || !session?.user?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Validate bilingual fields
    const validateBilingualField = (
      field: unknown,
      maxLength: number,
    ): { zh: string; en: string } | null => {
      if (!field || typeof field !== "object") return null;
      const f = field as { zh?: unknown; en?: unknown };
      if (typeof f.zh !== "string" || typeof f.en !== "string") return null;
      if (f.zh.length > maxLength || f.en.length > maxLength) {
        throw new Error(`Field exceeds ${maxLength} character limit`);
      }
      return { zh: f.zh.trim(), en: f.en.trim() };
    };

    const updates: Partial<typeof body> = {};

    if (body.working_on !== undefined) {
      updates.working_on = validateBilingualField(body.working_on, 500);
    }
    if (body.want_to_meet !== undefined) {
      updates.want_to_meet = validateBilingualField(body.want_to_meet, 500);
    }
    if (body.contact_method !== undefined) {
      updates.contact_method = validateBilingualField(body.contact_method, 500);
    }
    if (body.chat_topics !== undefined) {
      updates.chat_topics = validateBilingualField(body.chat_topics, 500);
    }
    if (body.no_recommend_for !== undefined) {
      updates.no_recommend_for = validateBilingualField(body.no_recommend_for, 500);
    }
    if (body.visibility !== undefined) {
      if (!["public", "private"].includes(body.visibility)) {
        return NextResponse.json({ error: "Invalid visibility value" }, { status: 400 });
      }
      updates.visibility = body.visibility;
    }

    await upsertCommunityProfile({
      github_id: session.user.githubId,
      login: session.user.login,
      ...updates,
    });

    const profile = await getCommunityProfile(session.user.githubId);
    return NextResponse.json({ profile });
  } catch (e) {
    console.error("PUT /api/community/profile error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update profile" },
      { status: 400 },
    );
  }
}
