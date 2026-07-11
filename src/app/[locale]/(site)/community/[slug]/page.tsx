import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CommunityGalaxyBackdrop } from "@/components/community/CommunityGalaxyBackdrop";
import { CommunityJoinEntry } from "@/components/community/CommunityJoinEntry";
import { CommunityDomainGalaxy } from "@/components/community/galaxy/CommunityDomainGalaxy";
import {
  ensureCommunityProfileDraft,
  getCommunityDomain,
  getCommunityProfile,
  getProfileSnapshot,
  getScoreBrief,
} from "@/lib/db";
import { auth, authConfigured } from "@/lib/auth";
import { buildCommunityProfileDraft, sourceFromSnapshot } from "@/lib/community-profile";
import { normLang } from "@/lib/lang";
import { localeAlternates } from "@/lib/site";

// Domain membership reflects the latest facet rebuild; keep it fresh rather than
// caching a stale member list on the CDN.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const decoded = decodeURIComponent(slug);
  const meta = await getTranslations({ locale, namespace: "meta" });
  const domain = await getCommunityDomain(decoded);
  if (!domain) {
    const t = await getTranslations({ locale, namespace: "communityDomain" });
    return { title: `${t("notFound")} · ${meta("siteName")}`, robots: { index: false, follow: true } };
  }
  const name = locale === "en" ? domain.name.en || domain.name.zh : domain.name.zh;
  return {
    title: `${name} · ${meta("siteName")}`,
    alternates: localeAlternates(locale, `/community/${encodeURIComponent(decoded)}`),
  };
}

export default async function CommunityDomainPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const lang = normLang(locale);
  const decoded = decodeURIComponent(slug);
  const domain = await getCommunityDomain(decoded);
  if (!domain) notFound();
  const session = authConfigured() ? await auth() : null;
  const login = session?.user?.login || null;
  const githubId = session?.user?.githubId || null;
  const [scoreBrief, initialCommunityProfile, snapshot] = await Promise.all([
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
    <main data-force-dark className="relative flex w-full flex-1 overflow-hidden bg-[#020617]">
      <CommunityGalaxyBackdrop />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.34),rgba(2,6,23,0.08)_32%,rgba(2,6,23,0.7)_100%)]" />
      <div className="relative z-10 min-h-screen w-full">
        <CommunityJoinEntry
          username={login}
          hasRoast={Boolean(scoreBrief)}
          authConfigured={authConfigured()}
          initialProfile={communityProfile}
        />
        <CommunityDomainGalaxy domain={domain} lang={lang} />
      </div>
    </main>
  );
}
