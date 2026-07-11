import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CommunityGalaxyBackdrop } from "@/components/community/CommunityGalaxyBackdrop";
import { ProjectGalaxy } from "@/components/projects/ProjectGalaxy";
import { getProjectScore } from "@/lib/db";
import { normLang } from "@/lib/lang";
import { localeAlternates } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; owner: string; repo: string }>;
}): Promise<Metadata> {
  const { locale, owner, repo } = await params;
  const t = await getTranslations({ locale, namespace: "projects" });
  const meta = await getTranslations({ locale, namespace: "meta" });
  const project = await getProjectScore(decodeURIComponent(owner), decodeURIComponent(repo));
  if (!project) {
    return {
      title: `${t("notFound")} · ${meta("siteName")}`,
      robots: { index: false, follow: true },
    };
  }
  return {
    title: `${project.full_name} · ${meta("siteName")}`,
    description: locale === "en" ? project.roast_line.en : project.roast_line.zh,
    alternates: localeAlternates(locale, `/projects/${project.owner}/${project.repo}`),
  };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ locale: string; owner: string; repo: string }>;
}) {
  const { locale, owner, repo } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("projects");
  const project = await getProjectScore(decodeURIComponent(owner), decodeURIComponent(repo));
  if (!project) notFound();
  const lang = normLang(locale);

  return (
    <main className="relative flex w-full flex-1 overflow-hidden bg-[#020617]">
      <CommunityGalaxyBackdrop />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.34),rgba(2,6,23,0.08)_32%,rgba(2,6,23,0.76)_100%)]" />
      <div className="absolute left-4 top-5 z-30 sm:left-8">
        <Link
          href="/projects"
          className="inline-flex h-10 items-center rounded-full border border-cyan-200/15 bg-slate-950/35 px-4 text-sm font-semibold text-cyan-100 backdrop-blur-xl hover:bg-cyan-400/10"
        >
          {t("back")}
        </Link>
      </div>
      <div className="relative z-10 min-h-screen w-full">
        <ProjectGalaxy project={project} lang={lang} />
      </div>
    </main>
  );
}
