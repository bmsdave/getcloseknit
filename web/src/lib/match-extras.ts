"use client";

import { useEffect, useState } from "react";

/** ≡ debugging and e2e: "on" shows My match's older extras on this device, "off" hides them whatever the build says. */
export const MATCH_EXTRAS_KEY = "close-knit.match-extras";

/**
 * My match's older blocks under the ten (CUJ01 round 3): Tailor and the schools you would consider, Compare
 * places, Saved areas & costs, Show on the map, Clear and Your data, and the tray's Needs · Shortlist · Compare ·
 * Brief steps. The v4 boards draw none of them (the ten, Compare, Share search and the portals), so they wait behind
 * a default-off flag (FLAGS.md `NEXT_PUBLIC_MATCH_PANEL_EXTRAS`); a viewer's MATCH_EXTRAS_KEY overrides either way.
 */
export function matchExtrasOn(): boolean {
  // This device's choice, else this tab's (a browser that refuses localStorage may still keep sessionStorage).
  for (const read of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const chosen = typeof window === "undefined" ? null : read().getItem(MATCH_EXTRAS_KEY);
      if (chosen === "on" || chosen === "off") return chosen === "on";
    } catch {
      // Storage blocked: the next one, then the build's default.
    }
  }
  return process.env.NEXT_PUBLIC_MATCH_PANEL_EXTRAS === "on";
}

/** The flag after hydration (the server render never has the viewer's storage): off until mounted. */
export function useMatchExtras(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(matchExtrasOn()); }, []);
  return on;
}
