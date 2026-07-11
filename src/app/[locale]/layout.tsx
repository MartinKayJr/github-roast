import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { HtmlLangSync } from "@/components/HtmlLangSync";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Enable static rendering for this locale.
  setRequestLocale(locale);

  return (
    <NextIntlClientProvider>
      <HtmlLangSync locale={locale} />
      {children}
    </NextIntlClientProvider>
  );
}
