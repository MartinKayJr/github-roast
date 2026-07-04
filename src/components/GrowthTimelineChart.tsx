"use client";

import { useState, useCallback, useId } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface TrajectoryStep {
  t: number;
  score: number;
}

export interface TimelinePoint {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  band: string;
  final_score: number;
  growth_score: number;
  contribution_delta: number;
  merged_pr_delta: number;
  impact_commit_delta: number;
  snapshot_at: number;
  contribution_count: number;
  primary_language: string | null;
  primary_repo: string | null;
  steps: TrajectoryStep[];
}

export interface TimelineLabels {
  timelineTitle: string;
  timelineEmpty: string;
  tooltipBand: string;
  tooltipGrowth: string;
  tooltipCommits: string;
  tooltipMergedPrs: string;
  tooltipImpact: string;
  tooltipScan: string;
  tooltipRepo: string;
  tooltipLanguage: string;
  clusterTitle: string;
  close: string;
  overflowMore: string;
}

interface TooltipState {
  cx: number;
  cy: number;
  points: TimelinePoint[];
}

const AVATAR_R = 16;
const MIN_HIT = 36;
const PAD = { top: 20, right: 40, bottom: 44, left: 44 };
const CHART_W = 900;
const CHART_H = 360;
const PLOT_W = CHART_W - PAD.left - PAD.right;
const PLOT_H = CHART_H - PAD.top - PAD.bottom;
const SCORE_TICKS = [0, 20, 40, 60, 80, 100];
const TOOLTIP_W = 210;
const TOOLTIP_H = 158;
const DAY_MS = 86_400_000;
const SCORE_EDGE_PAD = AVATAR_R + 8;

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function startOfDayTs(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Ring/text tailwind class → a concrete stroke color for SVG polylines. */
function bandStroke(band: string): string {
  switch (band) {
    case "S+":
      return "rgba(252,211,77,0.55)";
    case "S":
      return "rgba(253,224,71,0.5)";
    case "A+":
      return "rgba(196,181,253,0.5)";
    case "A":
      return "rgba(165,180,252,0.5)";
    case "B+":
      return "rgba(110,231,183,0.5)";
    case "B":
      return "rgba(94,234,212,0.5)";
    case "C+":
      return "rgba(125,211,252,0.45)";
    default:
      return "rgba(203,213,225,0.4)";
  }
}

export function GrowthTimelineChart({
  points,
  labels,
  windowDays = 30,
  updatedAt,
}: {
  points: TimelinePoint[];
  labels: TimelineLabels;
  windowDays?: number;
  /** Server "now" (ms epoch). Deterministic — avoids Date.now() in render. */
  updatedAt?: number;
}) {
  const uid = useId();
  const router = useRouter();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [clusterDialog, setClusterDialog] = useState<TimelinePoint[] | null>(null);

  const showTooltip = useCallback(
    (cx: number, cy: number, pts: TimelinePoint[]) =>
      setTooltip({ cx, cy, points: pts }),
    [],
  );
  const hideTooltip = useCallback(() => setTooltip(null), []);

  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-zinc-500">
        {labels.timelineEmpty}
      </p>
    );
  }

  const dataTimes = points.flatMap((p) => [
    p.snapshot_at,
    ...p.steps.map((s) => s.t),
  ]);
  const dataMinDay = startOfDayTs(Math.min(...dataTimes));
  const dataMaxDay = startOfDayTs(Math.max(...dataTimes));
  const dataSpan = Math.max(1, dataMaxDay - dataMinDay);
  const hasTrajectory = points.some((p) => {
    const first = p.steps[0];
    const last = p.steps[p.steps.length - 1];
    return first && last && Math.abs(last.t - first.t) >= DAY_MS;
  });
  const windowMs = windowDays * DAY_MS;

  // With fresh local data most users only have one or two same-day snapshots.
  // A fixed 30-day axis makes the chart mathematically correct but visually
  // useless: every avatar piles up on the right edge. Until there is enough
  // history to draw real trajectories, expand the actual data extent instead.
  const useDataExtent = !hasTrajectory && dataSpan < Math.min(windowMs, 3 * DAY_MS);
  const nowTs = updatedAt ?? dataMaxDay;
  const axisStart = useDataExtent
    ? Math.max(0, dataMinDay - DAY_MS)
    : startOfDayTs(nowTs - windowMs);
  const axisEnd = useDataExtent
    ? dataMaxDay + DAY_MS
    : startOfDayTs(nowTs);
  const span = Math.max(1, axisEnd - axisStart);

  const xForTime = (t: number) => {
    const day = startOfDayTs(t);
    const clamped = Math.min(axisEnd, Math.max(axisStart, day));
    return PAD.left + ((clamped - axisStart) / span) * PLOT_W;
  };
  const yForScore = (score: number) =>
    PAD.top +
    SCORE_EDGE_PAD +
    (1 - Math.min(100, Math.max(0, score)) / 100) *
      (PLOT_H - SCORE_EDGE_PAD * 2);

  // Endpoint (avatar) coordinates + collision buckets.
  type NodeSpec =
    | {
        kind: "avatar";
        point: TimelinePoint;
        cx: number;
        cy: number;
        cluster: TimelinePoint[];
      }
    | { kind: "overflow"; cx: number; cy: number; n: number; pts: TimelinePoint[] };

  // Bucket endpoints by (day column, rounded score) so each date reads as one
  // vertical stack. This matches the product model: X = day, Y = score.
  const buckets = new Map<string, TimelinePoint[]>();
  for (const p of points) {
    const bx = startOfDayTs(p.snapshot_at);
    const bs = Math.round(p.final_score / 4);
    const key = `${bx}:${bs}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }

  const MAX_VISIBLE = 4;
  const nodes: NodeSpec[] = [];
  for (const grp of buckets.values()) {
    const sorted = [...grp].sort((a, b) => b.growth_score - a.growth_score);
    const baseX = xForTime(sorted[0].snapshot_at);
    const baseY = yForScore(sorted[0].final_score);
    const visible = sorted.slice(0, MAX_VISIBLE);
    const overflow = sorted.length - MAX_VISIBLE;

    visible.forEach((p, i) => {
      const offsetY = (i - (visible.length - 1) / 2) * (AVATAR_R * 1.25);
      nodes.push({
        kind: "avatar",
        point: p,
        cx: xForTime(p.snapshot_at),
        cy: yForScore(p.final_score) + offsetY,
        cluster: sorted,
      });
    });
    if (overflow > 0) {
      const offsetY =
        (visible.length - (visible.length - 1) / 2) * (AVATAR_R * 1.25);
      nodes.push({
        kind: "overflow",
        cx: baseX,
        cy: baseY + offsetY,
        n: overflow,
        pts: sorted,
      });
    }
  }
  const renderNodes = focusedNode
    ? [
        ...nodes.filter(
          (node) =>
            node.kind !== "avatar" || node.point.username !== focusedNode,
        ),
        ...nodes.filter(
          (node) =>
            node.kind === "avatar" && node.point.username === focusedNode,
        ),
      ]
    : nodes;

  // X-axis day ticks. Full-history mode shows ~6 ticks across the selected
  // window; sparse mode keeps daily ticks so fresh data does not look broken.
  const xTicks: number[] = [];
  const axisDays = Math.max(1, Math.ceil(span / DAY_MS));
  const tickStep = useDataExtent ? 1 : Math.max(1, Math.round(windowDays / 6));
  for (let d = 0; d <= axisDays; d += tickStep) {
    xTicks.push(axisStart + d * DAY_MS);
  }
  if (xTicks[xTicks.length - 1] < axisEnd) xTicks.push(axisEnd);

  return (
    <div className="relative w-full overflow-x-auto">
      <p className="mb-2 text-xs text-zinc-500">{labels.timelineTitle}</p>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full min-w-[520px]"
        aria-label={labels.timelineTitle}
        role="img"
        onMouseLeave={hideTooltip}
      >
        <defs>
          {nodes.map((n) => {
            if (n.kind !== "avatar") return null;
            const id = `${uid}-clip-${n.point.username}`;
            return (
              <clipPath key={id} id={id}>
                <circle cx={n.cx} cy={n.cy} r={AVATAR_R} />
              </clipPath>
            );
          })}
        </defs>

        {/* Y-axis numeric score ticks + horizontal gridlines */}
        {SCORE_TICKS.map((score) => {
          const y = yForScore(score);
          return (
            <g key={`score-${score}`}>
              <line
                x1={PAD.left}
                y1={y}
                x2={PAD.left + PLOT_W}
                y2={y}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="rgba(255,255,255,0.4)"
                className="tabular-nums"
              >
                {score}
              </text>
            </g>
          );
        })}

        {/* X-axis ticks + labels */}
        {xTicks.map((ts) => {
          const x = xForTime(ts);
          return (
            <g key={`x-${ts}`}>
              <line
                x1={x}
                y1={PAD.top + PLOT_H}
                x2={x}
                y2={PAD.top + PLOT_H + 4}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={PAD.top + PLOT_H + 16}
                textAnchor="middle"
                fontSize={10}
                fill="rgba(255,255,255,0.35)"
              >
                {formatDate(ts)}
              </text>
            </g>
          );
        })}

        {/* X-axis baseline */}
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1}
        />

        {/* Trajectory polylines (one per user, drawn behind avatars) */}
        {points.map((p) => {
          if (p.steps.length < 2) return null;
          const pts = p.steps
            .map((s) => `${xForTime(s.t)},${yForScore(s.score)}`)
            .join(" ");
          const dimmed = focusedNode !== null && focusedNode !== p.username;
          return (
            <polyline
              key={`line-${p.username}`}
              points={pts}
              fill="none"
              stroke={bandStroke(p.band)}
              strokeWidth={focusedNode === p.username ? 2.5 : 1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={dimmed ? 0.15 : 1}
            />
          );
        })}

        {/* Nodes: avatars + overflow bubbles */}
        {renderNodes.map((n, i) => {
          if (n.kind === "overflow") {
            return (
              <g
                key={`overflow-${i}`}
                tabIndex={0}
                role="button"
                aria-label={labels.overflowMore.replace("{n}", String(n.n))}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => showTooltip(n.cx, n.cy, n.pts)}
                onFocus={() => showTooltip(n.cx, n.cy, n.pts)}
                onBlur={hideTooltip}
                onClick={() => setClusterDialog(n.pts)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setClusterDialog(n.pts);
                  }
                }}
              >
                <circle cx={n.cx} cy={n.cy} r={MIN_HIT / 2} fill="transparent" />
                <circle
                  cx={n.cx}
                  cy={n.cy}
                  r={AVATAR_R}
                  fill="rgba(255,255,255,0.08)"
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth={1.5}
                />
                <text
                  x={n.cx}
                  y={n.cy + 3}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight="bold"
                  fill="rgba(255,255,255,0.6)"
                >
                  {n.pts.length}
                </text>
              </g>
            );
          }

          const p = n.point;
          const clipId = `${uid}-clip-${p.username}`;
          const avatarSrc =
            p.avatar_url ?? `https://github.com/${p.username}.png`;
          const isFocused = focusedNode === p.username;
          const isClustered = n.cluster.length > 1;

          return (
            <g
              key={p.username}
              tabIndex={0}
              role="button"
              aria-label={`${p.display_name ?? p.username} — ${p.band} ${p.final_score}`}
              style={{ cursor: "pointer" }}
              onClick={() => {
                if (isClustered) {
                  setClusterDialog(n.cluster);
                  return;
                }
                router.push(`/u/${p.username}`);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (isClustered) {
                    setClusterDialog(n.cluster);
                    return;
                  }
                  router.push(`/u/${p.username}`);
                }
              }}
              onMouseEnter={() => {
                setFocusedNode(p.username);
                showTooltip(n.cx, n.cy, [p]);
              }}
              onMouseLeave={() => {
                setFocusedNode(null);
                hideTooltip();
              }}
              onFocus={() => {
                setFocusedNode(p.username);
                showTooltip(n.cx, n.cy, [p]);
              }}
              onBlur={() => {
                setFocusedNode(null);
                hideTooltip();
              }}
            >
              <circle cx={n.cx} cy={n.cy} r={MIN_HIT / 2} fill="transparent" />
              {isFocused && (
                <circle
                  cx={n.cx}
                  cy={n.cy}
                  r={AVATAR_R + 3}
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth={2}
                />
              )}
              <image
                href={avatarSrc}
                x={n.cx - AVATAR_R}
                y={n.cy - AVATAR_R}
                width={AVATAR_R * 2}
                height={AVATAR_R * 2}
                clipPath={`url(#${clipId})`}
                preserveAspectRatio="xMidYMid slice"
              />
              <circle
                cx={n.cx}
                cy={n.cy}
                r={AVATAR_R}
                fill="none"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={1.5}
              />
            </g>
          );
        })}

        {/* Tooltip rendered inside the SVG (foreignObject) — scales with the
            viewBox and needs no ref/getBoundingClientRect during render. */}
        {tooltip && tooltip.points.length > 0 && (
          <TooltipForeign tooltip={tooltip} labels={labels} />
        )}
      </svg>
      <ClusterDialog
        points={clusterDialog}
        labels={labels}
        onOpenChange={(open) => {
          if (!open) setClusterDialog(null);
        }}
      />
    </div>
  );
}

function ClusterDialog({
  points,
  labels,
  onOpenChange,
}: {
  points: TimelinePoint[] | null;
  labels: TimelineLabels;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const sorted = [...(points ?? [])].sort(
    (a, b) => b.final_score - a.final_score || b.growth_score - a.growth_score,
  );

  return (
    <Dialog open={points !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <DialogTitle className="text-base text-zinc-100">
            {labels.clusterTitle.replace("{count}", String(sorted.length))}
          </DialogTitle>
          <DialogDescription>
            {sorted[0] ? formatDate(sorted[0].snapshot_at) : labels.timelineTitle}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-3 py-2">
          {sorted.map((p) => (
            <button
              key={p.username}
              type="button"
              onClick={() => router.push(`/u/${p.username}`)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.avatar_url ?? `https://github.com/${p.username}.png`}
                alt=""
                width={36}
                height={36}
                className="size-9 shrink-0 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold text-zinc-100">
                    {p.display_name ?? p.username}
                  </span>
                  <span className="shrink-0 rounded-full bg-white/5 px-1.5 py-px text-[10px] font-bold text-zinc-300">
                    {p.band}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-zinc-500">
                  @{p.username}
                  {p.primary_repo ? ` · ${p.primary_repo}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-black text-zinc-100 tabular-nums">
                  {Math.round(p.final_score)}
                </div>
                <div className="text-[10px] text-emerald-400 tabular-nums">
                  +{p.growth_score.toFixed(1)}
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="border-t border-white/10 px-5 py-3 text-right">
          <DialogClose className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/10">
            {labels.close}
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TooltipForeign({
  tooltip,
  labels,
}: {
  tooltip: TooltipState;
  labels: TimelineLabels;
}) {
  // Flip horizontally near the right edge; clamp vertically inside the plot.
  const flipX = tooltip.cx > PAD.left + PLOT_W * 0.55;
  const fx = flipX ? tooltip.cx - TOOLTIP_W - 12 : tooltip.cx + 12;
  const x = Math.max(2, Math.min(fx, CHART_W - TOOLTIP_W - 2));
  const y = Math.max(2, Math.min(tooltip.cy - 8, CHART_H - TOOLTIP_H - 2));

  return (
    <foreignObject
      x={x}
      y={y}
      width={TOOLTIP_W}
      height={TOOLTIP_H}
      style={{ pointerEvents: "none", overflow: "visible" }}
    >
      <div className="rounded-xl border border-white/10 bg-zinc-900/95 p-3 text-xs shadow-2xl">
        {tooltip.points.slice(0, 3).map((p) => (
          <div key={p.username} className="mb-2 last:mb-0">
            <div className="mb-1 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.avatar_url ?? `https://github.com/${p.username}.png`}
                alt=""
                width={26}
                height={26}
                className="size-[26px] shrink-0 rounded-full"
              />
              <div className="min-w-0">
                <div className="truncate font-semibold text-zinc-100">
                  {p.display_name ?? p.username}
                </div>
                <div className="truncate text-[10px] text-zinc-500">
                  @{p.username}
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
              <dt className="text-zinc-500">{labels.tooltipBand}</dt>
              <dd className="text-right font-bold text-zinc-200 tabular-nums">
                {p.band} · {Math.round(p.final_score)}
              </dd>
              <dt className="text-zinc-500">{labels.tooltipGrowth}</dt>
              <dd className="text-right font-bold text-emerald-400 tabular-nums">
                +{p.growth_score.toFixed(1)}
              </dd>
              <dt className="text-zinc-500">{labels.tooltipCommits}</dt>
              <dd className="text-right tabular-nums text-zinc-300">
                {Math.round(p.contribution_count)}
              </dd>
              {Math.round(p.contribution_delta) > 0 && (
                <>
                  <dt className="text-zinc-500">30d</dt>
                  <dd className="text-right tabular-nums text-zinc-300">
                    +{Math.round(p.contribution_delta)}
                  </dd>
                </>
              )}
              {Math.round(p.merged_pr_delta) > 0 && (
                <>
                  <dt className="text-zinc-500">{labels.tooltipMergedPrs}</dt>
                  <dd className="text-right tabular-nums text-zinc-300">
                    +{Math.round(p.merged_pr_delta)}
                  </dd>
                </>
              )}
              {Math.round(p.impact_commit_delta) > 0 && (
                <>
                  <dt className="text-zinc-500">{labels.tooltipImpact}</dt>
                  <dd className="text-right tabular-nums text-zinc-300">
                    +{Math.round(p.impact_commit_delta)}
                  </dd>
                </>
              )}
              {p.primary_language && (
                <>
                  <dt className="text-zinc-500">{labels.tooltipLanguage}</dt>
                  <dd className="truncate text-right text-zinc-300">
                    {p.primary_language}
                  </dd>
                </>
              )}
              {p.primary_repo && (
                <>
                  <dt className="text-zinc-500">{labels.tooltipRepo}</dt>
                  <dd className="truncate text-right text-zinc-300">
                    {p.primary_repo}
                  </dd>
                </>
              )}
              <dt className="text-zinc-500">{labels.tooltipScan}</dt>
              <dd className="text-right text-zinc-400">
                {formatDate(p.snapshot_at)}
              </dd>
            </dl>
          </div>
        ))}
      </div>
    </foreignObject>
  );
}
