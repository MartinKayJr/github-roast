import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminWorkspace } from "@/components/admin/AdminWorkspace";
import { getAdminAccess } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const access = await getAdminAccess();
  if (!access.ok) notFound();

  return <AdminWorkspace login={access.session.user.login}>{children}</AdminWorkspace>;
}
