import { getTranslations } from "next-intl/server";

export type FaqItem = { q: string; a: string };

/** Load the FAQ items once so the same array feeds the rendered section and the
 *  FAQPage JSON-LD (no drift between what users read and what agents parse). */
export async function getFaqItems(): Promise<FaqItem[]> {
  const t = await getTranslations("faq");
  return t.raw("items") as FaqItem[];
}

/**
 * Server-rendered FAQ. Pure static text (no client JS), so it raises the
 * homepage's crawlable content density and gives LLMs clean, extractable Q&A
 * passages. The `home-faq` class is the speakable selector in the JSON-LD.
 */
export async function HomeFaq({ items }: { items: FaqItem[] }) {
  const t = await getTranslations("faq");
  return (
    <section className="home-faq mt-20 w-full max-w-3xl">
      <h2 className="text-center text-2xl font-black tracking-tight text-[var(--foreground)] sm:text-3xl">
        {t("heading")}
      </h2>
      <div className="mt-8 flex flex-col gap-4">
        {items.map((item, i) => (
          <details
            key={i}
            className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"
            {...(i === 0 ? { open: true } : {})}
          >
            <summary className="cursor-pointer list-none font-bold text-[var(--foreground)] marker:hidden">
              {item.q}
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
