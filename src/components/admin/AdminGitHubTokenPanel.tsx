"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

type GitHubTokenView = {
  id: string;
  label: string;
  token_suffix: string;
  status: "active" | "disabled" | "cooldown";
  priority: number;
  fail_count: number;
  last_error: string | null;
  last_used_at: number | null;
  cooldown_until: number | null;
  created_at: number;
  updated_at: number;
};

export function AdminGitHubTokenPanel() {
  const t = useTranslations("admin");
  const [tokens, setTokens] = useState<GitHubTokenView[]>([]);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [priority, setPriority] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadTokens() {
    try {
      const res = await fetch("/api/admin/github-tokens", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tokens: GitHubTokenView[] };
      setTokens(data.tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      fetch("/api/admin/github-tokens", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ tokens: GitHubTokenView[] }>) : null))
        .then((data) => {
          if (!cancelled && data) setTokens(data.tokens);
        })
        .catch(() => {});
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  async function addToken(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/github-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, token, priority }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLabel("");
      setToken("");
      setPriority(100);
      await loadTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, status: "active" | "disabled") {
    setError(null);
    try {
      const res = await fetch("/api/admin/github-tokens", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : "update_failed");
    }
  }

  async function removeToken(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/github-tokens?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
    }
  }

  function formatTime(value: number | null) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  return (
    <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-zinc-100">{t("githubTokensTitle")}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
            {t("githubTokensBody")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadTokens()}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/[0.06]"
        >
          <RefreshCcw className="h-4 w-4" />
          {t("githubTokensRefresh")}
        </button>
      </div>

      <form onSubmit={addToken} className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_7rem_auto]">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("githubTokensLabel")}
          className="border-white/10 bg-black/20 text-zinc-100"
        />
        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("githubTokensToken")}
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="border-white/10 bg-black/20 text-zinc-100"
        />
        <Input
          value={priority}
          onChange={(e) => setPriority(Math.max(0, Number(e.target.value) || 100))}
          type="number"
          min={0}
          aria-label={t("githubTokensPriority")}
          className="border-white/10 bg-black/20 text-zinc-100"
        />
        <button
          type="submit"
          disabled={loading || !token.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t("githubTokensAdd")}
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded-xl border border-red-400/15 bg-red-400/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-5 space-y-3">
        {tokens.length === 0 ? (
          <p className="text-sm text-zinc-500">{t("githubTokensEmpty")}</p>
        ) : (
          tokens.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/10 bg-black/10 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-zinc-100">{item.label}</span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-400">
                      {t(`githubTokenStatus.${item.status}`)}
                    </span>
                    <span className="text-xs text-zinc-500">****{item.token_suffix}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                    <span>{t("githubTokensPriorityValue", { value: item.priority })}</span>
                    <span>{t("githubTokensFailCount", { count: item.fail_count })}</span>
                    <span>{t("githubTokensLastUsed", { time: formatTime(item.last_used_at) })}</span>
                    {item.cooldown_until && (
                      <span>{t("githubTokensCooldown", { time: formatTime(item.cooldown_until) })}</span>
                    )}
                  </div>
                  {item.last_error && (
                    <p className="mt-2 text-xs text-rose-300">{item.last_error}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void updateStatus(item.id, item.status === "active" ? "disabled" : "active")
                    }
                    className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/[0.06]"
                  >
                    {item.status === "active" ? t("githubTokensDisable") : t("githubTokensEnable")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeToken(item.id)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-red-300/20 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("githubTokensDelete")}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
