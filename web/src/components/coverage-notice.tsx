"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useSyncExternalStore } from "react";

import { LONDON_BBOX } from "@/lib/map-coverage";
import { hideMapToast, showMapToast } from "@/lib/map-toast";
import { currentViewCoverage, subscribeViewCoverage } from "@/lib/no-data";

/** How long the notice stays up: as long as a reader looking at an empty map needs to find the way back. */
const COVERAGE_NOTICE_MS = 20_000;

/**
 * A layer with partial coverage ("London only") and not one of its areas in view (DESIGN.md §6, England map): a map
 * message "<Layer>: London only · Show London", whose button brings London into view. Renders nothing itself.
 */
export function CoverageNotice({ map, layerName, coverageTag }: {
  map: MapLibreMap | null;
  layerName: string | null | undefined;
  coverageTag: string | null | undefined;
}) {
  const values = useSyncExternalStore(subscribeViewCoverage, currentViewCoverage, () => null)?.values ?? true;
  const empty = !!coverageTag && !values;
  useEffect(() => {
    if (!empty) return;
    const id = showMapToast(`${layerName ?? "This layer"}: ${coverageTag}`, {
      kind: "coverage-only",
      ms: COVERAGE_NOTICE_MS,
      action: {
        label: "Show London",
        onClick: () => {
          const [west, south, east, north] = LONDON_BBOX;
          map?.fitBounds([[west, south], [east, north]], { padding: 24 });
        },
      },
    });
    return () => hideMapToast(id);
  }, [empty, layerName, coverageTag, map]);
  return null;
}
