import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TierAvatarFrame } from "@/components/TierAvatarFrame";
import { tierStyle } from "@/lib/tier";
import type { CommunityWaterfallEntry } from "@/lib/db";
import type { Lang } from "@/lib/lang";

interface CommunityWaterfallCardProps {
  entry: CommunityWaterfallEntry;
  lang: Lang;
  /** The VS winner's login, or a fallback player — used as the challenge opponent. */
  challengeOpponent: string;
}

export function CommunityWaterfallCard({
  entry,
  lang,
  challengeOpponent,
}: CommunityWaterfallCardProps) {
  const t = useTranslations("communityWaterfall");
  const style = tierStyle(entry.tier);
  const tags = lang === "en" ? entry.tags.en : entry.tags.zh;
  const workingOn = entry.working_on
    ? lang === "en"
      ? entry.working_on.en
      : entry.working_on.zh
    : null;
  const wantToMeet = entry.want_to_meet
    ? lang === "en"
      ? entry.want_to_meet.en
      : entry.want_to_meet.zh
    : null;

  // Canonical VS url — sort handles so the pair is always in one order.
  const [hA, hB] = [entry.login, challengeOpponent].sort();
  const challengeHref = `/vs/${hA}/${hB}`;

  return (
    <div className="rounded-xl border border-emerald-300/15 bg-emerald-500/[0.04] p-4">
      <div className="flex items-start gap-3">
        <TierAvatarFrame
          username={entry.login}
          avatarUrl={entry.avatar_url}
          tier={entry.tier}
          size="sm"
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${style.text}`}>@{entry.login}</span>
            <span className={`text-xs tabular-nums font-semibold ${style.text}`}>
              {entry.final_score.toFixed(0)}
            </span>
          </div>
          {tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          {workingOn && (
            <p className="mt-1.5 text-xs text-zinc-300 line-clamp-2">
              <span className="text-emerald-400">{t("workingOn")}</span>{" "}
              {workingOn}
            </p>
          )}
          {wantToMeet && (
            <p className="mt-1 text-xs text-zinc-400 line-clamp-1">
              <span className="text-emerald-400/70">{t("wantToMeet")}</span>{" "}
              {wantToMeet}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Link
          href={`/u/${entry.login}`}
          className="flex-1 rounded-lg border border-white/10 py-1.5 text-center text-xs font-medium text-zinc-300 hover:bg-white/5"
        >
          {t("viewProfile")}
        </Link>
        <Link
          href={challengeHref}
          prefetch={false}
          className="flex-1 rounded-lg border border-orange-400/30 bg-orange-500/10 py-1.5 text-center text-xs font-medium text-orange-300 hover:bg-orange-500/20"
        >
          {t("challenge")}
        </Link>
      </div>
    </div>
  );
}
