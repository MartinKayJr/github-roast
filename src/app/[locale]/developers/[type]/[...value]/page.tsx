import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  LeaderboardClient,
  type LeaderboardLabels,
} from "@/components/LeaderboardClient";
import { FacetBoardPin } from "@/components/FacetBoardPin";
import { getDevelopersByFacetCached } from "@/lib/developers";
import { DEVELOPERS_PER_FACET_LIMIT } from "@/lib/db";
import type { FacetType } from "@/lib/facets";
import { localeAlternates } from "@/lib/site";
import { normalizeUsername } from "@/lib/username";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";

export const dynamic = "force-dynamic";

const FACET_TYPES: FacetType[] = ["language", "org", "repo"];

function parseFacetType(raw: string): FacetType | null {
  return (FACET_TYPES as string[]).includes(raw) ? (raw as FacetType) : null;
}

/** Rebuild the facet value from the catch-all path segments. A `repo` value is
 *  "owner/name" and so arrives as two segments (`/developers/repo/owner/name`) —
 *  a single dynamic segment would have %2F normalized away by the host and 404.
 *  language/org are single-segment. Each segment is decoded, then rejoined with
 *  "/" so it matches the stored `facet_value` exactly. */
function facetValueFromSegments(segments: string[] | undefined): string {
  return (segments ?? []).map((s) => decodeURIComponent(s)).join("/");
}

type BucketHeadingKey =
  | "languageBucketHeading"
  | "orgBucketHeading"
  | "repoBucketHeading";

function bucketHeadingKey(type: FacetType): BucketHeadingKey {
  if (type === "org") return "orgBucketHeading";
  if (type === "repo") return "repoBucketHeading";
  return "languageBucketHeading";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; type: string; value: string[] }>;
}): Promise<Metadata> {
  const { locale, type: rawType, value: rawValue } = await params;
  const type = parseFacetType(rawType);
  const value = facetValueFromSegments(rawValue);
  const t = await getTranslations({ locale, namespace: "developers" });
  const meta = await getTranslations({ locale, namespace: "meta" });
  if (!type) return { title: t("metaTitle") };
  const heading = t(bucketHeadingKey(type), { value });
  // Encode each segment separately so a `repo` value ("owner/name") keeps its
  // slash as a path separator — mirrors the sitemap so canonical == indexed URL.
  const encodedPath = value.split("/").map(encodeURIComponent).join("/");
  return {
    title: `${heading} · ${meta("siteName")}`,
    description: t("bucketMetaDescription", { value }),
    alternates: localeAlternates(locale, `/developers/${type}/${encodedPath}`),
  };
}

export default async function FacetBucketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; type: string; value: string[] }>;
  searchParams: Promise<{ u?: string }>;
}) {
  const { locale, type: rawType, value: rawValue } = await params;
  const type = parseFacetType(rawType);
  const value = facetValueFromSegments(rawValue);
  if (!type || !value) notFound();

  setRequestLocale(locale);
  const t = await getTranslations("developers");
  const tl = await getTranslations("leaderboard");

  const entries = await getDevelopersByFacetCached(type, value);

  // "?u=<handle>" marks a visitor arriving from a profile's facet-rank link.
  // If that dev is actually on this board, pin their position + a duel against
  // the dev one spot above (the loop closer). Off-board or garbage handles just
  // render the plain board — the canonical URL never carries the param.
  const fromUser = normalizeUsername((await searchParams)?.u ?? "");
  const pinIdx = fromUser
    ? entries.findIndex(
        (e) => e.username.toLowerCase() === fromUser.toLowerCase(),
      )
    : -1;
  const pinned = pinIdx >= 0 ? entries[pinIdx] : null;

  const localePrefix = locale === "en" ? "/en" : "";
  const encodedPath = value.split("/").map(encodeURIComponent).join("/");
  const breadcrumb = breadcrumbJsonLd([
    { name: t("heading"), path: `${localePrefix}/developers` },
    {
      name: t(bucketHeadingKey(type), { value }),
      path: `${localePrefix}/developers/${type}/${encodedPath}`,
    },
  ]);

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
    vsButton: tl("vsButton"),
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-14 sm:py-20">
      <JsonLd data={breadcrumb} />
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

      {pinned && (
        <FacetBoardPin
          username={pinned.username}
          rank={pinIdx + 1}
          ahead={pinIdx > 0 ? entries[pinIdx - 1].username : null}
          facetValue={value}
        />
      )}

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
