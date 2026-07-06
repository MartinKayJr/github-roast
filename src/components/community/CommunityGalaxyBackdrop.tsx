"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  hue: number;
  layer: number;
};

type RingParticle = {
  angle: number;
  radius: number;
  speed: number;
  r: number;
  alpha: number;
  layer: number;
};

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function CommunityGalaxyBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const surface = canvas;
    const context = ctx;
    const reduceMotion = prefersReducedMotion();
    let raf = 0;
    let width = 0;
    let height = 0;
    let visible = document.visibilityState === "visible";
    let tick = 0;
    const ambient: Particle[] = [];
    const rings: RingParticle[] = [];

    function resize() {
      const rect = surface.getBoundingClientRect();
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      surface.width = Math.floor(width * dpr);
      surface.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      ambient.length = 0;
      rings.length = 0;

      const area = width * height;
      const ambientCount = reduceMotion ? 70 : Math.max(110, Math.min(220, Math.floor(area / 5200)));
      for (let i = 0; i < ambientCount; i += 1) {
        ambient.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.08,
          vy: (Math.random() - 0.5) * 0.08,
          r: 0.45 + Math.random() * 1.4,
          alpha: 0.08 + Math.random() * 0.22,
          hue: 184 + Math.random() * 48,
          layer: 0.45 + Math.random() * 1.4,
        });
      }

      const ringCount = reduceMotion ? 90 : 220;
      for (let i = 0; i < ringCount; i += 1) {
        const layer = i % 4;
        rings.push({
          angle: Math.random() * Math.PI * 2,
          radius: 0.16 + layer * 0.105 + Math.random() * 0.055,
          speed: (0.0008 + Math.random() * 0.002) * (Math.random() > 0.45 ? 1 : -1),
          r: 0.5 + Math.random() * (layer === 0 ? 2.1 : 1.45),
          alpha: layer === 0 ? 0.34 : layer === 1 ? 0.26 : 0.18,
          layer,
        });
      }
    }

    function draw() {
      if (!visible) {
        raf = requestAnimationFrame(draw);
        return;
      }
      tick += reduceMotion ? 0.15 : 1;
      context.clearRect(0, 0, width, height);

      const centerX = width * 0.5;
      const centerY = Math.min(height * 0.36, 360);
      const longSide = Math.max(width, height);
      const minSide = Math.min(width, height);

      const bg = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, longSide * 0.78);
      bg.addColorStop(0, "rgba(34, 211, 238, 0.22)");
      bg.addColorStop(0.16, "rgba(59, 130, 246, 0.1)");
      bg.addColorStop(0.44, "rgba(14, 165, 233, 0.04)");
      bg.addColorStop(1, "rgba(2, 6, 23, 0)");
      context.fillStyle = bg;
      context.fillRect(0, 0, width, height);

      for (const p of ambient) {
        if (!reduceMotion) {
          p.x += p.vx;
          p.y += p.vy;
        }
        if (p.x < -16) p.x = width + 16;
        if (p.x > width + 16) p.x = -16;
        if (p.y < -16) p.y = height + 16;
        if (p.y > height + 16) p.y = -16;
        context.fillStyle = `hsla(${p.hue}, 92%, 74%, ${p.alpha})`;
        context.beginPath();
        context.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        context.fill();
      }

      for (const p of rings) {
        if (!reduceMotion) p.angle += p.speed;
        const rx = p.radius * minSide * 1.25;
        const ry = rx * (0.28 + p.layer * 0.075);
        const wobble = Math.sin(tick * 0.006 + p.angle * 2) * 8;
        const x = centerX + Math.cos(p.angle) * (rx + wobble);
        const y = centerY + Math.sin(p.angle) * ry + p.layer * 24;
        const front = Math.sin(p.angle) > 0 ? 1 : 0.56;
        context.fillStyle = `rgba(125, 211, 252, ${p.alpha * front})`;
        context.beginPath();
        context.arc(x, y, p.r * front, 0, Math.PI * 2);
        context.fill();
      }

      const core = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, 170);
      core.addColorStop(0, "rgba(236, 254, 255, 0.26)");
      core.addColorStop(0.18, "rgba(103, 232, 249, 0.16)");
      core.addColorStop(0.54, "rgba(34, 211, 238, 0.045)");
      core.addColorStop(1, "rgba(34, 211, 238, 0)");
      context.fillStyle = core;
      context.beginPath();
      context.arc(centerX, centerY, 180, 0, Math.PI * 2);
      context.fill();

      raf = requestAnimationFrame(draw);
    }

    function onVisibilityChange() {
      visible = document.visibilityState === "visible";
    }

    resize();
    raf = requestAnimationFrame(draw);
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
