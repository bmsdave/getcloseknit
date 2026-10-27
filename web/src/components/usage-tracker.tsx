"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { flushUsage, pagePath, sharedKind, track, trafficSource, usageLayer } from "@/lib/usage";

const TICK_MS = 5000;
const ACTIVE_WINDOW_MS = 30_000;
const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Page views and engaged time for lib/usage.ts. Time counts only while the tab is visible and the reader
 * did something in the last 30 seconds; it is sent per page when they move on or leave, and on the map
 * also per layer on screen (layer_time), so time can be read by analytic.
 */
export function UsageTracker() {
  const pathname = usePathname();
  const landing = useRef(true);

  useEffect(() => {
    if (!pathname) return;
    const path = pagePath(pathname);
    // Where the visit came from, and a shared link it opened: on the landing page only, not on each
    // in-app navigation (the referrer stays the same for the whole page load).
    const first = landing.current;
    landing.current = false;
    const source = first ? trafficSource(document.referrer, window.location.search, window.location.origin) : null;
    const fromOutside = first && !document.referrer.startsWith(window.location.origin);
    track("page_view", { path, source, landing: first, shared: fromOutside ? sharedKind(window.location.hash) : null });
    let lastActive = Date.now();
    let engaged = 0;
    let byLayer = new Map<string, number>();
    const active = () => { lastActive = Date.now(); };
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastActive >= ACTIVE_WINDOW_MS) return;
      engaged += TICK_MS / 1000;
      const layer = path === "/" ? usageLayer() : null;
      if (layer) byLayer.set(layer, (byLayer.get(layer) ?? 0) + TICK_MS / 1000);
    }, TICK_MS);
    const report = (leaving: boolean) => {
      if (engaged > 0) track("engagement", { path, seconds: engaged });
      for (const [layer, seconds] of byLayer) track("layer_time", { layer, seconds });
      byLayer = new Map();
      engaged = 0;
      flushUsage(leaving);
    };
    const onHide = () => { if (document.visibilityState === "hidden") report(true); };
    const onLeave = () => report(true);
    for (const name of ACTIVITY) window.addEventListener(name, active, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.clearInterval(tick);
      for (const name of ACTIVITY) window.removeEventListener(name, active);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
      report(false);
    };
  }, [pathname]);

  return null;
}
