"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, GitFork, LoaderCircle, Orbit, Star, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { PendingLink } from "@/components/PendingLink";
import { Link } from "@/i18n/navigation";
import type { ProjectScoreDetail } from "@/lib/db";
import { tierStyle } from "@/lib/tier";
import {
  GalaxyParticleEngine,
  type GalaxyMemberNode,
} from "@/components/community/galaxy/GalaxyParticleEngine";

interface ProjectGalaxyProps {
  project: ProjectScoreDetail;
  lang: "zh" | "en";
}

function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 29 + name.charCodeAt(i)) % 360;
  return 172 + (h % 134);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function ProjectGalaxy({ project, lang }: ProjectGalaxyProps) {
  const t = useTranslations("projects");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GalaxyParticleEngine | null>(null);
  const [nodePositions, setNodePositions] = useState<{ x: number; y: number }[]>([]);
  const [showAvatars, setShowAvatars] = useState(false);
  const contributors = useMemo(() => project.contributors.slice(0, 18), [project.contributors]);
  const scored = contributors.filter((c) => c.profile_score !== null);
  const nodes = useMemo<GalaxyMemberNode[]>(
    () =>
      contributors.map((c, index) => {
        const ring = Math.floor(index / 8);
        const slot = index % 8;
        const count = Math.min(8, contributors.length);
        return {
          angle: (slot / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2 + ((index * 17) % 31) * 0.01,
          radius: 0.34 + ring * 0.12 + ((index * 5) % 10) / 100,
          yScale: 0.3 + ring * 0.09 + ((index * 7) % 11) / 100,
          glow: c.profile_tier ? tierStyle(c.profile_tier).glow : "rgba(125,211,252,0.65)",
        };
      }),
    [contributors],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduceMotion = prefersReducedMotion();
    try {
      engineRef.current = new GalaxyParticleEngine(canvas, {
        particleCount: reduceMotion ? 120 : 340,
        nodes,
        hue: hueFromName(project.full_name),
        reduceMotion,
      });
    } catch {
      return;
    }
    const engine = engineRef.current;
    const update = () => {
      engine.resize();
      setNodePositions(nodes.map((node) => engine.nodeScreenPos(node)));
    };
    update();
    engine.setPhase("forming");
    engine.start();
    const orbitTimer = window.setTimeout(() => engine.setPhase("orbiting"), 820);
    const revealTimer = window.setTimeout(() => {
      engine.setPhase("revealed");
      setShowAvatars(true);
    }, 1850);
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => {
      window.clearTimeout(orbitTimer);
      window.clearTimeout(revealTimer);
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, [nodes, project.full_name]);

  const roast = lang === "en" ? project.roast_line.en || project.roast_line.zh : project.roast_line.zh;

  return (
    <section className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden px-4 py-8 sm:px-8 sm:py-10">
      <div className="pointer-events-none absolute left-1/2 top-10 z-20 w-[min(90vw,46rem)] -translate-x-1/2 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/55">
          {t("projectPlanet")}
        </p>
        <h1 className="mt-2 text-balance text-3xl font-black leading-tight text-cyan-50 sm:text-5xl">
          {project.full_name}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-cyan-100/62">{roast}</p>
      </div>

      <div className="absolute right-4 top-5 z-30 flex items-center gap-2 sm:right-8">
        <PendingLink
          href={`/community/${encodeURIComponent(project.domain_slug)}`}
          pendingChildren={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          pendingClassName="pointer-events-none opacity-80"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-200/15 bg-slate-950/35 text-cyan-100 backdrop-blur-xl hover:bg-cyan-400/10"
          aria-label={t("openCircle")}
        >
          <Orbit className="h-4 w-4" />
        </PendingLink>
      </div>

      <div className="relative mx-auto h-[72vh] min-h-[35rem] w-full max-w-7xl pt-16">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="text-6xl font-black text-cyan-50/95 sm:text-8xl">{project.band}</div>
          <div className="mt-1 text-sm font-semibold tabular-nums text-cyan-100/65">
            {project.score.toFixed(0)}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 z-20">
          {showAvatars &&
            nodePositions.map((pos, index) => {
              const c = contributors[index];
              if (!c) return null;
              const content = (
                <span
                  className="galaxy-avatar-reveal block animate-[galaxy-avatar-reveal_760ms_cubic-bezier(0.16,1,0.3,1)_both]"
                  style={{ animationDelay: `${index * 55}ms` }}
                >
                  {c.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.avatar_url}
                      alt={c.login}
                      className={`rounded-full object-cover ring-2 ${
                        c.profile_score === null ? "h-8 w-8 opacity-70 ring-white/10" : "h-10 w-10 ring-white/25"
                      } transition-transform hover:scale-125`}
                    />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-cyan-50 ring-2 ring-white/15">
                      {c.login.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
              );
              const className = "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2";
              const style = { left: pos.x, top: pos.y };
              return c.profile_score === null ? (
                <a
                  key={c.login}
                  href={c.html_url ?? `https://github.com/${c.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                  style={style}
                  aria-label={`@${c.login}`}
                >
                  {content}
                </a>
              ) : (
                <Link
                  key={c.login}
                  href={`/u/${c.login}`}
                  prefetch={false}
                  className={className}
                  style={style}
                  aria-label={`@${c.login}`}
                >
                  {content}
                </Link>
              );
            })}
        </div>
      </div>

      <div className="relative z-30 mx-auto -mt-12 flex w-full max-w-5xl flex-col items-center gap-5 pb-8">
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ["activity", project.breakdown.activity],
            ["quality", project.breakdown.quality],
            ["collaboration", project.breakdown.collaboration],
            ["impact", project.breakdown.impact],
            ["authenticity", project.breakdown.authenticity],
          ].map(([key, value]) => (
            <div key={key} className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2 text-center backdrop-blur-xl">
              <div className="text-xs text-cyan-100/45">{t(`breakdown.${key}`)}</div>
              <div className="mt-1 text-lg font-black tabular-nums text-cyan-50">{Number(value).toFixed(0)}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-2 text-sm text-cyan-100/75">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/30 px-3 py-1.5 backdrop-blur-xl">
            <Star className="h-3.5 w-3.5" />
            {project.stars.toLocaleString()}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/30 px-3 py-1.5 backdrop-blur-xl">
            <GitFork className="h-3.5 w-3.5" />
            {project.forks.toLocaleString()}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/30 px-3 py-1.5 backdrop-blur-xl">
            <Users className="h-3.5 w-3.5" />
            {project.contributors.length}
          </span>
          <Link
            href="/developers"
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-200/15 bg-slate-950/30 px-3 py-1.5 font-semibold text-violet-100 backdrop-blur-xl hover:bg-violet-400/10"
          >
            <Bot className="h-3.5 w-3.5" />
            {t("aiFind")}
          </Link>
        </div>

        <div className="flex max-w-full gap-3 overflow-x-auto px-2 py-3 [scrollbar-width:none]">
          {project.contributors.slice(0, 14).map((c) => (
            <Link
              key={c.login}
              href={c.profile_score === null ? `/projects/${project.owner}/${project.repo}` : `/u/${c.login}`}
              prefetch={false}
              className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-slate-950/30 py-1.5 pl-1.5 pr-3 text-sm text-cyan-50 backdrop-blur-xl hover:bg-white/10"
            >
              {c.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatar_url} alt={c.login} className="h-8 w-8 rounded-full object-cover ring-1 ring-white/20" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 font-bold">
                  {c.login.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="font-semibold">@{c.login}</span>
              <span className="text-cyan-100/45">{c.contributions}</span>
              {c.profile_score === null ? (
                <span className="text-zinc-500">{t("pendingUser")}</span>
              ) : (
                <span className="tabular-nums text-cyan-200">{c.profile_score.toFixed(0)}</span>
              )}
            </Link>
          ))}
        </div>

        {scored.length === 0 && (
          <p className="text-center text-sm text-cyan-100/45">{t("noScoredContributors")}</p>
        )}
      </div>
    </section>
  );
}
