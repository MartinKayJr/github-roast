import { getTranslations } from "next-intl/server";
import { AdminArticlePublisher } from "@/components/admin/AdminArticlePublisher";

export default async function AdminContentPage() {
  const t = await getTranslations("admin");

  return (
    <section>
      <header className="mb-6 border-b border-white/10 pb-5">
        <h1 className="text-2xl font-black text-zinc-100">{t("contentTitle")}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{t("contentDescription")}</p>
      </header>
      <AdminArticlePublisher />
    </section>
  );
}
