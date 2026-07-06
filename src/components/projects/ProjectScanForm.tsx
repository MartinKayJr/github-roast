"use client";

import { useState } from "react";
import { GitBranch, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProjectScanForm() {
  const t = useTranslations("projects");
  const router = useRouter();
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = repo.trim();
    if (!value || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: value }),
      });
      const data = (await res.json()) as { href?: string; error?: string };
      if (!res.ok || !data.href) {
        throw new Error(data.error || "project_scan_failed");
      }
      router.push(data.href);
    } catch (err) {
      const code = err instanceof Error ? err.message : "project_scan_failed";
      setError(t(`errors.${code}`));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="relative flex items-center gap-2 rounded-full border border-cyan-200/15 bg-slate-950/55 p-2 shadow-[0_0_70px_-28px_rgba(34,211,238,0.9)] backdrop-blur-xl">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-100">
          <GitBranch className="h-4 w-4" />
        </span>
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder={t("placeholder")}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 min-w-0 border-0 bg-transparent px-1 text-base text-cyan-50 placeholder:text-cyan-100/30 focus-visible:ring-0"
        />
        <Button
          type="submit"
          size="icon"
          shape="pill"
          disabled={loading || !repo.trim()}
          aria-label={loading ? t("scanning") : t("scan")}
          className="h-11 w-11 shrink-0 bg-cyan-300 text-slate-950 hover:bg-cyan-200"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>
      {error && (
        <p className="text-center text-sm font-medium text-rose-300" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
