"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

type MeResponse = {
  user: { login: string; image: string | null } | null;
  growthSubscribed?: boolean;
};

export function GrowthSubscriptionSettings() {
  const t = useTranslations("settings");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<MeResponse>)
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        if (!cancelled) setMe({ user: null, growthSubscribed: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedIn = Boolean(me?.user);
  const subscribed = Boolean(me?.growthSubscribed);

  async function updateSubscription(nextSubscribed: boolean) {
    setError(false);
    if (!signedIn) {
      void signIn("github");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/growth-subscription", {
        method: nextSubscribed ? "POST" : "DELETE",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { subscribed?: boolean };
      setMe((prev) => ({
        user: prev?.user ?? null,
        growthSubscribed: Boolean(data.subscribed),
      }));
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-zinc-100">
            {t("growthTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
            {t("growthBody")}
          </p>
          {me?.user && (
            <p className="mt-2 text-xs text-zinc-500">@{me.user.login}</p>
          )}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => updateSubscription(!subscribed)}
          className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
            subscribed
              ? "border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]"
              : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:border-emerald-300/50 hover:bg-emerald-400/15"
          } disabled:cursor-wait disabled:opacity-70`}
        >
          {saving
            ? t("saving")
            : !signedIn
              ? t("signInToSubscribe")
              : subscribed
                ? t("unsubscribeGrowth")
                : t("subscribeGrowth")}
        </button>
      </div>
      {subscribed && (
        <p className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
          {t("growthSubscribed")}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-red-400/15 bg-red-400/10 px-3 py-2 text-sm text-red-300">
          {t("failed")}
        </p>
      )}
    </section>
  );
}
