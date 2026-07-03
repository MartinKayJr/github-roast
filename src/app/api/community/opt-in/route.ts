import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { upsertCommunityProfile, updateCommunityStatus, getScoreBrief } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/community/opt-in
 * Complete the opt-in flow and activate the community profile.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.githubId || !session?.user?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (body.confirm !== true) {
      return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
    }

    // Require an existing roast before joining the community
    const brief = await getScoreBrief(session.user.login);
    if (!brief) {
      return NextResponse.json({ error: "A GitHub roast is required before joining the community" }, { status: 400 });
    }

    const visibility = body.visibility;
    if (!["public", "private"].includes(visibility)) {
      return NextResponse.json({ error: "Invalid visibility value" }, { status: 400 });
    }

    // Create or update the profile with active status
    await upsertCommunityProfile({
      github_id: session.user.githubId,
      login: session.user.login,
      status: "active",
      visibility,
      joined_at: Date.now(),
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("POST /api/community/opt-in error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to opt in" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/community/opt-in
 * Opt out of the community (set status to inactive, data retained).
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.githubId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const success = await updateCommunityStatus(session.user.githubId, "inactive");
    if (!success) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/community/opt-in error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to opt out" },
      { status: 500 },
    );
  }
}
