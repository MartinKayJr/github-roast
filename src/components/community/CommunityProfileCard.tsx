"use client";

import { useTranslations } from "next-intl";
import type { Lang } from "@/lib/lang";
import type { CommunityProfile } from "@/lib/db";

interface CommunityProfileCardProps {
  profile: CommunityProfile;
  isOwner: boolean;
  lang: Lang;
  onEdit?: () => void;
}

export function CommunityProfileCard({
  profile,
  isOwner,
  lang,
  onEdit,
}: CommunityProfileCardProps) {
  const t = useTranslations("community.profileCard");

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    });
  };

  const getBilingualText = (field: { zh: string; en: string } | null) => {
    if (!field) return null;
    return lang === "zh" ? field.zh : field.en;
  };

  const workingOn = getBilingualText(profile.working_on);
  const wantToMeet = getBilingualText(profile.want_to_meet);
  const contactMethod = getBilingualText(profile.contact_method);
  const chatTopics = getBilingualText(profile.chat_topics);
  const noRecommend = getBilingualText(profile.no_recommend_for);

  return (
    <section className="rounded-2xl border border-emerald-300/25 bg-emerald-500/[0.05] p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 sm:text-xl">
            🌟 {t("title")}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {t("memberSince", { date: formatDate(profile.joined_at) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              profile.visibility === "public"
                ? "bg-emerald-400/10 text-emerald-300"
                : "bg-zinc-400/10 text-zinc-400"
            }`}
          >
            {profile.visibility === "public" ? t("public") : t("private")}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {workingOn && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-emerald-300">
              {t("workingOn")}
            </h3>
            <p className="text-sm text-zinc-300">{workingOn}</p>
          </div>
        )}

        {wantToMeet && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-emerald-300">
              {t("wantToMeet")}
            </h3>
            <p className="text-sm text-zinc-300">{wantToMeet}</p>
          </div>
        )}

        {contactMethod && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-emerald-300">
              {t("contactMethod")}
            </h3>
            <p className="text-sm text-zinc-300">{contactMethod}</p>
          </div>
        )}

        {chatTopics && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-emerald-300">
              {t("chatTopics")}
            </h3>
            <p className="text-sm text-zinc-300">{chatTopics}</p>
          </div>
        )}

        {noRecommend && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-emerald-300">
              {t("noRecommend")}
            </h3>
            <p className="text-sm text-zinc-300">{noRecommend}</p>
          </div>
        )}
      </div>

      {isOwner && (
        <div className="mt-5 pt-5 border-t border-emerald-300/15">
          <button
            onClick={onEdit}
            className="rounded-lg bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
          >
            {t("edit")}
          </button>
        </div>
      )}
    </section>
  );
}
