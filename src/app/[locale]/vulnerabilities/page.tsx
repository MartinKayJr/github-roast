import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localeAlternates } from "@/lib/site";
import { listVulnerabilities } from "@/lib/vulnerabilities";
import type { ArticleLocale } from "@/lib/articles";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "vulnerabilities" });
  return {
    title: `${t("heading")} · ${(await getTranslations({ locale, namespace: "meta" }))("siteName")}`,
    description: t("subtitle"),
    alternates: localeAlternates(locale, "/vulnerabilities"),
  };
}

export default async function VulnerabilityIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const articleLocale: ArticleLocale = locale === "en" ? "en" : "zh";
  const t = await getTranslations("vulnerabilities");
  const posts = await listVulnerabilities(articleLocale);
  const dateFmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-14 sm:py-20">
      <h1 className="text-3xl font-black text-[var(--foreground)] sm:text-5xl">{t("heading")}</h1>
      <p className="mt-3 text-[var(--muted-foreground)]">{t("subtitle")}</p>

      <div className="mt-10 flex flex-col gap-8">
        {posts.map((post) => (
          <article key={post.slug}>
            <Link
              href={`/vulnerabilities/${post.slug}`}
              className="group block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 transition-colors hover:border-[var(--primary)]"
            >
              <h2 className="text-xl font-bold text-[var(--foreground)] group-hover:text-[var(--primary)] sm:text-2xl">
                {post.title}
              </h2>
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--muted-foreground)]">
                {post.description}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--muted-foreground)]">
                <time dateTime={post.date}>{dateFmt.format(new Date(post.date))}</time>
                <span aria-hidden>·</span>
                <span>{t("readingTime", { minutes: post.readingMinutes })}</span>
                {post.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-[var(--border)] px-2 py-0.5">
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          </article>
        ))}
        {posts.length === 0 && <p className="text-[var(--muted-foreground)]">{t("empty")}</p>}
      </div>
    </main>
  );
}
