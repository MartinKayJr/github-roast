import { getTranslations } from "next-intl/server";
import { AdminOrgProjectScanPanel } from "@/components/admin/AdminOrgProjectScanPanel";

export default async function AdminProjectsPage() {
  const t = await getTranslations("admin");

  return (
    <section>
      <header className="mb-6 border-b border-white/10 pb-5">
        <h1 className="text-2xl font-black text-zinc-100">{t("projectsTitle")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{t("projectsDescription")}</p>
      </header>
      <AdminOrgProjectScanPanel />
    </section>
  );
}
