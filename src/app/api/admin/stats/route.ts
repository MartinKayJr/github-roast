import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin";
import { getAdminRoastEmailStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getAdminAccess();
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === "unauthorized" ? 401 : 403 },
    );
  }

  const roastEmailStats = await getAdminRoastEmailStats();
  return NextResponse.json({
    admin: { login: access.session.user.login },
    roastEmailStats,
  });
}
