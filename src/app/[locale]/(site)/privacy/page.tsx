import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/site";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localeAlternates(locale, "/privacy"),
  };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");
  const sections = t.raw("sections") as { h: string; p: string }[];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-14 sm:py-20">
      <h1 className="text-3xl font-black tracking-tight text-[var(--foreground)] sm:text-5xl">
        {t("heading")}
      </h1>
      <div className="mt-8 flex flex-col gap-8">
        {sections.map((s, i) => (
          <section key={i}>
            <h2 className="text-xl font-bold text-[var(--foreground)]">{s.h}</h2>
            <p className="mt-3 text-base leading-relaxed text-zinc-300">{s.p}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
