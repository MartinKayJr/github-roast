"use client";

import { useEffect, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import { Link } from "@/i18n/navigation";
import { tierStyle } from "@/lib/tier";
import type { CommunityWaterfallEntry } from "@/lib/db";

export interface CommunityOrbitSubject {
  kind: "user" | "domain" | "circle";
  label: string;
  subtitle?: string;
  avatarUrl?: string | null;
}

interface CommunityOrbitRadarProps {
  subject: CommunityOrbitSubject;
  entries: CommunityWaterfallEntry[];
}

const NODE_SLOTS: Array<{ angle: number; level: 1 | 2 | 3; depth: number }> = [
  { angle: -35, level: 1, depth: 0.92 },
  { angle: 155, level: 1, depth: 0.88 },
  { angle: 24, level: 2, depth: 0.74 },
  { angle: 204, level: 2, depth: 0.68 },
  { angle: -92, level: 3, depth: 0.58 },
  { angle: 82, level: 3, depth: 0.52 },
];

type Pointer = { x: number; y: number; active: boolean };
type VisualNode = { xPct: number; yPct: number; level: 1 | 2 | 3; depth: number };

const LAYER_RADIUS: Record<1 | 2 | 3, number> = {
  1: 18,
  2: 31,
  3: 43,
};

function initial(label: string) {
  return label.replace(/^@/, "").trim().slice(0, 1).toUpperCase() || "G";
}

function nodePosition(index: number): VisualNode {
  const slot = NODE_SLOTS[index % NODE_SLOTS.length];
  const angle = (slot.angle * Math.PI) / 180;
  const radius = LAYER_RADIUS[slot.level];
  return {
    xPct: 50 + Math.cos(angle) * radius,
    yPct: 50 + Math.sin(angle) * radius * 0.66,
    level: slot.level,
    depth: slot.depth,
  };
}

function ParticleField({
  pointerRef,
  nodes,
}: {
  pointerRef: RefObject<Pointer>;
  nodes: VisualNode[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef(nodes);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const surface = canvas;
    const context = ctx;
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let raf = 0;
    let width = 0;
    let height = 0;
    let visible =
      document.visibilityState === "visible" &&
      surface.getBoundingClientRect().bottom > 0 &&
      surface.getBoundingClientRect().top < window.innerHeight;
    let tick = 0;
    const ambientParticles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      alpha: number;
      hue: number;
    }> = [];
    const layerParticles: Array<{
      angle: number;
      level: 1 | 2 | 3;
      jitter: number;
      speed: number;
      r: number;
      alpha: number;
      hue: number;
    }> = [];
    const coreParticles: Array<{
      angle: number;
      radius: number;
      speed: number;
      r: number;
      alpha: number;
      lift: number;
    }> = [];

    function resize() {
      const rect = surface.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      surface.width = Math.floor(width * dpr);
      surface.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      ambientParticles.length = 0;
      layerParticles.length = 0;
      coreParticles.length = 0;
      const count = reduceMotion
        ? 24
        : Math.max(36, Math.min(72, Math.floor((width * height) / 4200)));
      for (let i = 0; i < count; i += 1) {
        ambientParticles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12,
          r: 0.55 + Math.random() * 1.35,
          alpha: 0.1 + Math.random() * 0.24,
          hue: 184 + Math.random() * 42,
        });
      }
      for (const level of [1, 2, 3] as const) {
        const levelCount = reduceMotion
          ? level === 1
            ? 22
            : level === 2
              ? 34
              : 42
          : level === 1
            ? 58
            : level === 2
              ? 84
              : 112;
        for (let i = 0; i < levelCount; i += 1) {
          layerParticles.push({
            angle: Math.random() * Math.PI * 2,
            level,
            jitter: (Math.random() - 0.5) * (level === 1 ? 12 : level === 2 ? 18 : 24),
            speed: (0.0016 + Math.random() * 0.0024) * (Math.random() > 0.5 ? 1 : -1),
            r: 0.55 + Math.random() * (level === 1 ? 1.55 : 1.25),
            alpha: level === 1 ? 0.46 : level === 2 ? 0.34 : 0.24,
            hue: level === 1 ? 188 + Math.random() * 18 : 202 + Math.random() * 24,
          });
        }
      }
      const coreCount = reduceMotion ? 52 : 140;
      for (let i = 0; i < coreCount; i += 1) {
        const shell = Math.sqrt(Math.random());
        coreParticles.push({
          angle: Math.random() * Math.PI * 2,
          radius: shell * 44,
          speed: (0.004 + Math.random() * 0.012) * (Math.random() > 0.42 ? 1 : -1),
          r: 0.7 + Math.random() * 2.2 * (1 - shell * 0.45),
          alpha: 0.24 + Math.random() * 0.58 * (1 - shell * 0.35),
          lift: (Math.random() - 0.5) * 26,
        });
      }
    }

    function draw() {
      if (!visible) {
        raf = requestAnimationFrame(draw);
        return;
      }
      tick += reduceMotion ? 0.18 : 1;
      context.clearRect(0, 0, width, height);
      const pointer = pointerRef.current;
      const centerX = width / 2;
      const centerY = height / 2;
      const minDim = Math.min(width, height);
      const parallaxX = pointer.active ? (pointer.x - centerX) * 0.018 : 0;
      const parallaxY = pointer.active ? (pointer.y - centerY) * 0.012 : 0;
      const pullX = pointer.active ? (pointer.x - centerX) * 0.00025 : 0;
      const pullY = pointer.active ? (pointer.y - centerY) * 0.00025 : 0;

      const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, width * 0.58);
      glow.addColorStop(0, "rgba(34, 211, 238, 0.26)");
      glow.addColorStop(0.18, "rgba(59, 130, 246, 0.12)");
      glow.addColorStop(0.42, "rgba(14, 165, 233, 0.045)");
      glow.addColorStop(1, "rgba(2, 6, 23, 0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      for (const p of ambientParticles) {
        if (!reduceMotion) {
          p.x += p.vx + pullX;
          p.y += p.vy + pullY;
        }
        if (p.x < -12) p.x = width + 12;
        if (p.x > width + 12) p.x = -12;
        if (p.y < -12) p.y = height + 12;
        if (p.y > height + 12) p.y = -12;
      }

      for (const p of layerParticles) {
        if (!reduceMotion) p.angle += p.speed;
        const layerRadius = (LAYER_RADIUS[p.level] / 100) * minDim + p.jitter;
        const x = centerX + parallaxX * p.level + Math.cos(p.angle) * layerRadius;
        const y =
          centerY +
          parallaxY * p.level +
          Math.sin(p.angle) * layerRadius * 0.66;
        context.fillStyle = `hsla(${p.hue}, 96%, 72%, ${p.alpha})`;
        context.beginPath();
        context.arc(x, y, p.r, 0, Math.PI * 2);
        context.fill();
      }

      for (const p of coreParticles) {
        if (!reduceMotion) p.angle += p.speed;
        const depth = Math.sin(p.angle + p.lift * 0.025);
        const x =
          centerX +
          parallaxX * 0.35 +
          Math.cos(p.angle) * p.radius * (0.92 + depth * 0.08);
        const y =
          centerY +
          parallaxY * 0.35 +
          Math.sin(p.angle) * p.radius * 0.58 +
          p.lift * 0.42;
        const alpha = p.alpha * (0.66 + depth * 0.28);
        context.fillStyle = `rgba(165, 243, 252, ${Math.max(0.08, alpha)})`;
        context.beginPath();
        context.arc(x, y, p.r * (0.86 + depth * 0.18), 0, Math.PI * 2);
        context.fill();
      }

      for (const node of nodesRef.current) {
        const x = (node.xPct / 100) * width + parallaxX * node.depth;
        const y = (node.yPct / 100) * height + parallaxY * node.depth;
        const dx = x - centerX;
        const dy = y - centerY;
        const segments = node.level === 1 ? 12 : node.level === 2 ? 16 : 20;
        for (let i = 0; i < segments; i += 1) {
          const phase = ((tick * 0.008 + i / segments) % 1);
          const wobble = Math.sin(tick * 0.018 + i) * 4;
          const px = centerX + dx * phase + Math.cos(phase * Math.PI * 2) * wobble;
          const py = centerY + dy * phase + Math.sin(phase * Math.PI * 2) * wobble * 0.5;
          const alpha = (1 - Math.abs(phase - 0.66)) * 0.12 + 0.04;
          context.fillStyle = `rgba(125, 211, 252, ${Math.max(0.025, alpha)})`;
          context.beginPath();
          context.arc(px, py, 0.7 + node.depth * 1.2, 0, Math.PI * 2);
          context.fill();
        }

        const nodeGlow = context.createRadialGradient(x, y, 0, x, y, 46 + node.depth * 28);
        nodeGlow.addColorStop(0, "rgba(165, 243, 252, 0.26)");
        nodeGlow.addColorStop(0.32, "rgba(34, 211, 238, 0.08)");
        nodeGlow.addColorStop(1, "rgba(34, 211, 238, 0)");
        context.fillStyle = nodeGlow;
        context.beginPath();
        context.arc(x, y, 50 + node.depth * 22, 0, Math.PI * 2);
        context.fill();
      }

      for (const p of ambientParticles) {
        context.fillStyle = `hsla(${p.hue}, 92%, 72%, ${p.alpha})`;
        context.beginPath();
        context.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        context.fill();
      }

      const core = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, 112);
      core.addColorStop(0, "rgba(236, 254, 255, 0.18)");
      core.addColorStop(0.24, "rgba(103, 232, 249, 0.14)");
      core.addColorStop(0.58, "rgba(34, 211, 238, 0.05)");
      core.addColorStop(1, "rgba(34, 211, 238, 0)");
      context.fillStyle = core;
      context.beginPath();
      context.arc(centerX, centerY, 112, 0, Math.PI * 2);
      context.fill();

      raf = requestAnimationFrame(draw);
    }

    resize();
    raf = requestAnimationFrame(draw);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(surface);
    const intersectionObserver = new IntersectionObserver((entries) => {
      visible =
        document.visibilityState === "visible" &&
        Boolean(entries[0]?.isIntersecting);
    });
    intersectionObserver.observe(surface);
    function onVisibilityChange() {
      visible =
        document.visibilityState === "visible" &&
        surface.getBoundingClientRect().bottom > 0 &&
        surface.getBoundingClientRect().top < window.innerHeight;
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pointerRef]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}

function CenterCore({ subject }: { subject: CommunityOrbitSubject }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
      aria-label={subject.label}
    >
      {subject.avatarUrl ? (
        <div className="h-14 w-14 overflow-hidden rounded-full border border-cyan-100/20 bg-slate-950/35 opacity-80 shadow-[0_0_36px_rgba(103,232,249,0.22)] sm:h-16 sm:w-16">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={subject.avatarUrl}
            alt={subject.label}
            className="h-full w-full object-cover opacity-80 mix-blend-screen"
          />
        </div>
      ) : null}
    </div>
  );
}

function RecommendationParticle({
  entry,
  index,
}: {
  entry: CommunityWaterfallEntry;
  index: number;
}) {
  const node = nodePosition(index);
  const style = tierStyle(entry.tier);
  const score = Math.round(entry.final_score);
  const size = 40 + node.depth * 22;
  const nodeStyle: CSSProperties = {
    left: `${node.xPct}%`,
    top: `${node.yPct}%`,
    width: size,
    height: size,
    transform: "translate(-50%, -50%)",
    filter: `drop-shadow(0 0 ${14 + node.depth * 18}px ${style.glow})`,
  };

  return (
    <Link
      href={`/u/${entry.login}`}
      className="group absolute z-30 rounded-full outline-none"
      style={nodeStyle}
      aria-label={`@${entry.login}`}
    >
      <span className="absolute inset-[-45%] rounded-full bg-cyan-300/10 opacity-0 blur-xl transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
      <span
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/15 bg-slate-950/80 ring-2 ${style.ring} transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110`}
      >
        {entry.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.avatar_url}
            alt={entry.login}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-base font-black text-zinc-100">
            {initial(entry.login)}
          </span>
        )}
      </span>
      <span className="absolute left-1/2 top-full z-40 mt-3 hidden w-44 -translate-x-1/2 rounded-xl border border-white/10 bg-popover/95 p-2 text-left text-xs shadow-2xl backdrop-blur group-hover:block group-focus-visible:block">
        <span className={`block font-bold ${style.text}`}>@{entry.login}</span>
        <span className="mt-1 block text-zinc-400">{score} · {entry.tier}</span>
        {entry.matched_facets.length > 0 ? (
          <span className="mt-2 flex flex-wrap gap-1">
            {entry.matched_facets.slice(0, 3).map((facet) => (
              <span
                key={facet}
                className="rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200"
              >
                {facet}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function CommunityOrbitRadar({
  subject,
  entries,
}: CommunityOrbitRadarProps) {
  const pointerRef = useRef<Pointer>({ x: 0, y: 0, active: false });
  const visualNodes = useMemo(
    () => entries.slice(0, NODE_SLOTS.length).map((_, index) => nodePosition(index)),
    [entries],
  );

  return (
    <div
      className="relative mx-auto mt-6 aspect-square w-full max-w-[34rem] overflow-visible rounded-2xl border border-cyan-300/15 bg-[#020617] shadow-[inset_0_0_90px_rgba(8,145,178,0.12)]"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        pointerRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          active: true,
        };
      }}
      onPointerLeave={() => {
        pointerRef.current.active = false;
      }}
    >
      <ParticleField pointerRef={pointerRef} nodes={visualNodes} />
      <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_50%_50%,transparent_0,transparent_32%,rgba(2,6,23,0.24)_68%,rgba(2,6,23,0.72)_100%)]" />
      <CenterCore subject={subject} />
      {entries.slice(0, NODE_SLOTS.length).map((entry, index) => (
        <RecommendationParticle key={entry.login} entry={entry} index={index} />
      ))}
    </div>
  );
}
