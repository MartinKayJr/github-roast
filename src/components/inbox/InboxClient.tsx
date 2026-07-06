"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCheck, ExternalLink, MailOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export type InboxClientMessage = {
  id: string;
  sender_kind: "system" | "user";
  sender_login: string | null;
  title: string;
  body: string;
  action_href: string | null;
  read_at: number | null;
  created_at: number;
  createdLabel: string;
};

function isInternalHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

function isSafeExternalHref(href: string) {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function InboxClient({
  initialMessages,
}: {
  initialMessages: InboxClientMessage[];
}) {
  const t = useTranslations("inbox");
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isMarkingAll, startMarkingAll] = useTransition();
  const unreadCount = useMemo(
    () => messages.filter((message) => !message.read_at).length,
    [messages],
  );

  async function markRead(id: string) {
    setPendingId(id);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(id)}/read`, {
        method: "POST",
      });
      if (!res.ok) return;
      setMessages((current) =>
        current.map((message) =>
          message.id === id && !message.read_at
            ? { ...message, read_at: Date.now() }
            : message,
        ),
      );
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  function markAllRead() {
    startMarkingAll(async () => {
      const res = await fetch("/api/inbox", { method: "PATCH" });
      if (!res.ok) return;
      const now = Date.now();
      setMessages((current) =>
        current.map((message) =>
          message.read_at ? message : { ...message, read_at: now },
        ),
      );
      router.refresh();
    });
  }

  if (messages.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-8 text-center">
        <MailOpen className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-bold text-foreground">{t("emptyTitle")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {t("emptyBody")}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {unreadCount > 0 ? t("unreadCount", { count: unreadCount }) : t("allRead")}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || isMarkingAll}
          onClick={markAllRead}
        >
          <CheckCheck className="h-4 w-4" />
          {t("markAllRead")}
        </Button>
      </div>

      <div className="divide-y divide-border">
        {messages.map((message) => {
          const unread = !message.read_at;
          return (
            <article
              key={message.id}
              className={`grid gap-3 px-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto] ${
                unread ? "bg-primary/5" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {unread && (
                    <span className="h-2 w-2 rounded-full bg-primary" aria-label={t("unread")} />
                  )}
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {message.sender_kind === "user" && message.sender_login
                      ? `@${message.sender_login}`
                      : t("systemSender")}
                  </span>
                  <time className="text-xs text-muted-foreground">
                    {message.createdLabel}
                  </time>
                </div>
                <h2 className="mt-2 text-base font-bold text-foreground">
                  {message.title}
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {message.body}
                </p>
                {message.action_href &&
                (isInternalHref(message.action_href) || isSafeExternalHref(message.action_href)) ? (
                  <div className="mt-4">
                    {isInternalHref(message.action_href) ? (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={message.action_href}>
                          {t("openAction")}
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild variant="secondary" size="sm">
                        <a
                          href={message.action_href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("openAction")}
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>

              {unread ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pendingId === message.id}
                  onClick={() => void markRead(message.id)}
                  className="self-start"
                >
                  {t("markRead")}
                </Button>
              ) : (
                <span className="self-start rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                  {t("read")}
                </span>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
