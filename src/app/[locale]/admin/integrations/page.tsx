import { getTranslations } from "next-intl/server";
import { AdminGitHubTokenPanel } from "@/components/admin/AdminGitHubTokenPanel";

export default async function AdminIntegrationsPage() {
  const t = await getTranslations("admin");

  return (
    <section>
      <header className="mb-6 border-b border-white/10 pb-5">
        <h1 className="text-2xl font-black text-zinc-100">{t("integrationsTitle")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{t("integrationsDescription")}</p>
      </header>
      <AdminGitHubTokenPanel />
    </section>
  );
}
