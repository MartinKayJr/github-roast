import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CommunityGalaxyBackdrop } from "@/components/community/CommunityGalaxyBackdrop";
import { ProjectScanForm } from "@/components/projects/ProjectScanForm";
import { localeAlternates } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "projects" });
  const meta = await getTranslations({ locale, namespace: "meta" });
  return {
    title: `${t("metaTitle")} · ${meta("siteName")}`,
    description: t("metaDescription"),
    alternates: localeAlternates(locale, "/projects"),
  };
}

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");

  return (
    <main className="relative flex min-h-[calc(100vh-3.5rem)] w-full flex-1 overflow-hidden bg-[#020617]">
      <CommunityGalaxyBackdrop />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_24%,rgba(34,211,238,0.08),rgba(2,6,23,0.7)_74%)]" />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col justify-center px-5 py-16">
        <header className="mx-auto mb-8 max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/55">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 text-balance text-4xl font-black leading-tight text-cyan-50 sm:text-6xl">
            {t("heading")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-cyan-100/58 sm:text-base">
            {t("subtitle")}
          </p>
        </header>
        <ProjectScanForm />
      </div>
    </main>
  );
}
