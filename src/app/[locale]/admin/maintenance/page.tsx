import { getTranslations } from "next-intl/server";
import { AdminGrowthBackfillPanel } from "@/components/admin/AdminGrowthBackfillPanel";
import { AdminProjectAiSummaryBackfillPanel } from "@/components/admin/AdminProjectAiSummaryBackfillPanel";
import { AdminProjectEvidenceBackfillPanel } from "@/components/admin/AdminProjectEvidenceBackfillPanel";

export default async function AdminMaintenancePage() {
  const t = await getTranslations("admin");

  return (
    <section>
      <header className="mb-6 border-b border-white/10 pb-5">
        <h1 className="text-2xl font-black text-zinc-100">{t("maintenanceTitle")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{t("maintenanceDescription")}</p>
      </header>
      <AdminGrowthBackfillPanel />
      <AdminProjectEvidenceBackfillPanel />
      <AdminProjectAiSummaryBackfillPanel />
    </section>
  );
}
