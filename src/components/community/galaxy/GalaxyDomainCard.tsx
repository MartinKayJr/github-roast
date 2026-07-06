"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { tierStyle } from "@/lib/tier";
import type { CircleDomain } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import {
  GalaxyParticleEngine,
  type GalaxyMemberNode,
} from "./GalaxyParticleEngine";
import { useGalaxyCardVisibility } from "./useGalaxyCardVisibility";

interface GalaxyDomainCardProps {
  domain: CircleDomain;
  index: number;
  lang: Lang;
  /** When true, the engine is allowed to run; the waterfall caps concurrency. */
  active: boolean;
  /** Report the card's run/pause intent up to the waterfall's concurrency gate. */
  onActivityChange?: (slug: string, wantsToRun: boolean) => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Deterministic hue from the slug so each planet has a stable, distinct color. */
function hueFromSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i += 1) {
    h = (h * 31 + slug.charCodeAt(i)) % 360;
  }
  // Bias toward the cyan→violet band the rest of the galaxy UI lives in.
  return 180 + (h % 120);
}

export function GalaxyDomainCard({
  domain,
  index,
  lang,
  active,
  onActivityChange,
}: GalaxyDomainCardProps) {
  const t = useTranslations("communityGalaxy");
  const { ref, phase, revealCycle } = useGalaxyCardVisibility<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GalaxyParticleEngine | null>(null);
  const [nodePositions, setNodePositions] = useState<{ x: number; y: number }[]>([]);
  const [shownAvatarCycle, setShownAvatarCycle] = useState(-1);

  const name = lang === "en" ? domain.name.en || domain.name.zh : domain.name.zh;
  const members = domain.members.slice(0, 6);
  const height = 260 + ((index * 47) % 120);
  const scale = 0.9 + ((index * 13) % 18) / 100;

  // Stable node ring layout for the visible members — even spacing so avatars
  // don't overlap, and the engine + DOM overlay share the exact same geometry.
  const nodes = useMemo<GalaxyMemberNode[]>(() => {
    const count = members.length;
    return members.map((m, i) => ({
      angle:
        (i / Math.max(1, count)) * Math.PI * 2 -
        Math.PI / 2 +
        (((domain.slug.charCodeAt(i % domain.slug.length) || 0) % 34) - 17) * 0.012,
      radius: 0.31 + (((index + i * 7) % 16) / 100),
      yScale: 0.3 + (((index * 5 + i * 9) % 24) / 100),
      glow: tierStyle(m.tier).glow,
    }));
  }, [domain.slug, index, members]);

  // The waterfall runs the engine only while the card wants to animate AND holds
  // a concurrency slot. `wantsToRun` is derived from the visibility phase.
  const wantsToRun = phase === "forming" || phase === "orbiting" || phase === "revealed";

  useEffect(() => {
    onActivityChange?.(domain.slug, wantsToRun);
  }, [domain.slug, wantsToRun, onActivityChange]);

  // Mount / tear down the engine as the card enters / leaves the near zone.
  useEffect(() => {
    if (phase === "idle") {
      // Far offscreen — release the canvas entirely.
      engineRef.current?.destroy();
      engineRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || engineRef.current) return;

    const reduceMotion = prefersReducedMotion();
    const coarse =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;
    const particleCount = coarse ? 90 : 170;

    try {
      engineRef.current = new GalaxyParticleEngine(canvas, {
        particleCount,
        nodes,
        hue: hueFromSlug(domain.slug),
        reduceMotion,
      });
    } catch {
      // 2d context unavailable — the DOM fallback (avatars + text) still renders.
      return;
    }
    setNodePositions(nodes.map((n) => engineRef.current!.nodeScreenPos(n)));

    const engine = engineRef.current;
    const onResize = () => {
      engine.resize();
      setNodePositions(nodes.map((n) => engine.nodeScreenPos(n)));
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [phase, nodes, domain.slug]);

  // Drive engine phase + RAF from the visibility phase, gated by the concurrency slot.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (phase === "paused" || phase === "idle" || !active) {
      engine.pause();
      return;
    }
    if (phase === "forming") engine.setPhase("forming");
    else if (phase === "orbiting") engine.setPhase("orbiting");
    else if (phase === "revealed") engine.setPhase("revealed");
    else if (phase === "preload") engine.setPhase("idle");
    engine.start();
    return () => engine.pause();
  }, [phase, active]);

  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  // Avatars appear only after the orbit has had time to visibly form. Before
  // that, the canvas node particles stand in for them; the DOM avatars grow out
  // of those points instead of being present immediately.
  useEffect(() => {
    if (phase !== "revealed" || !active) return;
    const cycle = revealCycle;
    const id = window.setTimeout(() => setShownAvatarCycle(cycle), 180);
    return () => window.clearTimeout(id);
  }, [phase, revealCycle, active]);

  const avatarsVisible =
    active && phase === "revealed" && shownAvatarCycle === revealCycle;

  return (
    <div
      ref={ref}
      className="relative overflow-visible"
      style={{
        height,
        transform: `scale(${scale})`,
      }}
    >
      <Link
        href={`/community/${encodeURIComponent(domain.slug)}`}
        prefetch={false}
        aria-label={`${t("explore")} ${name}`}
        className="absolute inset-[10%] z-10 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-[-10%] h-[120%] w-[120%]"
        aria-hidden="true"
      />

      {/* Member avatar overlay — absolutely positioned over the engine's node points. */}
      <div className="pointer-events-none absolute inset-[-10%] z-20 h-[120%] w-[120%]">
        {avatarsVisible &&
          nodePositions.map((pos, i) => {
            const m = members[i];
            if (!m) return null;
            return (
              <Link
                key={m.login}
                href={`/u/${m.login}`}
                prefetch={false}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: pos.x,
                  top: pos.y,
                }}
                aria-label={`@${m.login}`}
              >
                <span
                  className="galaxy-avatar-reveal block animate-[galaxy-avatar-reveal_680ms_cubic-bezier(0.16,1,0.3,1)_both]"
                  style={{
                    animationDelay: `${i * 90}ms`,
                  }}
                >
                  {m.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.avatar_url}
                      alt={m.login}
                      className="h-9 w-9 rounded-full object-cover ring-2 ring-white/20"
                      style={{ boxShadow: `0 0 16px -2px ${tierStyle(m.tier).glow}` }}
                    />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-zinc-100 ring-2 ring-white/20">
                      {m.login.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
        <span className="max-w-[min(16rem,82%)] truncate rounded-full border border-white/10 bg-black/35 px-3 py-1 text-center text-xs font-semibold text-white/85 shadow-[0_0_18px_rgba(34,211,238,0.18)] backdrop-blur-md dark:border-white/12 dark:bg-black/30">
          {name}
        </span>
      </div>

      <span className="sr-only">
        {name} · {t("memberCount", { count: domain.member_count })}
      </span>
    </div>
  );
}
