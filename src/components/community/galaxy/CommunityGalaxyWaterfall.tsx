"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CircleDomain, CircleDomainPage } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { GalaxyDomainCard } from "./GalaxyDomainCard";

interface CommunityGalaxyWaterfallProps {
  initialDomains: CircleDomain[];
  initialCursor: string | null;
  lang: Lang;
}

/** Max engines allowed to run their RAF loop at once. Cards past this cap still
 *  reserve their layout space, but their avatars wait until the canvas gets a
 *  slot. Keeps the page smooth without showing avatars before the planet exists. */
const MAX_ACTIVE_ENGINES = 4;

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

function galaxyPosition(index: number) {
  const band = Math.floor(index / 3);
  const slot = index % 3;
  const leftBase = [8, 38, 68][slot];
  const left = leftBase + ((index * 19) % 13) - 6;
  const top = band * 310 + [24, 116, 62][slot] + ((index * 23) % 42);
  const width = 26 + ((index * 17) % 9);
  return { left, top, width };
}

/**
 * The community galaxy waterfall: an infinite-scroll list of domain planet cards.
 * Owns three concerns the individual cards can't see:
 *   1. pagination — fetches the next page of domains as the sentinel nears view.
 *   2. concurrency — grants a bounded number of "run" slots so only a few canvas
 *      engines animate at once (cards report intent via onActivityChange).
 *   3. dedupe — guards against a domain appearing twice across page boundaries.
 */
export function CommunityGalaxyWaterfall({
  initialDomains,
  initialCursor,
  lang,
}: CommunityGalaxyWaterfallProps) {
  const t = useTranslations("communityGalaxy");
  const [domains, setDomains] = useState<CircleDomain[]>(initialDomains);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const isDesktop = useIsDesktop();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const seenSlugs = useRef(new Set(initialDomains.map((d) => d.slug)));

  // Concurrency gate: cards that want to run, and the bounded set granted a slot.
  const wantSet = useRef(new Set<string>());
  const [activeSlugs, setActiveSlugs] = useState<Set<string>>(new Set());

  const recomputeActive = useCallback(() => {
    // Preserve currently-active cards that still want to run (avoid thrashing),
    // then fill remaining slots with other willing cards in DOM order.
    setActiveSlugs((prev) => {
      const next = new Set<string>();
      for (const slug of prev) {
        if (wantSet.current.has(slug) && next.size < MAX_ACTIVE_ENGINES) {
          next.add(slug);
        }
      }
      if (next.size < MAX_ACTIVE_ENGINES) {
        for (const d of domains) {
          if (next.size >= MAX_ACTIVE_ENGINES) break;
          if (wantSet.current.has(d.slug)) next.add(d.slug);
        }
      }
      // Skip the state update when nothing changed (same size + members).
      if (next.size === prev.size && [...next].every((s) => prev.has(s))) {
        return prev;
      }
      return next;
    });
  }, [domains]);

  const onActivityChange = useCallback(
    (slug: string, wantsToRun: boolean) => {
      if (wantsToRun) wantSet.current.add(slug);
      else wantSet.current.delete(slug);
      recomputeActive();
    },
    [recomputeActive],
  );

  const loadMore = useCallback(async () => {
    if (loading || cursor === null) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/community/domains?cursor=${encodeURIComponent(cursor)}`,
        { headers: { "Cache-Control": "no-store" } },
      );
      if (!res.ok) throw new Error(`domains_${res.status}`);
      const page = (await res.json()) as CircleDomainPage;
      const fresh = page.domains.filter((d) => !seenSlugs.current.has(d.slug));
      for (const d of fresh) seenSlugs.current.add(d.slug);
      setDomains((prev) => [...prev, ...fresh]);
      setCursor(page.nextCursor);
    } catch {
      // Best-effort: stop paging on error, keep what's already shown.
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || cursor === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, cursor]);

  if (domains.length === 0) {
    return (
      <section className="flex min-h-[54vh] items-center justify-center">
        <h2 className="sr-only">{t("heading")}</h2>
        <p className="sr-only">{t("empty")}</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="sr-only">{t("heading")}</h2>
      <p className="sr-only">{t("sub")}</p>
      {isDesktop ? (
        <div
          className="relative"
          style={{ minHeight: Math.max(680, Math.ceil(domains.length / 3) * 320 + 220) }}
        >
          {domains.map((domain, index) => {
            const pos = galaxyPosition(index);
            return (
              <div
                key={domain.slug}
                className="absolute"
                style={{
                  left: `${pos.left}%`,
                  top: pos.top,
                  width: `${pos.width}%`,
                }}
              >
                <GalaxyDomainCard
                  domain={domain}
                  index={index}
                  lang={lang}
                  active={activeSlugs.has(domain.slug)}
                  onActivityChange={onActivityChange}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {domains.map((domain, index) => (
            <div key={domain.slug} className="mb-[-1.5rem]">
              <GalaxyDomainCard
                domain={domain}
                index={index}
                lang={lang}
                active={activeSlugs.has(domain.slug)}
                onActivityChange={onActivityChange}
              />
            </div>
          ))}
        </div>
      )}
      {cursor !== null && (
        <div ref={sentinelRef} className="h-10 w-full" aria-hidden="true">
          {loading && (
            <p className="sr-only">{t("loading")}</p>
          )}
        </div>
      )}
    </section>
  );
}
