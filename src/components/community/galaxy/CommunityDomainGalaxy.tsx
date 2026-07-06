"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Radar, Swords, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { tierStyle } from "@/lib/tier";
import type { CircleDomain } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import {
  GalaxyParticleEngine,
  type GalaxyMemberNode,
} from "./GalaxyParticleEngine";

interface CommunityDomainGalaxyProps {
  domain: CircleDomain;
  lang: Lang;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function hueFromSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i += 1) {
    h = (h * 33 + slug.charCodeAt(i)) % 360;
  }
  return 178 + (h % 128);
}

function nodeFor(index: number, total: number, slug: string): GalaxyMemberNode {
  const ring = Math.floor(index / 8);
  const slot = index % 8;
  const offset = ((slug.charCodeAt(index % slug.length) || 0) % 42) * 0.01;
  return {
    angle: (slot / Math.min(8, total)) * Math.PI * 2 - Math.PI / 2 + offset,
    radius: 0.34 + ring * 0.11 + ((index * 7) % 9) / 100,
    yScale: 0.32 + ring * 0.08 + ((index * 11) % 12) / 100,
    glow: "rgba(125,211,252,0.85)",
  };
}

export function CommunityDomainGalaxy({ domain, lang }: CommunityDomainGalaxyProps) {
  const t = useTranslations("communityDomain");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GalaxyParticleEngine | null>(null);
  const [nodePositions, setNodePositions] = useState<{ x: number; y: number }[]>([]);
  const [showAvatars, setShowAvatars] = useState(false);
  const name = lang === "en" ? domain.name.en || domain.name.zh : domain.name.zh;
  const members = useMemo(() => domain.members.slice(0, 18), [domain.members]);
  const featured = useMemo(() => domain.members.slice(0, 10), [domain.members]);

  const nodes = useMemo<GalaxyMemberNode[]>(
    () =>
      members.map((member, index) => ({
        ...nodeFor(index, members.length, domain.slug),
        glow: tierStyle(member.tier).glow,
      })),
    [domain.slug, members],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduceMotion = prefersReducedMotion();
    try {
      engineRef.current = new GalaxyParticleEngine(canvas, {
        particleCount: reduceMotion ? 130 : 360,
        nodes,
        hue: hueFromSlug(domain.slug),
        reduceMotion,
      });
    } catch {
      return;
    }

    const engine = engineRef.current;
    const updatePositions = () => {
      engine.resize();
      setNodePositions(nodes.map((node) => engine.nodeScreenPos(node)));
    };
    updatePositions();

    engine.setPhase("forming");
    engine.start();
    const orbitTimer = window.setTimeout(() => engine.setPhase("orbiting"), 820);
    const revealTimer = window.setTimeout(() => {
      engine.setPhase("revealed");
      setShowAvatars(true);
    }, 1850);
    const observer = new ResizeObserver(updatePositions);
    observer.observe(canvas);

    return () => {
      window.clearTimeout(orbitTimer);
      window.clearTimeout(revealTimer);
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, [domain.slug, nodes]);

  return (
    <section className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden px-4 py-8 sm:px-8 sm:py-10">
      <div className="absolute left-4 top-5 z-30 flex items-center gap-2 sm:left-8">
        <Link
          href="/community"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-200/15 bg-slate-950/30 text-cyan-100 shadow-[0_0_30px_-14px_rgba(34,211,238,0.9)] backdrop-blur-xl hover:bg-cyan-400/10"
          aria-label={t("back")}
        >
          <Radar className="h-4 w-4" />
        </Link>
      </div>

      <div className="absolute right-4 top-5 z-30 flex items-center gap-2 sm:right-8">
        <Link
          href={`/developers`}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-violet-200/15 bg-slate-950/30 text-violet-100 shadow-[0_0_30px_-14px_rgba(167,139,250,0.9)] backdrop-blur-xl hover:bg-violet-400/10"
          aria-label={t("aiFind")}
        >
          <Bot className="h-4 w-4" />
        </Link>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-12 z-20 w-[min(88vw,42rem)] -translate-x-1/2 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/55">
          {t("domain")}
        </p>
        <h1 className="mt-2 text-balance text-2xl font-black leading-tight text-cyan-50 sm:text-4xl">
          {name}
        </h1>
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs text-cyan-100/70">
          <span>{t("memberCount", { count: domain.member_count })}</span>
          {domain.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-cyan-200/80">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="relative mx-auto h-[72vh] min-h-[34rem] w-full max-w-7xl pt-14">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        />

        <div className="pointer-events-none absolute inset-0 z-20">
          {showAvatars &&
            nodePositions.map((pos, index) => {
              const member = members[index];
              if (!member) return null;
              const style = tierStyle(member.tier);
              const size = index < 6 ? "h-11 w-11" : "h-9 w-9";
              return (
                <Link
                  key={member.login}
                  href={`/u/${member.login}`}
                  prefetch={false}
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: pos.x, top: pos.y }}
                  aria-label={`@${member.login}`}
                >
                  <span
                    className="galaxy-avatar-reveal block animate-[galaxy-avatar-reveal_760ms_cubic-bezier(0.16,1,0.3,1)_both]"
                    style={{ animationDelay: `${index * 55}ms` }}
                  >
                    {member.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.avatar_url}
                        alt={member.login}
                        className={`${size} rounded-full object-cover ring-2 ring-white/25 transition-transform hover:scale-125`}
                        style={{ boxShadow: `0 0 18px -2px ${style.glow}` }}
                      />
                    ) : (
                      <span
                        className={`${size} flex items-center justify-center rounded-full bg-white/10 text-sm font-bold text-cyan-50 ring-2 ring-white/25 transition-transform hover:scale-125`}
                        style={{ boxShadow: `0 0 18px -2px ${style.glow}` }}
                      >
                        {member.login.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
        </div>
      </div>

      <div className="relative z-30 mx-auto -mt-12 flex w-full max-w-5xl flex-col items-center gap-5 pb-8">
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href="/community"
            className="inline-flex items-center gap-2 rounded-full border border-cyan-200/15 bg-slate-950/35 px-4 py-2 text-sm font-semibold text-cyan-100 backdrop-blur-xl hover:bg-cyan-400/10"
          >
            <Users className="h-4 w-4" />
            {t("exploreMore")}
          </Link>
          {featured.length >= 2 && (
            <Link
              href={`/vs/${featured[0].login}/${featured[1].login}`}
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-full border border-rose-200/15 bg-slate-950/35 px-4 py-2 text-sm font-semibold text-rose-100 backdrop-blur-xl hover:bg-rose-400/10"
            >
              <Swords className="h-4 w-4" />
              {t("challenge")}
            </Link>
          )}
          <Link
            href="/developers"
            className="inline-flex items-center gap-2 rounded-full border border-violet-200/15 bg-slate-950/35 px-4 py-2 text-sm font-semibold text-violet-100 backdrop-blur-xl hover:bg-violet-400/10"
          >
            <Bot className="h-4 w-4" />
            {t("aiFind")}
          </Link>
        </div>

        {featured.length > 0 ? (
          <div className="flex max-w-full gap-3 overflow-x-auto px-2 py-3 [scrollbar-width:none]">
            {featured.map((member) => {
              const style = tierStyle(member.tier);
              return (
                <Link
                  key={member.login}
                  href={`/u/${member.login}`}
                  prefetch={false}
                  className="group flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-slate-950/30 py-1.5 pl-1.5 pr-3 text-sm text-cyan-50 backdrop-blur-xl hover:bg-white/10"
                >
                  {member.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.avatar_url}
                      alt={member.login}
                      className="h-8 w-8 rounded-full object-cover ring-1 ring-white/20"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 font-bold">
                      {member.login.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="font-semibold">@{member.login}</span>
                  <span className={`tabular-nums ${style.text}`}>
                    {member.final_score.toFixed(0)}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-cyan-100/45">{t("empty")}</p>
        )}
      </div>
    </section>
  );
}
