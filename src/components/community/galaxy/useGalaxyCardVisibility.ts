"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Drives one domain card through the galaxy lifecycle based on how close it is to
 * the viewport, so the waterfall only spends canvas/RAF budget on cards the user
 * can (nearly) see. Mirrors the state machine in community-galaxy-waterfall-todo.md:
 *
 *   idle     — far offscreen; no canvas, lightweight placeholder only
 *   preload  — within ~600px; load data/avatars, mount canvas at low cost
 *   forming  — intersecting; particles converge into the planet
 *   orbiting — brief; rings spin up (auto-advances to revealed)
 *   revealed — steady state while in view
 *   paused   — left the viewport; RAF paused, last frame kept
 *
 * Two IntersectionObservers: a wide `rootMargin` one flips idle↔preload, a tight
 * one flips the in-view phases. The card owns the engine; this hook only tells it
 * which phase to be in.
 */

export type GalaxyVisibilityPhase =
  | "idle"
  | "preload"
  | "forming"
  | "orbiting"
  | "revealed"
  | "paused";

const ORBITING_MS = 900;

export function useGalaxyCardVisibility<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [phase, setPhase] = useState<GalaxyVisibilityPhase>("idle");
  const [revealCycle, setRevealCycle] = useState(0);
  // Whether the card has ever formed — so re-entering the viewport goes straight
  // back to `revealed` (via a quick re-form) rather than replaying from scratch.
  const formedOnce = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Old-browser fallback: reveal on the next frame (deferred so we don't call
      // setState synchronously inside the effect body).
      const id = requestAnimationFrame(() => setPhase("revealed"));
      return () => cancelAnimationFrame(id);
    }

    let formTimer: ReturnType<typeof setTimeout> | undefined;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      if (formTimer) clearTimeout(formTimer);
      if (revealTimer) clearTimeout(revealTimer);
      formTimer = undefined;
      revealTimer = undefined;
    };

    // Near observer: preload when within ~600px of the viewport, drop to idle
    // when very far (so the engine can be released by the card).
    const near = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setPhase((p) => (p === "idle" ? "preload" : p));
          } else {
            clearTimers();
            setPhase("idle");
          }
        }
      },
      { rootMargin: "600px 0px 600px 0px", threshold: 0 },
    );

    // In-view observer: form on enter, pause on exit.
    const inView = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealCycle((cycle) => cycle + 1);
            setPhase("forming");
            clearTimers();
            formTimer = setTimeout(() => {
              formedOnce.current = true;
              setPhase("orbiting");
              revealTimer = setTimeout(() => setPhase("revealed"), ORBITING_MS);
            }, formedOnce.current ? 120 : 700);
          } else {
            clearTimers();
            setPhase((p) => (p === "idle" || p === "preload" ? p : "paused"));
          }
        }
      },
      { rootMargin: "0px", threshold: 0.15 },
    );

    near.observe(el);
    inView.observe(el);
    return () => {
      near.disconnect();
      inView.disconnect();
      clearTimers();
    };
  }, []);

  return { ref, phase, revealCycle };
}
