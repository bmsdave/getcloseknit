"use client";

import { useEffect } from "react";

import { MAPLIBRE_VERSION } from "@/lib/map-core";

// Set per build in next.config.ts; the worker names its cache after it.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

export function PwaRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Some browsers and embedded views refuse service workers; the site works without one.
      // m: the MapLibre worker's folder, kept in the shell for the map offline.
      const query = `v=${encodeURIComponent(BUILD_ID)}&m=${encodeURIComponent(MAPLIBRE_VERSION)}`;
      navigator.serviceWorker.register(`/sw.js?${query}`, { scope: "/" }).catch(() => undefined);
    }
  }, []);
  return null;
}
