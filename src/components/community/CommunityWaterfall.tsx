import { getTranslations } from "next-intl/server";
import type { CommunityWaterfallEntry } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { CommunityWaterfallCard } from "./CommunityWaterfallCard";

interface CommunityWaterfallProps {
  entries: CommunityWaterfallEntry[];
  lang: Lang;
  vsA: string;
  vsB: string;
  /** Pre-resolved challenge opponent: winner, or the scored player, or vsA fallback. */
  winner: string;
}

export async function CommunityWaterfall({
  entries,
  lang,
  winner,
}: CommunityWaterfallProps) {
  const t = await getTranslations("communityWaterfall");

  return (
    <section className="mt-6 rounded-2xl border border-emerald-300/15 bg-white/[0.02] p-5 sm:p-6">
      <h2 className="mb-1 text-base font-bold text-emerald-200">{t("heading")}</h2>
      <p className="mb-4 text-xs text-zinc-400">{t("sub")}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <CommunityWaterfallCard
              key={entry.login}
              entry={entry}
              lang={lang}
              challengeOpponent={winner}
            />
          ))}
        </div>
      )}
    </section>
  );
}
