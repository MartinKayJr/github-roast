import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function LocaleNotFound() {
  const t = await getTranslations("detail");

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col items-center justify-center px-5 py-20 text-center">
      <h1 className="text-4xl font-black">404</h1>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-orange-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-500"
      >
        {t("selfCta")}
      </Link>
    </main>
  );
}
