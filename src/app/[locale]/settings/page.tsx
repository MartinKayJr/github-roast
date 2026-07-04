import { getTranslations } from "next-intl/server";
import { GrowthSubscriptionSettings } from "@/components/GrowthSubscriptionSettings";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function SettingsPage() {
  const t = await getTranslations("settings");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight text-zinc-100">
          {t("heading")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          {t("subtitle")}
        </p>
      </div>
      <GrowthSubscriptionSettings />
    </main>
  );
}
