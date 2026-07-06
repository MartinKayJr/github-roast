/**
 * Pure canvas particle engine for one domain planet card. Deliberately decoupled
 * from React: nothing here touches component state per frame — the card mounts a
 * canvas, hands it to the engine, and drives only high-level phase transitions.
 * This keeps the waterfall smooth even with several cards animating at once (the
 * waterfall itself caps how many run concurrently; see CommunityGalaxyWaterfall).
 *
 * Lifecycle: `new GalaxyParticleEngine(canvas, opts)` → `setPhase(...)` /
 * `start()` / `pause()` / `resize()` → `destroy()`. The engine owns its RAF loop
 * and releases it on pause/destroy so an offscreen card burns no CPU.
 *
 * Phases (mirrors community-galaxy-waterfall-todo.md):
 *   forming  — dust converges from the edges into the core planet (~700ms)
 *   orbiting — planetary rings spin up; member nodes glow as bright points
 *   revealed — steady state; nodes stay lit for the DOM avatar overlay to sit on
 *
 * `prefers-reduced-motion` collapses straight to `revealed` with far fewer
 * particles and no convergence animation.
 */

export type GalaxyPhase = "idle" | "forming" | "orbiting" | "revealed" | "paused";

export interface GalaxyMemberNode {
  /** Angle on the node ring, radians. */
  angle: number;
  /** Radius as a fraction of the min canvas side. */
  radius: number;
  /** Elliptical y-axis scale for a less regular orbit. */
  yScale?: number;
  /** Radial glow color (CSS rgba), from the member's tier. */
  glow: string;
}

export interface GalaxyEngineOptions {
  /** Desktop-ish particle budget; halved on coarse pointers / small cards. */
  particleCount: number;
  /** Member node positions — the bright points the DOM avatars overlay. */
  nodes: GalaxyMemberNode[];
  /** Base hue for the planet + dust (per-card variety). */
  hue: number;
  reduceMotion: boolean;
}

interface Dust {
  /** Current position. */
  x: number;
  y: number;
  /** Target position on the planet surface (converged state). */
  tx: number;
  ty: number;
  /** Origin position (pre-convergence, off toward the edges). */
  ox: number;
  oy: number;
  r: number;
  alpha: number;
}

interface Ring {
  angle: number;
  radius: number;
  speed: number;
  r: number;
  alpha: number;
  tilt: number;
}

const FORMING_MS = 700;
const ORBITING_MS = 900;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class GalaxyParticleEngine {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private phase: GalaxyPhase = "idle";
  /** ms timestamp when the current animated phase began. */
  private phaseStart = 0;
  private tick = 0;
  private dust: Dust[] = [];
  private rings: Ring[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: GalaxyEngineOptions,
  ) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  /** Rebuild the particle field for the current canvas size. Safe to call on
   *  ResizeObserver ticks — it re-seeds dust origins/targets around the new center. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.seed();
  }

  private seed(): void {
    const { particleCount, reduceMotion } = this.opts;
    const count = reduceMotion ? Math.round(particleCount * 0.35) : particleCount;
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const minSide = Math.min(this.width, this.height);
    const planetR = minSide * 0.22;

    this.dust.length = 0;
    for (let i = 0; i < count; i += 1) {
      // Target: a point roughly on/inside the planet surface.
      const ta = Math.random() * Math.PI * 2;
      const tr = planetR * (0.35 + Math.random() * 0.75);
      const tx = cx + Math.cos(ta) * tr;
      const ty = cy + Math.sin(ta) * tr * 0.92;
      // Origin: flung out toward the card edges so convergence reads clearly.
      const oa = Math.random() * Math.PI * 2;
      const orad = minSide * (0.55 + Math.random() * 0.6);
      this.dust.push({
        x: cx + Math.cos(oa) * orad,
        y: cy + Math.sin(oa) * orad,
        ox: cx + Math.cos(oa) * orad,
        oy: cy + Math.sin(oa) * orad,
        tx,
        ty,
        r: 0.5 + Math.random() * 1.5,
        alpha: 0.15 + Math.random() * 0.4,
      });
    }

    this.rings.length = 0;
    const ringCount = reduceMotion ? 70 : Math.max(110, Math.round(count * 0.78));
    for (let i = 0; i < ringCount; i += 1) {
      const layer = i % 2;
      this.rings.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.34 + layer * 0.12 + Math.random() * 0.05,
        speed: (0.004 + Math.random() * 0.006) * (Math.random() > 0.5 ? 1 : -1),
        r: 0.5 + Math.random() * 1.3,
        alpha: layer === 0 ? 0.46 : 0.32,
        tilt: 0.28 + layer * 0.12,
      });
    }
  }

  setPhase(phase: GalaxyPhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    this.phaseStart = performance.now();
    if (this.opts.reduceMotion && (phase === "forming" || phase === "orbiting")) {
      // Skip straight to steady state — no convergence for reduced motion.
      this.phase = "revealed";
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.loop);
  }

  pause(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy(): void {
    this.pause();
    this.dust.length = 0;
    this.rings.length = 0;
  }

  /** 0→1 convergence progress across forming+orbiting; 1 once revealed. */
  private formProgress(now: number): number {
    if (this.phase === "idle" || this.phase === "paused") return 0;
    if (this.phase === "revealed") return 1;
    if (this.phase === "forming") {
      return easeOutCubic(Math.min(1, (now - this.phaseStart) / FORMING_MS));
    }
    // orbiting — forming already completed
    return 1;
  }

  /** 0→1 ring intensity: rings fade in during orbiting and stay on when revealed. */
  private ringProgress(now: number): number {
    if (this.phase === "revealed") return 1;
    if (this.phase === "orbiting") {
      return Math.min(1, (now - this.phaseStart) / ORBITING_MS);
    }
    return 0;
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    this.tick += 1;
    const { ctx } = this;
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const minSide = Math.min(this.width, this.height);
    const { hue, reduceMotion } = this.opts;

    ctx.clearRect(0, 0, this.width, this.height);

    const form = this.formProgress(now);
    const ring = this.ringProgress(now);

    // Core planet glow — grows in with convergence.
    const planetR = minSide * 0.22 * (0.6 + form * 0.4);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, planetR * 2.2);
    core.addColorStop(0, `hsla(${hue}, 90%, 82%, ${0.28 * form})`);
    core.addColorStop(0.35, `hsla(${hue}, 85%, 66%, ${0.16 * form})`);
    core.addColorStop(1, `hsla(${hue}, 80%, 50%, 0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, planetR * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Dust: lerp origin→target by convergence progress.
    for (const d of this.dust) {
      d.x = d.ox + (d.tx - d.ox) * form;
      d.y = d.oy + (d.ty - d.oy) * form;
      // Subtle drift once settled so the planet isn't frozen.
      if (!reduceMotion && form >= 1) {
        d.x += Math.sin(this.tick * 0.02 + d.tx) * 0.15;
        d.y += Math.cos(this.tick * 0.02 + d.ty) * 0.15;
      }
      ctx.fillStyle = `hsla(${hue}, 92%, 78%, ${d.alpha * (0.4 + form * 0.6)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Planetary rings — only once orbiting has begun.
    if (ring > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const p of this.rings) {
        if (!reduceMotion) p.angle += p.speed;
        const rx = p.radius * minSide;
        const ry = rx * p.tilt;
        const x = cx + Math.cos(p.angle) * rx;
        const y = cy + Math.sin(p.angle) * ry;
        const front = Math.sin(p.angle) > 0 ? 1 : 0.5;
        ctx.fillStyle = `hsla(${hue}, 90%, 80%, ${p.alpha * ring * front})`;
        ctx.beginPath();
        ctx.arc(x, y, p.r * front, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let layer = 0; layer < 2; layer += 1) {
        const rx = (0.34 + layer * 0.12) * minSide;
        const ry = rx * (0.28 + layer * 0.12);
        ctx.strokeStyle = `hsla(${hue}, 90%, 76%, ${0.08 * ring})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Member node bright points — glow in as rings settle. The DOM avatar layer
    // is positioned over these same coordinates by the card (see nodeScreenPos).
    for (const node of this.opts.nodes) {
      const rx = node.radius * minSide;
      const ry = rx * (node.yScale ?? 0.42);
      const x = cx + Math.cos(node.angle) * rx;
      const y = cy + Math.sin(node.angle) * ry;
      const glowR = 10 + ring * 8;
      const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
      g.addColorStop(0, node.glow);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.globalAlpha = ring;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    this.raf = requestAnimationFrame(this.loop);
  };

  /** Screen-space position (CSS px, canvas-relative) of a member node, so the
   *  card can absolutely-position the avatar overlay on the glowing point. */
  nodeScreenPos(node: GalaxyMemberNode): { x: number; y: number } {
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const minSide = Math.min(this.width, this.height);
    const rx = node.radius * minSide;
    const ry = rx * (node.yScale ?? 0.42);
    return {
      x: cx + Math.cos(node.angle) * rx,
      y: cy + Math.sin(node.angle) * ry,
    };
  }
}
