"use client";

import { useEffect } from "react";

/**
 * Marks the page interactive: <html data-hydrated> once React has hydrated the root (the last thing in <body>,
 * so its effect runs after the page's own). The e2e specs wait for it after a navigation (e2e/fixtures.ts):
 * a click or a typed field before hydration lands on server HTML without its handlers.
 */
export function HydrationMark() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "";
  }, []);
  return null;
}
