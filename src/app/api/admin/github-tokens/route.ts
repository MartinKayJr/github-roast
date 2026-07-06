import { NextRequest, NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import {
  addGitHubToken,
  deleteGitHubToken,
  listGitHubTokens,
  setGitHubTokenStatus,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function forbidden(reason: string) {
  return NextResponse.json(
    { error: reason },
    { status: reason === "unauthorized" ? 401 : 403 },
  );
}

async function requireAdmin() {
  const access = await getAdminAccess();
  return access.ok ? null : forbidden(access.reason);
}

export async function GET() {
  const blocked = await requireAdmin();
  if (blocked) return blocked;
  const tokens = await listGitHubTokens();
  return NextResponse.json({ tokens });
}

export async function POST(req: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;
  let body: { label?: unknown; token?: unknown; priority?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token.length < 20) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const priority = Number(body.priority);
  const saved = await addGitHubToken({
    label,
    token,
    priority: Number.isFinite(priority) ? priority : 100,
  });
  if (!saved) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ token: saved });
}

export async function PATCH(req: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;
  let body: { id?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = body.status === "active" || body.status === "disabled" ? body.status : null;
  if (!id || !status) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const ok = await setGitHubTokenStatus(id, status);
  if (!ok) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const ok = await deleteGitHubToken(id);
  if (!ok) return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
