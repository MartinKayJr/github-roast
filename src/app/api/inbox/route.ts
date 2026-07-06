import { NextResponse } from "next/server";
import { auth, authConfigured } from "@/lib/auth";
import {
  getInboxSummary,
  listInboxMessages,
  markAllInboxMessagesRead,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

async function getViewer() {
  if (!authConfigured()) return null;
  const session = await auth();
  const githubId = session?.user?.githubId;
  if (!githubId) return null;
  return { githubId };
}

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();

  const [summary, messages] = await Promise.all([
    getInboxSummary(viewer.githubId),
    listInboxMessages(viewer.githubId),
  ]);

  return NextResponse.json({
    unread: summary.unread,
    messages,
  });
}

export async function PATCH() {
  const viewer = await getViewer();
  if (!viewer) return unauthorized();

  const updated = await markAllInboxMessagesRead(viewer.githubId);
  const summary = await getInboxSummary(viewer.githubId);
  return NextResponse.json({
    updated,
    unread: summary.unread,
  });
}
