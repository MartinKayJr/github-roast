import { after, NextRequest, NextResponse } from "next/server";
import { auth, authConfigured } from "@/lib/auth";
import {
  getGrowthScanSubscription,
  updateGrowthScanSubscriptionStatus,
  upsertGrowthScanSubscription,
} from "@/lib/db";
import { runGrowthScanForSubscription } from "@/lib/growth-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET() {
  if (!authConfigured()) return unauthorized();
  const session = await auth();
  if (!session?.user?.githubId || !session.user.login) return unauthorized();

  const subscription = await getGrowthScanSubscription(session.user.githubId);
  return NextResponse.json({
    subscribed: subscription?.status === "active",
    subscription,
  });
}

export async function POST() {
  if (!authConfigured()) return unauthorized();
  const session = await auth();
  if (!session?.user?.githubId || !session.user.login) return unauthorized();

  const subscription = await upsertGrowthScanSubscription({
    github_id: session.user.githubId,
    login: session.user.login,
    status: "active",
  });
  after(() =>
    runGrowthScanForSubscription({
      github_id: session.user.githubId,
      login: session.user.login,
    }).catch(() => {}),
  );
  return NextResponse.json({
    subscribed: subscription?.status === "active",
    subscription,
    initialScanQueued: true,
  });
}

export async function DELETE(_req: NextRequest) {
  if (!authConfigured()) return unauthorized();
  const session = await auth();
  if (!session?.user?.githubId) return unauthorized();

  const subscription = await updateGrowthScanSubscriptionStatus(
    session.user.githubId,
    "inactive",
  );
  return NextResponse.json({
    subscribed: false,
    subscription,
  });
}
