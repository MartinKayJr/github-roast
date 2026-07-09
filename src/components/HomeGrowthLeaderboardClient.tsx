"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { Link } from "@/i18n/navigation";
import { Eye } from "lucide-react";
import { BAND_KEYS, bandStyle, type BandKey } from "@/lib/band";
import type { GrowthEntry } from "./HomeGrowthLeaderboard";
import {
  GrowthTimelineChart,
  type TimelinePoint,
} from "./GrowthTimelineChart";

type TabKey = BandKey | "all";

export interface GrowthLabels {
  heading: string;
  subtitle: string;
  bandLabel: string;
  growthLabel: string;
  growthTitle: string;
  commitsLabel: string;
  commitsTitle: string;
  mergedPrs: string;
  impactCommits: string;
  loading: string;
  loadError: string;
  empty: string;
  scanCta: string;
  bandAria: string;
  sinceLastScan: string;
  lastActive: string;
  // "全部" tab & timeline
  allTab: string;
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
  subscribeAfterLogin: string;
  subscribe: string;
  subscribed: string;
  unsubscribe: string;
  subscribeFailed: string;
  viewInTimeline: string;
  profile: string;
}

type MeResponse = {
  user: { login: string; image: string | null } | null;
  growthSubscribed?: boolean;
};

function BandTab({
  band,
  count,
  active,
  onSelect,
}: {
  band: BandKey;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  const style = bandStyle(band);
  return (
    <button
      onClick={onSelect}
      className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? `bg-white/10 ${style.text}`
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
      }`}
      aria-pressed={active}
    >
      <span>{band}</span>
      {count > 0 && (
        <span
          className={`tabular-nums text-[10px] ${active ? "opacity-80" : "opacity-50"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function GrowthCard({
  entry,
  labels,
  onView,
}: {
  entry: GrowthEntry;
  labels: GrowthLabels;
  onView: () => void;
}) {
  const style = bandStyle(entry.band);
  const avatar = entry.avatar_url ?? `https://github.com/${entry.username}.png`;
  const displayName = entry.display_name ?? entry.username;
  const recentCommits = Math.max(0, Math.round(entry.contribution_delta));
  const mergedPrs = Math.max(0, Math.round(entry.merged_pr_delta));
  const impactCommits = Math.max(0, Math.round(entry.impact_commit_delta));

  return (
    <div
      className="group flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3 transition-colors hover:border-white/10 hover:bg-white/[0.06]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatar}
        alt={displayName}
        width={40}
        height={40}
        className="size-10 shrink-0 rounded-full object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 truncate">
          <span className="truncate text-sm font-semibold text-zinc-100">
            {displayName}
          </span>
          <span
            className={`shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs font-black ring-1 ${style.ring} ${style.text}`}
          >
            {entry.band}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span className="truncate">@{entry.username}</span>
          {mergedPrs > 0 && (
            <span className="tabular-nums">PR +{mergedPrs}</span>
          )}
          {impactCommits > 0 && (
            <span className="tabular-nums">
              {labels.impactCommits} +{impactCommits}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-black text-emerald-400 tabular-nums">
          +{recentCommits}
        </div>
        <div className="text-[10px] text-zinc-500">{labels.commitsLabel}</div>
        <div className="mt-2 flex justify-end gap-1">
          <button
            type="button"
            onClick={onView}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-300/15"
          >
            <Eye className="h-3 w-3" />
            {labels.viewInTimeline}
          </button>
          <Link
            href={`/u/${entry.username}`}
            prefetch={false}
            className="inline-flex h-7 items-center rounded-full border border-white/10 px-2 text-[11px] font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-zinc-100"
          >
            {labels.profile}
          </Link>
        </div>
      </div>
    </div>
  );
}

function GrowthSubscriptionButton({ labels }: { labels: GrowthLabels }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MeResponse>;
      })
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        if (!cancelled) setMe({ user: null, growthSubscribed: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedIn = Boolean(me?.user);
  const subscribed = Boolean(me?.growthSubscribed);
  const label = subscribed
    ? labels.unsubscribe
    : signedIn
      ? labels.subscribe
      : labels.subscribeAfterLogin;

  async function onClick() {
    setError(false);
    if (!signedIn) {
      void signIn("github");
      return;
    }
    if (subscribing) return;
    setSubscribing(true);
    try {
      const res = await fetch("/api/growth-subscription", {
        method: subscribed ? "DELETE" : "POST",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        subscribed?: boolean;
      };
      setMe((prev) => ({
        user: prev?.user ?? me?.user ?? null,
        growthSubscribed: Boolean(data.subscribed),
      }));
    } catch {
      setError(true);
    } finally {
      setSubscribing(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        onClick={onClick}
        disabled={subscribing}
        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
          subscribed
            ? "border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100"
            : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:border-emerald-300/50 hover:bg-emerald-400/15"
        } disabled:cursor-wait disabled:opacity-80`}
        title={subscribed ? labels.subscribed : undefined}
      >
        {label}
      </button>
      {error && (
        <span className="text-[11px] text-red-400" role="status">
          {labels.subscribeFailed}
        </span>
      )}
    </div>
  );
}

export function HomeGrowthLeaderboardClient({
  labels,
  bandCounts,
  defaultBand,
  defaultEntries,
  allByBand,
}: {
  labels: GrowthLabels;
  bandCounts: Record<BandKey, number>;
  defaultBand: BandKey;
  defaultEntries: GrowthEntry[];
  allByBand: Record<BandKey, GrowthEntry[]>;
}) {
  const [tab, setTab] = useState<TabKey>("all");
  const [selectedTimelineUsers, setSelectedTimelineUsers] = useState<string[]>([]);

  // Timeline state (lazy-loaded when "all" tab first activated).
  // `loading` is derived, not stored, so the effect never calls setState
  // synchronously in its body (react-hooks/set-state-in-effect).
  const [timelinePoints, setTimelinePoints] = useState<TimelinePoint[] | null>(
    null,
  );
  const [timelineUpdatedAt, setTimelineUpdatedAt] = useState<number | undefined>(
    undefined,
  );
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const timelineLoading =
    tab === "all" && timelinePoints === null && timelineError === null;

  useEffect(() => {
    if (tab !== "all") return;
    if (timelinePoints !== null || timelineError !== null) return; // already resolved
    let cancelled = false;

    fetch("/api/growth-leaderboard/timeline?window=30d&limit=120")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{
          points: TimelinePoint[];
          updated_at?: number;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        setTimelineUpdatedAt(data.updated_at);
        setTimelinePoints(data.points ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTimelineError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [tab, timelinePoints, timelineError]);

  const timelineLabels = {
    timelineTitle: labels.timelineTitle,
    timelineEmpty: labels.timelineEmpty,
    dailyTitle: labels.dailyTitle,
    backToAll: labels.backToAll,
    filterPlaceholder: labels.filterPlaceholder,
    filterNoResults: labels.filterNoResults,
    filterClear: labels.filterClear,
    tooltipBand: labels.tooltipBand,
    tooltipGrowth: labels.tooltipGrowth,
    tooltipCommits: labels.tooltipCommits,
    tooltipMergedPrs: labels.tooltipMergedPrs,
    tooltipImpact: labels.tooltipImpact,
    tooltipScan: labels.tooltipScan,
    tooltipRepo: labels.tooltipRepo,
    tooltipLanguage: labels.tooltipLanguage,
    listLabel: labels.listLabel,
    clusterTitle: labels.clusterTitle,
    close: labels.close,
  };

  const entries =
    tab === defaultBand
      ? defaultEntries
      : tab !== "all"
        ? (allByBand[tab as BandKey] ?? []).slice(0, 12)
        : [];

  return (
    <section className="mt-16 w-full max-w-6xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-zinc-100">{labels.heading}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">{labels.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <GrowthSubscriptionButton labels={labels} />
          <Link
            href="/"
            prefetch={false}
            className="shrink-0 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            {labels.scanCta}
          </Link>
        </div>
      </div>

      <div
        role="tablist"
        aria-label={labels.bandAria}
        className="mb-4 flex flex-wrap gap-1"
      >
        {BAND_KEYS.map((k) => (
          <BandTab
            key={k}
            band={k}
            count={bandCounts[k]}
            active={tab === k}
            onSelect={() => setTab(k)}
          />
        ))}

        {/* "全部" / All tab */}
        <button
          onClick={() => setTab("all")}
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
            tab === "all"
              ? "bg-white/10 text-zinc-100"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          }`}
          aria-pressed={tab === "all"}
        >
          {labels.allTab}
        </button>
      </div>

      {tab === "all" ? (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          {timelineLoading && (
            <p className="py-10 text-center text-sm text-zinc-500">
              {labels.loading}
            </p>
          )}
          {timelineError && !timelineLoading && (
            <p className="py-10 text-center text-sm text-red-400">
              {labels.loadError}
            </p>
          )}
          {!timelineLoading && !timelineError && timelinePoints !== null && (
            <GrowthTimelineChart
              points={timelinePoints}
              labels={timelineLabels}
              windowDays={30}
              updatedAt={timelineUpdatedAt}
              selectedUsernames={selectedTimelineUsers}
              onSelectedUsernamesChange={setSelectedTimelineUsers}
            />
          )}
        </div>
      ) : entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          {labels.empty}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => (
            <GrowthCard
              key={e.username}
              entry={e}
              labels={labels}
              onView={() => {
                setSelectedTimelineUsers([e.username]);
                setTab("all");
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
