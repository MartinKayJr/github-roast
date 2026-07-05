import type { Session } from "next-auth";
import { auth, authConfigured } from "@/lib/auth";

function configuredAdminLogins(): Set<string> {
  return new Set(
    (process.env.ADMIN_GITHUB_LOGINS ?? "")
      .split(/[\s,]+/)
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminLogin(login: string | null | undefined): boolean {
  if (!login) return false;
  return configuredAdminLogins().has(login.trim().toLowerCase());
}

export type AdminAccess =
  | { ok: true; session: Session }
  | { ok: false; reason: "auth_unconfigured" | "unauthorized" | "forbidden" };

export async function getAdminAccess(): Promise<AdminAccess> {
  if (!authConfigured()) return { ok: false, reason: "auth_unconfigured" };
  const session = await auth();
  if (!session?.user?.login) return { ok: false, reason: "unauthorized" };
  if (!isAdminLogin(session.user.login)) return { ok: false, reason: "forbidden" };
  return { ok: true, session };
}
