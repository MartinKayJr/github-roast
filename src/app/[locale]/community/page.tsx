import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CommunityJoinEntry } from "@/components/community/CommunityJoinEntry";
import { CommunityWaterfall } from "@/components/community/CommunityWaterfall";
import {
  ensureCommunityProfileDraft,
  getCommunityFeed,
  getCommunityProfile,
  getProfileSnapshot,
  getScoreBrief,
} from "@/lib/db";
import { auth, authConfigured } from "@/lib/auth";
import { buildCommunityProfileDraft, sourceFromSnapshot } from "@/lib/community-profile";
import { normLang } from "@/lib/lang";
import { localeAlternates } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "communityPage" });
  const meta = await getTranslations({ locale, namespace: "meta" });
  return {
    title: `${t("heading")} · ${meta("siteName")}`,
    description: t("subtitle"),
    alternates: localeAlternates(locale, "/community"),
  };
}

export default async function CommunityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("communityPage");
  const session = authConfigured() ? await auth() : null;
  const login = session?.user?.login || null;
  const githubId = session?.user?.githubId || null;
  const [entries, scoreBrief, initialCommunityProfile, snapshot] = await Promise.all([
    getCommunityFeed(36),
    login ? getScoreBrief(login) : Promise.resolve(null),
    githubId ? getCommunityProfile(githubId) : Promise.resolve(null),
    login ? getProfileSnapshot(login) : Promise.resolve(null),
  ]);

  let communityProfile = initialCommunityProfile;
  if (
    login &&
    githubId &&
    scoreBrief &&
    snapshot &&
    communityProfile?.status !== "active" &&
    (!communityProfile?.working_on || !communityProfile.want_to_meet)
  ) {
    await ensureCommunityProfileDraft({
      github_id: githubId,
      login,
      ...buildCommunityProfileDraft(sourceFromSnapshot(login, snapshot, session?.user?.name ?? null)),
    });
    communityProfile = (await getCommunityProfile(githubId)) ?? communityProfile;
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-14 sm:py-20">
      <header className="mb-8">
        <h1 className="text-3xl font-black leading-tight tracking-tight text-zinc-100 sm:text-5xl">
          {t("heading")}
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-400">{t("subtitle")}</p>
      </header>

      <CommunityJoinEntry
        username={login}
        hasRoast={Boolean(scoreBrief)}
        authConfigured={authConfigured()}
        initialProfile={communityProfile}
      />

      <CommunityWaterfall
        entries={entries}
        lang={normLang(locale)}
        heading={t("feedHeading")}
        sub={t("feedSub")}
      />
    </main>
  );
}
