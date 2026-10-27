"use client";

import { useMemo } from "react";

import { healthPath, readAreaHealth, type AreaHealthResponse } from "@/lib/area-health";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { useSectionJson } from "./section-seed";

/**
 * The area's health payload: null while loading, "unknown" when it is not served
 * (demo mode has no health layers, so it is never fetched there).
 */
export function useAreaHealth(geographyId: GeographyId, mode: DataMode): AreaHealthResponse | null | "unknown" {
  const payload = useSectionJson(mode === "real" ? healthPath(geographyId) : null);
  return useMemo(() => mode !== "real" ? "unknown" : payload === undefined ? null : readAreaHealth(payload) ?? "unknown", [mode, payload]);
}

const known = (health: AreaHealthResponse | null | "unknown") => (health && health !== "unknown" && health.available ? health : null);

/** Behind the section's ⓘ: each source with its licence, then the caveats. */
export function HealthNotes({ health }: { health: AreaHealthResponse | null | "unknown" }) {
  const value = known(health);
  if (!value) return <p>Air and summer heat: Greater London Authority. GPs: NHS England. Loaded in real mode only.</p>;
  return (
    <>
      <ul data-testid="health-sources">
        {value.sources.map((source) => (
          <li key={source.release}>
            <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.attribution}</a> · {source.licence}
          </li>
        ))}
      </ul>
      {value.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
    </>
  );
}
