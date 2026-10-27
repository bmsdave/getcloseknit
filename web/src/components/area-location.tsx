"use client";

import { useMemo } from "react";

import { type AreaLocationResponse, locationPath, readAreaLocation } from "@/lib/area-location";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { DevelopmentPipeline, PipelineSources } from "./development-pipeline";
import { FutureTransportLine } from "./future-transport";
import { useSectionJson } from "./section-seed";

/** Short lines about the land an area sits on: conservation area, ULEZ, Congestion Charge, planning. */
export function LocationNotes({ notes }: { notes: readonly string[] | undefined }) {
  if (!notes?.length) return null;
  return (
    <ul className="location-notes" data-testid="location-notes">
      {notes.map((note) => <li key={note}>{note}</li>)}
    </ul>
  );
}

/**
 * The area's location payload: null while loading, "unknown" when it is not
 * served (demo mode has no location layers, so it is never fetched there).
 */
export function useAreaLocation(geographyId: GeographyId, mode: DataMode): AreaLocationResponse | null | "unknown" {
  const payload = useSectionJson(mode === "real" ? locationPath(geographyId) : null);
  return useMemo(() => mode !== "real" ? "unknown" : payload === undefined ? null : readAreaLocation(payload) ?? "unknown", [mode, payload]);
}

/**
 * Planning tab in real mode: the area's planning activity (applications in the last 24 months, by
 * kind, against London's median) and the rules on its land, with sources and caveats.
 */
export function AreaLocationSection({ geographyId }: { geographyId: GeographyId }) {
  const location = useAreaLocation(geographyId, "real");
  return (
    <section className="area-location" data-testid="area-location" aria-labelledby="area-location-title">
      <h2 id="area-location-title">Planning and local rules</h2>
      {location === null && <p className="metric-description">Loading…</p>}
      {(location === "unknown" || (location && !location.available)) && (
        <p className="metric-description">Conservation areas, charging zones and planning applications are not loaded for this area.</p>
      )}
      {location && location !== "unknown" && location.available && (
        <>
          <LocationNotes notes={location.notes} />
          {location.planning && (
            <p className="metric-description" data-testid="planning-activity">
              Applications validated {location.planning.windowStart} to {location.planning.windowEnd}:{" "}
              {location.planning.householder} householder, {location.planning.full} full or outline,{" "}
              {location.planning.priorApproval} prior approval, {location.planning.applications - location.planning.householder
                - location.planning.full - location.planning.priorApproval} other. Proposals, not permissions.
            </p>
          )}
          <DevelopmentPipeline geographyId={geographyId} />
          {(location.conservation?.areas.length ?? 0) > 0 && (
            <p className="metric-description">
              Conservation areas here: {location.conservation!.areas.map((area) => area.name).join(", ")}.
              The borough&apos;s own map is the authority.
            </p>
          )}
          <details className="chart-sources">
            <summary>Sources and caveats</summary>
            <ul>{location.sources.map((source) => <li key={source.release}>{source.attribution}</li>)}</ul>
            <ul><PipelineSources geographyId={geographyId} /></ul>
            <ul>{location.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
          </details>
        </>
      )}
      <FutureTransportLine geographyId={geographyId} />
    </section>
  );
}
