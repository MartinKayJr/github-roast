import { NextResponse } from "next/server";
import { auth, authConfigured } from "@/lib/auth";
import { isAdminLogin } from "@/lib/admin";
import {
  getCommunityProfile,
  getGrowthScanSubscription,
  getInboxSummary,
  getScoreBrief,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight session probe for the client navbar / login nudge.
 *
 * The shared chrome (Navbar, LoginNudge) used to read the session via `auth()`
 * directly in the server render tree, which reads cookies and so opted EVERY
 * page out of static/ISR caching — including the homepage. Isolating that cookie
 * read into this dedicated API route lets the pages prerender + serve from the
 * CDN, while the navbar fills in the avatar/login state client-side from here.
 *
 * Returns the GitHub handle + avatar when signed in, plus whether the user has a
 * scored profile (drives the "my profile" vs "judge self" link) and whether they
 * have an active community profile (drives the community menu indicator).
 * Always 200 with `{ user: null }` when unconfigured or signed out, so the client
 * logic is simple.
 */
export async function GET() {
  if (!authConfigured()) {
    return NextResponse.json({
      user: null,
      scored: false,
      hasCommunityProfile: false,
      growthSubscribed: false,
      inboxUnread: 0,
      isAdmin: false,
    });
  }
  const session = await auth();
  const user = session?.user;
  if (!user?.login || !user?.githubId) {
    return NextResponse.json({
      user: null,
      scored: false,
      hasCommunityProfile: false,
      growthSubscribed: false,
      inboxUnread: 0,
      isAdmin: false,
    });
  }
  const [brief, communityProfile, growthSubscription, inboxSummary] =
    await Promise.all([
      getScoreBrief(user.login),
      getCommunityProfile(user.githubId),
      getGrowthScanSubscription(user.githubId),
      getInboxSummary(user.githubId),
    ]);
  return NextResponse.json({
    user: { login: user.login, image: user.image ?? null },
    scored: Boolean(brief),
    hasCommunityProfile: communityProfile?.status === "active",
    growthSubscribed: growthSubscription?.status === "active",
    inboxUnread: inboxSummary.unread,
    isAdmin: isAdminLogin(user.login),
  });
}
