import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DeveloperCount } from "@/components/DeveloperCount";
import { HomeLeaderboard } from "@/components/HomeLeaderboard";
import { Roaster } from "@/components/Roaster";
import type { TierKey } from "@/lib/tier";

export const dynamic = "force-dynamic";

// Tier pills: emoji + color are language-neutral; the label comes from i18n.
const TIER_PILLS: { key: TierKey; emoji: string; cls: string }[] = [
  { key: "god", emoji: "🏆", cls: "text-amber-300" },
  { key: "elite", emoji: "🥇", cls: "text-violet-300" },
  { key: "solid", emoji: "💪", cls: "text-emerald-300" },
  { key: "npc", emoji: "🫥", cls: "text-slate-300" },
  { key: "trash", emoji: "💩", cls: "text-rose-400" },
];

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await connection();
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tt = await getTranslations("tiers");

  return (
    <main className="flex flex-1 flex-col items-center px-5 py-14 sm:py-20">
      <header className="mb-10 flex flex-col items-center text-center">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
          {t("titleBefore")} <span className="text-orange-500">GitHub</span> {t("titleAfter")}
        </h1>
        <p className="mt-2 text-base font-semibold tracking-wide text-zinc-300 sm:text-lg">
          {t("subtitle")}
        </p>
        <a
          href="https://githubroast.dev"
          className="mt-2 text-sm font-bold tracking-wide text-orange-400 hover:text-orange-300"
        >
          githubroast.dev
        </a>
        <p className="mt-3 max-w-md text-zinc-400">{t("tagline")}</p>
        <DeveloperCount />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
          {TIER_PILLS.map(({ key, emoji, cls }) => (
            <span
              key={key}
              className={`rounded-full border border-white/10 px-2.5 py-1 ${cls}`}
            >
              {emoji} {tt(`${key}.name`)}
            </span>
          ))}
        </div>
      </header>

      <Roaster />

      <Suspense
        fallback={
          <section className="mt-16 w-full max-w-4xl">
            <div className="h-72 animate-pulse rounded-2xl border border-white/5 bg-white/5" />
          </section>
        }
      >
        <HomeLeaderboard pageSize={10} />
      </Suspense>

      <footer className="mt-20 max-w-xl text-center text-xs leading-relaxed text-zinc-600">
        <p>{t.rich("disclaimer1", { b: (c) => <strong>{c}</strong> })}</p>
        <p className="mt-2">
          {t.rich("disclaimer2", {
            code: (c) => <code className="text-zinc-400">{c}</code>,
          })}
        </p>
        <p className="mt-2">
          <a href="https://githubroast.dev" className="font-bold text-orange-400 hover:text-orange-300">
            githubroast.dev
          </a>
        </p>
      </footer>
    </main>
  );
}
