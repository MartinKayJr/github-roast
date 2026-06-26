"use client";

import { forwardRef, useEffect, useState } from "react";
import { tierStyle } from "@/lib/tier";
import type { Tier } from "@/lib/types";

interface ShareCardProps {
  username: string;
  name: string | null;
  avatarUrl: string | null;
  score: number;
  tier: Tier;
  tierLabel: string;
  beat: number | null;
}

/**
 * The "flex" card rendered off-screen and exported to PNG via html-to-image.
 * Fixed 600×360 so the export is deterministic. The avatar is inlined as a data
 * URL up-front so the cross-origin image never taints the export canvas.
 */
export const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(function ShareCard(
  { username, name, avatarUrl, score, tier, tierLabel, beat },
  ref,
) {
  const style = tierStyle(tier);
  const [avatarData, setAvatarData] = useState<string | null>(null);

  useEffect(() => {
    if (!avatarUrl) return;
    let alive = true;
    fetch(avatarUrl)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = reject;
            fr.readAsDataURL(b);
          }),
      )
      .then((d) => alive && setAvatarData(d))
      .catch(() => {
        /* CORS/network — fall back to the initial-letter avatar */
      });
    return () => {
      alive = false;
    };
  }, [avatarUrl]);

  return (
    <div
      ref={ref}
      style={{ width: 600, height: 360 }}
      className="relative flex flex-col justify-between overflow-hidden bg-[#0a0a0b] p-7 font-sans text-white"
    >
      <div
        className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full blur-3xl"
        style={{ background: style.glow }}
      />

      {/* Header: avatar + handle */}
      <div className="flex items-center gap-3">
        {avatarData ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarData} alt="" className="h-14 w-14 rounded-full" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-xl font-bold">
            {username.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="leading-tight">
          <div className="text-lg font-bold">@{username}</div>
          {name && <div className="text-sm text-zinc-400">{name}</div>}
        </div>
      </div>

      {/* Score */}
      <div className="flex items-end justify-between">
        <div>
          <div className={`text-7xl font-black tabular-nums ${style.text}`}>
            {score.toFixed(2)}
            <span className="text-3xl text-zinc-600">/100</span>
          </div>
          <div className={`mt-1 text-3xl font-bold ${style.text}`}>
            {style.emoji} {tier}
          </div>
          <div className="text-sm text-zinc-400">{tierLabel}</div>
        </div>
        {beat !== null && (
          <div className="mb-1 text-right">
            <div className={`text-4xl font-black ${style.text}`}>{beat}%</div>
            <div className="text-xs text-zinc-400">超越的开发者</div>
          </div>
        )}
      </div>

      {/* Footer brand */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-500">🔥 毒舌 GitHub 评分 · 来测测你的含金量</span>
        <span className="font-black text-orange-400">githubroast.icu</span>
      </div>
    </div>
  );
});
