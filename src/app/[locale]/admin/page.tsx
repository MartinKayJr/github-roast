import { getTranslations } from "next-intl/server";
import { getAdminRoastEmailStats } from "@/lib/db";

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
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-medium text-zinc-400">{label}</div>
      <div className="mt-3 text-3xl font-black text-zinc-100 tabular-nums">
        {value.toLocaleString()}
        {suffix}
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{hint}</p>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");
  const stats = await getAdminRoastEmailStats();
  const emailRate =
    stats.totalRoasts > 0
      ? Math.round((stats.roastsWithEmail / stats.totalRoasts) * 1000) / 10
      : 0;

  return (
    <section>
      <header className="mb-6 border-b border-white/10 pb-5">
        <h1 className="text-2xl font-black text-zinc-100">{t("overviewTitle")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{t("overviewDescription")}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-base font-bold text-zinc-100">{t("emailSubscriptionsTitle")}</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/10 p-4">
            <dt className="text-xs text-zinc-500">{t("activeEmailSubscriptions")}</dt>
            <dd className="mt-2 text-2xl font-black text-zinc-100 tabular-nums">
              {stats.activeEmailSubscriptions.toLocaleString()}
            </dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/10 p-4">
            <dt className="text-xs text-zinc-500">{t("activeEmailUsernames")}</dt>
            <dd className="mt-2 text-2xl font-black text-zinc-100 tabular-nums">
              {stats.activeEmailUsernames.toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>
    </section>
  );
}
