"use client";

import { useState, useCallback } from "react";
import { useRouter } from "@/i18n/navigation";
import { Search, X } from "lucide-react";
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
  count: number;
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
  dailyTitle: string;
  backToAll: string;
  filterPlaceholder: string;
  filterNoResults: string;
  filterClear: string;
  tooltipBand: string;
  tooltipGrowth: string;
  tooltipCommits: string;
  tooltipMergedPrs: string;
  tooltipImpact: string;
  tooltipScan: string;
  tooltipRepo: string;
  tooltipLanguage: string;
  listLabel: string;
  clusterTitle: string;
  close: string;
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

function normalizeUserKey(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function pointMatchesTerm(point: TimelinePoint, term: string): boolean {
  const q = normalizeUserKey(term);
  if (!q) return true;
  return (
    point.username.toLowerCase().includes(q) ||
    (point.display_name?.toLowerCase().includes(q) ?? false)
  );
}

function findPointForTerm(points: TimelinePoint[], term: string): TimelinePoint | null {
  const q = normalizeUserKey(term);
  if (!q) return null;
  return (
    points.find((p) => p.username.toLowerCase() === q) ??
    points.find((p) => pointMatchesTerm(p, q)) ??
    null
  );
}

export function GrowthTimelineChart({
  points,
  labels,
  windowDays = 30,
  updatedAt,
  selectedUsernames: controlledSelectedUsernames,
  onSelectedUsernamesChange,
}: {
  points: TimelinePoint[];
  labels: TimelineLabels;
  windowDays?: number;
  /** Server "now" (ms epoch). Deterministic — avoids Date.now() in render. */
  updatedAt?: number;
  selectedUsernames?: string[];
  onSelectedUsernamesChange?: (usernames: string[]) => void;
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<TimelinePoint | null>(
    null,
  );
  const [filterInput, setFilterInput] = useState("");
  const [internalSelectedUsernames, setInternalSelectedUsernames] = useState<string[]>([]);
  const [columnDialog, setColumnDialog] = useState<TimelinePoint[] | null>(
    null,
  );
  const selectedUsernames = controlledSelectedUsernames ?? internalSelectedUsernames;
  const setSelectedUsernames = useCallback(
    (next: string[] | ((current: string[]) => string[])) => {
      const resolved =
        typeof next === "function"
          ? next(selectedUsernames)
          : next;
      if (onSelectedUsernamesChange) {
        onSelectedUsernamesChange(resolved);
      } else {
        setInternalSelectedUsernames(resolved);
      }
    },
    [onSelectedUsernamesChange, selectedUsernames],
  );

  const showTooltip = useCallback(
    (cx: number, cy: number, pts: TimelinePoint[]) =>
      setTooltip({ cx, cy, points: pts }),
    [],
  );
  const hideTooltip = useCallback(() => setTooltip(null), []);

  const addFilterTerms = useCallback(
    (rawTerms: string[]) => {
      const matches = rawTerms
        .map((term) => findPointForTerm(points, term))
        .filter((point): point is TimelinePoint => point !== null);
      if (matches.length === 0) return;
      setSelectedUsernames((current) => {
        const seen = new Set(current.map((username) => username.toLowerCase()));
        const next = [...current];
        for (const point of matches) {
          const key = point.username.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(point.username);
        }
        return next;
      });
      setFilterInput("");
      setSelectedPoint(null);
      hideTooltip();
    },
    [hideTooltip, points, setSelectedUsernames],
  );

  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-zinc-500">
        {labels.timelineEmpty}
      </p>
    );
  }

  if (selectedPoint) {
    return (
      <DailyContributionChart
        point={selectedPoint}
        labels={labels}
        windowDays={windowDays}
        updatedAt={updatedAt}
        onBack={() => setSelectedPoint(null)}
      />
    );
  }

  const selectedSet = new Set(
    selectedUsernames.map((username) => username.toLowerCase()),
  );
  const query = filterInput.trim();
  const visiblePoints =
    selectedUsernames.length > 0
      ? points.filter((p) => selectedSet.has(p.username.toLowerCase()))
      : query
        ? points.filter((p) => pointMatchesTerm(p, query))
        : points;
  const selectedFilterPoints = selectedUsernames
    .map((username) =>
      points.find((p) => p.username.toLowerCase() === username.toLowerCase()),
    )
    .filter((point): point is TimelinePoint => point !== undefined);

  const filterControls = (
    <div className="mb-3 flex flex-col gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          addFilterTerms(filterInput.split(","));
        }}
        className="relative max-w-xl"
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]"
          aria-hidden="true"
        />
        <input
          value={filterInput}
          onChange={(event) => {
            const value = event.target.value;
            if (!value.includes(",")) {
              setFilterInput(value);
              return;
            }
            const parts = value.split(",");
            const complete = parts.slice(0, -1);
            addFilterTerms(complete);
            setFilterInput(parts.at(-1) ?? "");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addFilterTerms(filterInput.split(","));
          }}
          placeholder={labels.filterPlaceholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-10 w-full rounded-full border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]"
        />
      </form>
      {selectedFilterPoints.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedFilterPoints.map((point) => (
            <span
              key={point.username}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] py-1 pl-1 pr-2 text-xs font-semibold text-[var(--foreground)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={point.avatar_url ?? `https://github.com/${point.username}.png`}
                alt=""
                width={20}
                height={20}
                className="size-5 rounded-full object-cover"
              />
              <span className="max-w-32 truncate">@{point.username}</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedUsernames((current) =>
                    current.filter(
                      (username) =>
                        username.toLowerCase() !== point.username.toLowerCase(),
                    ),
                  );
                  hideTooltip();
                }}
                className="rounded-full p-0.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                aria-label={`${labels.filterClear} @${point.username}`}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  if (visiblePoints.length === 0) {
    return (
      <div className="relative w-full">
        <p className="mb-2 text-xs text-zinc-500">{labels.timelineTitle}</p>
        {filterControls}
        <p className="py-10 text-center text-sm text-zinc-500">
          {labels.filterNoResults}
        </p>
      </div>
    );
  }

  const dataTimes = visiblePoints.flatMap((p) => [
    p.snapshot_at,
    ...p.steps.map((s) => s.t),
  ]);
  const dataMinDay = startOfDayTs(Math.min(...dataTimes));
  const dataMaxDay = startOfDayTs(Math.max(...dataTimes));
  const dataSpan = Math.max(1, dataMaxDay - dataMinDay);
  const hasTrajectory = visiblePoints.some((p) => {
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

  type NodeSpec = {
    point: TimelinePoint;
    cx: number;
    cy: number;
  };
  type ColumnSpec = {
    key: string;
    cx: number;
    points: TimelinePoint[];
  };

  // Bucket endpoints by (day column, rounded score) so each date reads as one
  // vertical stack. This matches the product model: X = day, Y = score.
  const buckets = new Map<string, TimelinePoint[]>();
  for (const p of visiblePoints) {
    const bx = startOfDayTs(p.snapshot_at);
    const bs = Math.round(p.final_score / 4);
    const key = `${bx}:${bs}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }

  const nodes: NodeSpec[] = [];
  for (const grp of buckets.values()) {
    const sorted = [...grp].sort((a, b) => b.growth_score - a.growth_score);

    sorted.forEach((p, i) => {
      const offsetY = (i - (sorted.length - 1) / 2) * (AVATAR_R * 1.25);
      nodes.push({
        point: p,
        cx: xForTime(p.snapshot_at),
        cy: yForScore(p.final_score) + offsetY,
      });
    });
  }

  const dayColumns = new Map<number, TimelinePoint[]>();
  for (const p of visiblePoints) {
    const day = startOfDayTs(p.snapshot_at);
    const arr = dayColumns.get(day) ?? [];
    arr.push(p);
    dayColumns.set(day, arr);
  }
  const columns: ColumnSpec[] = [...dayColumns.entries()]
    .map(([day, pts]) => ({
      key: String(day),
      cx: xForTime(day),
      points: [...pts].sort(
        (a, b) => b.final_score - a.final_score || b.growth_score - a.growth_score,
      ),
    }))
    .filter((column) => column.points.length > 1);
  const renderNodes = focusedNode
    ? [
        ...nodes.filter((node) => node.point.username !== focusedNode),
        ...nodes.filter((node) => node.point.username === focusedNode),
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
      {filterControls}
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full min-w-[520px]"
        aria-label={labels.timelineTitle}
        role="img"
        onMouseLeave={hideTooltip}
      >
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
                stroke="var(--border-soft)"
                opacity={0.7}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--muted-foreground)"
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
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={PAD.top + PLOT_H + 16}
                textAnchor="middle"
                fontSize={10}
                fill="var(--muted-foreground)"
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
          stroke="var(--border)"
          strokeWidth={1}
        />

        {/* Nodes: every developer is rendered once, at the latest contribution day. */}
        {renderNodes.map((n) => {
          const p = n.point;
          const avatarSrc =
            p.avatar_url ?? `https://github.com/${p.username}.png`;
          const isFocused = focusedNode === p.username;

          return (
            <foreignObject
              key={p.username}
              x={n.cx - MIN_HIT / 2}
              y={n.cy - MIN_HIT / 2}
              width={MIN_HIT}
              height={MIN_HIT}
              style={{ overflow: "visible" }}
            >
              <button
                type="button"
                aria-label={`${p.display_name ?? p.username} — ${p.band} ${p.final_score}`}
                onClick={() => {
                  hideTooltip();
                  setFocusedNode(null);
                  setSelectedPoint(p);
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
                className={`relative flex size-9 items-center justify-center rounded-full border bg-zinc-800 text-xs font-bold text-zinc-300 shadow-lg transition-transform ${
                  isFocused
                    ? "scale-110 border-white/60 ring-2 ring-white/35"
                    : "border-white/20"
                }`}
              >
                <span>{p.username.slice(0, 1).toUpperCase()}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarSrc}
                  alt=""
                  width={AVATAR_R * 2}
                  height={AVATAR_R * 2}
                  className="absolute inset-0 m-auto size-8 rounded-full object-cover"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              </button>
            </foreignObject>
          );
        })}

        {columns.map((column) => (
          <foreignObject
            key={`column-${column.key}`}
            x={column.cx - 14}
            y={0}
            width={28}
            height={34}
            style={{ overflow: "visible" }}
          >
            <button
              type="button"
              onClick={() => setColumnDialog(column.points)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card pb-1 text-[10px] font-black text-card-foreground shadow-lg transition-colors [clip-path:polygon(50%_100%,36%_78%,20%_74%,8%_60%,8%_36%,20%_16%,38%_6%,62%_6%,80%_16%,92%_36%,92%_60%,80%_74%,64%_78%)] hover:bg-accent"
              aria-label={`${labels.listLabel} ${column.points.length}`}
            >
              <span className="tabular-nums">{column.points.length}</span>
            </button>
          </foreignObject>
        ))}

        {/* Tooltip rendered inside the SVG (foreignObject) — scales with the
            viewBox and needs no ref/getBoundingClientRect during render. */}
        {tooltip && tooltip.points.length > 0 && (
          <TooltipForeign tooltip={tooltip} labels={labels} />
        )}
      </svg>
      <ColumnDialog
        points={columnDialog}
        labels={labels}
        onOpenChange={(open) => {
          if (!open) setColumnDialog(null);
        }}
      />
    </div>
  );
}

function DailyContributionChart({
  point,
  labels,
  windowDays,
  updatedAt,
  onBack,
}: {
  point: TimelinePoint;
  labels: TimelineLabels;
  windowDays: number;
  updatedAt?: number;
  onBack: () => void;
}) {
  const avatarSrc = point.avatar_url ?? `https://github.com/${point.username}.png`;
  const nowTs = startOfDayTs(updatedAt ?? point.snapshot_at);
  const axisStart = startOfDayTs(nowTs - windowDays * DAY_MS);
  const axisEnd = nowTs;
  const span = Math.max(1, axisEnd - axisStart);
  const countByDay = new Map(
    point.steps.map((step) => [
      startOfDayTs(step.t),
      Math.max(0, Math.floor(step.count || 0)),
    ]),
  );
  const series = Array.from({ length: windowDays + 1 }, (_, i) => {
    const t = axisStart + i * DAY_MS;
    return { t, count: countByDay.get(t) ?? 0 };
  });
  const maxCount = Math.max(1, ...series.map((item) => item.count));
  const yMax = Math.max(4, Math.ceil(maxCount / 4) * 4);
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((yMax / 4) * i));
  const xForTime = (t: number) =>
    PAD.left + ((Math.min(axisEnd, Math.max(axisStart, t)) - axisStart) / span) * PLOT_W;
  const yForCount = (count: number) =>
    PAD.top + (1 - Math.min(yMax, Math.max(0, count)) / yMax) * PLOT_H;
  const path = series
    .map((item, i) => `${i === 0 ? "M" : "L"} ${xForTime(item.t).toFixed(2)} ${yForCount(item.count).toFixed(2)}`)
    .join(" ");
  const xTicks = Array.from({ length: 7 }, (_, i) =>
    axisStart + Math.round((span / 6) * i / DAY_MS) * DAY_MS,
  ).filter((ts, i, arr) => i === 0 || ts !== arr[i - 1]);

  return (
    <div className="relative w-full overflow-x-auto">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarSrc}
            alt=""
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[var(--foreground)]">
              {labels.dailyTitle.replace("{name}", point.display_name ?? point.username)}
            </p>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              @{point.username} · {point.band} · +{Math.round(point.contribution_count)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
        >
          {labels.backToAll}
        </button>
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full min-w-[520px]"
        aria-label={labels.dailyTitle.replace("{name}", point.display_name ?? point.username)}
        role="img"
      >
        {yTicks.map((tick) => {
          const y = yForCount(tick);
          return (
            <g key={`count-${tick}`}>
              <line
                x1={PAD.left}
                y1={y}
                x2={PAD.left + PLOT_W}
                y2={y}
                stroke="var(--border-soft)"
                opacity={0.7}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--muted-foreground)"
                className="tabular-nums"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {xTicks.map((ts) => {
          const x = xForTime(ts);
          return (
            <g key={`daily-x-${ts}`}>
              <line
                x1={x}
                y1={PAD.top + PLOT_H}
                x2={x}
                y2={PAD.top + PLOT_H + 4}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={PAD.top + PLOT_H + 16}
                textAnchor="middle"
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {formatDate(ts)}
              </text>
            </g>
          );
        })}

        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <path
          d={path}
          fill="none"
          stroke="var(--primary)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
        />
        {series.map((item) => {
          const active = item.count > 0;
          return (
            <g key={`daily-point-${item.t}`}>
              <circle
                cx={xForTime(item.t)}
                cy={yForCount(item.count)}
                r={active ? 4.5 : 2.4}
                fill={active ? "var(--primary)" : "var(--muted-foreground)"}
                opacity={active ? 0.95 : 0.25}
              >
                <title>{`${formatDate(item.t)} · ${item.count}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ColumnDialog({
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
    (a, b) => b.growth_score - a.growth_score || b.final_score - a.final_score,
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
                  +{Math.round(p.contribution_count)}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {labels.tooltipCommits}
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
