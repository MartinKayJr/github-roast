import { NextResponse } from "next/server";
import { auth, authConfigured } from "@/lib/auth";
import { getInboxSummary, markInboxMessageRead } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authConfigured()) return unauthorized();
  const session = await auth();
  const githubId = session?.user?.githubId;
  if (!githubId) return unauthorized();

  const { id } = await params;
  const ok = await markInboxMessageRead(githubId, decodeURIComponent(id));
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const summary = await getInboxSummary(githubId);
  return NextResponse.json({ ok: true, unread: summary.unread });
}

export const PATCH = POST;
