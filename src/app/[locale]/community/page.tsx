import type { Metadata } from "next";
import { CommunityGalaxyBackdrop } from "@/components/community/CommunityGalaxyBackdrop";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CommunityJoinEntry } from "@/components/community/CommunityJoinEntry";
import { CommunityGalaxyWaterfall } from "@/components/community/galaxy/CommunityGalaxyWaterfall";
import { CommunityProjectSearchDock } from "@/components/community/galaxy/CommunityProjectSearchDock";
import {
  ensureCommunityProfileDraft,
  getCommunityDomains,
  getCommunityProfile,
  getProfileSnapshot,
  getScoreBrief,
} from "@/lib/db";
import { auth, authConfigured } from "@/lib/auth";
import { buildCommunityProfileDraft, sourceFromSnapshot } from "@/lib/community-profile";
import { resolveAiDiscoveryLlmMode } from "@/lib/discovery";
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
  const lang = normLang(locale);
  const aiSearchMode = resolveAiDiscoveryLlmMode(process.env.AI_DISCOVERY_LLM_MODE);
  const session = authConfigured() ? await auth() : null;
  const login = session?.user?.login || null;
  const githubId = session?.user?.githubId || null;
  const [scoreBrief, initialCommunityProfile, snapshot, domainPage] = await Promise.all([
    login ? getScoreBrief(login) : Promise.resolve(null),
    githubId ? getCommunityProfile(githubId) : Promise.resolve(null),
    login ? getProfileSnapshot(login) : Promise.resolve(null),
    getCommunityDomains({ limit: 10 }),
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
    <main className="relative flex w-full flex-1 overflow-hidden bg-[#020617]">
      <CommunityGalaxyBackdrop />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(2,6,23,0.02),rgba(2,6,23,0.72)_78%)]" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[96rem] flex-col px-2 py-6 sm:px-4 sm:py-8">
        <h1 className="sr-only">{t("heading")}</h1>

        <CommunityJoinEntry
          username={login}
          hasRoast={Boolean(scoreBrief)}
          authConfigured={authConfigured()}
          initialProfile={communityProfile}
        />

        <div className="flex-1">
          <CommunityGalaxyWaterfall
            initialDomains={domainPage.domains}
            initialCursor={domainPage.nextCursor}
            lang={lang}
          />
        </div>
        <CommunityProjectSearchDock aiSearchMode={aiSearchMode} lang={lang} />
      </div>
    </main>
  );
}
