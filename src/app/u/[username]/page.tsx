import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getAccountDetail } from "@/lib/db";
import { tierStyle } from "@/lib/tier";
import type { SubScoreKey } from "@/lib/types";

// Re-render at most hourly; on-demand pages are then served from the cache, so a
// viral account doesn't hammer the DB or rack up function time on every view.
export const revalidate = 3600;

// Dedupe the DB read between generateMetadata() and the page render.
const getDetail = cache((username: string) => getAccountDetail(username));

const DIMENSIONS: { key: SubScoreKey; label: string; max: number }[] = [
  { key: "account_maturity", label: "账号成熟度", max: 10 },
  { key: "original_project_quality", label: "原创项目质量", max: 18 },
  { key: "contribution_quality", label: "贡献质量", max: 27 },
  { key: "ecosystem_impact", label: "生态/维护影响力", max: 20 },
  { key: "community_influence", label: "社区影响力", max: 8 },
  { key: "activity_authenticity", label: "活跃真实性", max: 17 },
];

function barColor(pct: number): string {
  if (pct >= 0.75) return "bg-emerald-400";
  if (pct >= 0.45) return "bg-amber-400";
  return "bg-rose-400";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const d = await getDetail(decodeURIComponent(username));
  if (!d) return { title: "查无此号 · 毒舌 GitHub 评分" };
  return {
    title: `${d.username} — ${d.final_score.toFixed(2)}/100 · ${d.tier} | 毒舌 GitHub 评分`,
    description: d.tags.zh.length
      ? `#${d.tags.zh.join(" #")} —— 在 githubroast.icu 查看 ${d.username} 的完整评分报告。`
      : `${d.username} 的 GitHub 价值评分报告 —— githubroast.icu。`,
  };
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const d = await getDetail(decodeURIComponent(username));
  if (!d) notFound();
  const style = tierStyle(d.tier);
  const tags = [...d.tags.zh, ...d.tags.en];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-14 sm:py-20">
      <Link href="/leaderboard" className="text-sm text-zinc-400 hover:text-zinc-200">
        ← 返回名人堂
      </Link>

      {/* Header card */}
      <div
        className={`animate-pop mt-4 flex flex-col items-center rounded-2xl border bg-white/[0.03] p-6 text-center ring-1 ${style.ring}`}
        style={{ boxShadow: `0 0 80px -20px ${style.glow}` }}
      >
        {d.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.avatar_url} alt={d.username} className="h-16 w-16 rounded-full" />
        ) : (
          <div className="h-16 w-16 rounded-full bg-white/10" />
        )}
        <a
          href={d.profile_url ?? `https://github.com/${d.username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 text-sm text-zinc-400 hover:text-zinc-200"
        >
          @{d.username}
          {d.display_name && <span className="ml-1.5 text-zinc-500">· {d.display_name}</span>}
        </a>
        <div className={`mt-2 text-6xl font-black tabular-nums ${style.text}`}>
          {d.final_score.toFixed(2)}
          <span className="text-2xl text-zinc-600">/100</span>
        </div>
        <div className={`mt-1 text-2xl font-bold ${style.text}`}>
          {style.emoji} {d.tier}
        </div>
        <div className="mt-1 text-sm text-zinc-400">{style.blurb}</div>

        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {d.tags.zh.map((t, i) => (
              <span
                key={`zh-${t}-${i}`}
                className="rounded-full bg-orange-500/10 px-2 py-0.5 text-xs text-orange-200/90"
              >
                #{t}
              </span>
            ))}
            {d.tags.en.map((t, i) => (
              <span
                key={`en-${t}-${i}`}
                className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-200/90"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Dimension breakdown */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
        <h2 className="mb-4 text-base font-bold text-zinc-200">维度评分</h2>
        <div className="flex flex-col gap-3">
          {DIMENSIONS.map((dim) => {
            const v = d.sub_scores[dim.key] ?? 0;
            const pct = Math.max(0, Math.min(1, v / dim.max));
            return (
              <div key={dim.key}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-zinc-300">{dim.label}</span>
                  <span className="tabular-nums text-zinc-400">
                    {v.toFixed(1)}
                    <span className="text-zinc-600"> / {dim.max}</span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${barColor(pct)}`}
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Full roast report */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-7">
        <h2 className="mb-3 text-lg font-bold text-orange-400">🔥 毒舌点评全文</h2>
        {d.roast ? (
          <div className="report text-[0.95rem] text-zinc-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{d.roast}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            这份锐评还没存档 ——{" "}
            <Link href="/" className="text-orange-400 hover:underline">
              去首页重新审判一次
            </Link>{" "}
            即可生成。
          </p>
        )}
      </section>

      <footer className="mt-10 text-center">
        <Link
          href="/"
          className="inline-block rounded-full bg-orange-600 px-5 py-2 text-sm font-medium text-white hover:bg-orange-500"
        >
          测测你自己的 GitHub 含金量 →
        </Link>
      </footer>
    </main>
  );
}
