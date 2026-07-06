import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { InboxClient, type InboxClientMessage } from "@/components/inbox/InboxClient";
import { auth, authConfigured } from "@/lib/auth";
import { listInboxMessages } from "@/lib/db";
import { localeAlternates } from "@/lib/site";

export const dynamic = "force-dynamic";

function formatTime(locale: string, timestamp: number) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "inbox" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localeAlternates(locale, "/inbox"),
  };
}

export default async function InboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("inbox");
  const session = authConfigured() ? await auth() : null;
  const githubId = session?.user?.githubId ?? null;

  if (!githubId) {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-border bg-card p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-foreground">
            {t("signInTitle")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {authConfigured() ? t("signInBody") : t("authDisabledBody")}
          </p>
        </div>
      </main>
    );
  }

  const messages = await listInboxMessages(githubId);
  const clientMessages: InboxClientMessage[] = messages.map((message) => ({
    id: message.id,
    sender_kind: message.sender_kind,
    sender_login: message.sender_login,
    title: message.title,
    body: message.body,
    action_href: message.action_href,
    read_at: message.read_at,
    created_at: message.created_at,
    createdLabel: formatTime(locale, message.created_at),
  }));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          {t("eyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground">
          {t("heading")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>
      <InboxClient initialMessages={clientMessages} />
    </main>
  );
}
