"use client";

import { useMemo } from "react";

import type { GeographyId } from "@/lib/contracts";
import { type AreaFloodResponse, floodPath, readAreaFlood } from "@/lib/flood-risk";
import type { DataMode } from "@/lib/map-state";
import { useSectionJson } from "./section-seed";

/** Area and home flood bands for the area, or null while loading, or "unknown". */
export function useAreaFlood(geographyId: GeographyId, uprn: string | null, mode: DataMode): AreaFloodResponse | null | "unknown" {
  const payload = useSectionJson(floodPath(geographyId, uprn));
  return useMemo(() => payload === undefined ? null : readAreaFlood(payload, mode) ?? "unknown", [payload, mode]);
}
