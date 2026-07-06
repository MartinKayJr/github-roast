import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getAdminAccess } from "@/lib/admin";
import { getAdminRoastEmailStats } from "@/lib/db";
import { AdminOrgProjectScanPanel } from "@/components/admin/AdminOrgProjectScanPanel";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

function StatCard({
  label,
  value,
  hint,
  suffix = "",
}: {
  label: string;
  value: number;
  hint: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-medium text-zinc-400">{label}</div>
      <div className="mt-3 text-3xl font-black text-zinc-100 tabular-nums">
        {value.toLocaleString()}
        {suffix}
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{hint}</p>
    </div>
  );
}

export default async function AdminPage() {
  const access = await getAdminAccess();
  if (!access.ok) notFound();

  const t = await getTranslations("admin");
  const stats = await getAdminRoastEmailStats();
  const emailRate =
    stats.totalRoasts > 0
      ? Math.round((stats.roastsWithEmail / stats.totalRoasts) * 1000) / 10
      : 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-400">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-zinc-100">
            {t("heading")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            {t("subtitle")}
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400">
          @{access.session.user.login}
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("totalRoasts")}
          value={stats.totalRoasts}
          hint={t("totalRoastsHint")}
        />
        <StatCard
          label={t("withEmail")}
          value={stats.roastsWithEmail}
          hint={t("withEmailHint")}
        />
        <StatCard
          label={t("withoutEmail")}
          value={stats.roastsWithoutEmail}
          hint={t("withoutEmailHint")}
        />
        <StatCard
          label={t("emailRate")}
          value={emailRate}
          suffix="%"
          hint={t("emailRateHint")}
        />
      </section>

      <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-base font-bold text-zinc-100">
          {t("emailSubscriptionsTitle")}
        </h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/10 p-4">
            <dt className="text-xs text-zinc-500">{t("activeEmailSubscriptions")}</dt>
            <dd className="mt-2 text-2xl font-black text-zinc-100 tabular-nums">
              {stats.activeEmailSubscriptions.toLocaleString()}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/10 p-4">
            <dt className="text-xs text-zinc-500">{t("activeEmailUsernames")}</dt>
            <dd className="mt-2 text-2xl font-black text-zinc-100 tabular-nums">
              {stats.activeEmailUsernames.toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>

      <AdminOrgProjectScanPanel />
    </main>
  );
}
