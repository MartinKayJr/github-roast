import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { authConfigured } from "@/lib/auth";
import { Navbar } from "@/components/Navbar";
import { LoginNudge } from "@/components/LoginNudge";
import { SiteFooter } from "@/components/SiteFooter";
import {
  JsonLd,
  websiteJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
} from "@/components/JsonLd";
import { SITE_URL, localeAlternates } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(SITE_URL),
    title: t("title"),
    description: t("description"),
    alternates: {
      ...localeAlternates(locale, "/"),
      types: {
        "text/markdown": "/index.md",
        "application/openapi+json": "/openapi.json",
      },
    },
    openGraph: {
      title: t("ogTitle"),
      description: t("ogDescription"),
      url: locale === "en" ? "/en" : "/",
      siteName: t("siteName"),
      type: "website",
      images: [{ url: "/api/og/home", width: 1200, height: 630, alt: t("siteName") }],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("twDescription"),
      images: ["/api/og/home"],
    },
  };
}

export default async function SiteLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  const tMeta = await getTranslations({ locale, namespace: "meta" });

  return (
    <>
      <JsonLd data={websiteJsonLd({ name: tMeta("siteName"), description: tMeta("description") })} />
      <JsonLd data={organizationJsonLd(tMeta("siteName"))} />
      <JsonLd
        data={softwareApplicationJsonLd({
          name: tMeta("siteName"),
          description: tMeta("description"),
        })}
      />
      <Navbar />
      {children}
      <SiteFooter />
      <LoginNudge configured={authConfigured()} />
    </>
  );
}
