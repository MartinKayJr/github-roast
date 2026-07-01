import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  LeaderboardClient,
  type LeaderboardLabels,
} from "@/components/LeaderboardClient";
import { getDevelopersByFacetCached } from "@/lib/developers";
import { DEVELOPERS_PER_FACET_LIMIT } from "@/lib/db";
import type { FacetType } from "@/lib/facets";

export const dynamic = "force-dynamic";

const FACET_TYPES: FacetType[] = ["language", "org"];

function parseFacetType(raw: string): FacetType | null {
  return (FACET_TYPES as string[]).includes(raw) ? (raw as FacetType) : null;
}

function bucketHeadingKey(type: FacetType): "languageBucketHeading" | "orgBucketHeading" {
  return type === "org" ? "orgBucketHeading" : "languageBucketHeading";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; type: string; value: string }>;
}): Promise<Metadata> {
  const { locale, type: rawType, value: rawValue } = await params;
  const type = parseFacetType(rawType);
  const value = decodeURIComponent(rawValue);
  const t = await getTranslations({ locale, namespace: "developers" });
  const meta = await getTranslations({ locale, namespace: "meta" });
  if (!type) return { title: t("metaTitle") };
  const heading = t(bucketHeadingKey(type), { value });
  return {
    title: `${heading} · ${meta("siteName")}`,
    description: t("bucketMetaDescription", { value }),
  };
}

export default async function FacetBucketPage({
  params,
}: {
  params: Promise<{ locale: string; type: string; value: string }>;
}) {
  const { locale, type: rawType, value: rawValue } = await params;
  const type = parseFacetType(rawType);
  const value = decodeURIComponent(rawValue);
  if (!type || !value) notFound();

  setRequestLocale(locale);
  const t = await getTranslations("developers");
  const tl = await getTranslations("leaderboard");

  const entries = await getDevelopersByFacetCached(type, value);

  // Reuse the leaderboard card renderer verbatim (score view) — same entry shape,
  // same labels namespace — so the directory bucket looks like a board.
  const labels: LeaderboardLabels = {
    empty: t("empty"),
    prev: tl("prev"),
    next: tl("next"),
    pageJumpLabel: tl("pageJumpLabel"),
    collapse: tl("collapse"),
    viewDetail: tl("viewDetail", { username: "{username}" }),
    trendLabel: tl("trendLabel"),
    trendTitle: tl("trendTitle"),
    scoreLabel: tl("scoreLabel"),
    scoreTitle: tl("scoreTitle"),
    heatLabel: tl("heatLabel"),
    heatTitle: tl("heatTitle"),
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-14 sm:py-20">
      <header className="mb-8">
        <Link
          href="/developers"
          className="text-sm text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
        >
          {t("backToDirectory")}
        </Link>
        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight text-zinc-100 sm:text-5xl">
          {t(bucketHeadingKey(type), { value })}
        </h1>
        <p className="mt-2 text-zinc-400">
          {t("bucketSubtitle", { limit: DEVELOPERS_PER_FACET_LIMIT })}
        </p>
      </header>

      <LeaderboardClient
        initialView="score"
        labels={labels}
        pageSize={20}
        scoreEntries={entries}
        heatEntries={[]}
        trendingEntries={[]}
      />
    </main>
  );
}
