"use client";

import { useCallback, useMemo, useState } from "react";

import {
  layerHref, overviewChips, overviewLayersPath, overviewSummary, overviewTiles, readAreaLayers, type AreaLayersResponse,
} from "@/lib/area-layers";
import type { GeographyId } from "@/lib/contracts";
import { homeFloodChip, type HomeFloodContext } from "@/lib/flood-risk";
import type { DataMode } from "@/lib/map-state";
import { AreaTiles } from "./area-standouts";
import { useFailedReads, useSectionJson } from "./section-seed";

/**
 * The area's Overview scorecard (?scope=overview): null while loading, "unknown" when the area has none
 * (a demo area outside the previews) or the read failed.
 */
export function useAreaLayers(geographyId: GeographyId, mode: DataMode): AreaLayersResponse | null | "unknown" {
  const payload = useSectionJson(overviewLayersPath(geographyId));
  return useMemo(() => payload === undefined ? null : readAreaLayers(payload, mode) ?? "unknown", [mode, payload]);
}

/**
 * Block 6, Overview: a plain paragraph, then one tile per ranked layer and the three ready-made criteria
 * the area rates highest on (each opens the map with that layer on), then flood, air and broadband as
 * band chips, which have no map metric. Flood follows the home's own band, then its postcode's homes',
 * then the area's (`flood`), as the Environment row below does. A failed read says "Couldn't load" with a retry.
 */
export function HomeOverview({ geographyId, mode, flood = null }: {
  geographyId: GeographyId; mode: DataMode; flood?: HomeFloodContext | null;
}) {
  // Retry remounts the block: its read starts again, and failed reads are never cached (lib/section-fetch.ts).
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return <OverviewBody key={attempt} geographyId={geographyId} mode={mode} flood={flood} retry={retry} />;
}

function OverviewBody({ geographyId, mode, flood, retry }: {
  geographyId: GeographyId; mode: DataMode; flood: HomeFloodContext | null; retry: () => void;
}) {
  const layers = useAreaLayers(geographyId, mode);
  const failed = useFailedReads()([overviewLayersPath(geographyId)]);
  if (layers === "unknown" && !failed) return null;
  const ready = layers && layers !== "unknown" ? layers : null;
  const summary = ready ? overviewSummary(ready) : null;
  return (
    <section className="home-block home-overview" data-testid="home-overview" aria-labelledby="home-overview-title">
      <h2 id="home-overview-title">Overview</h2>
      {failed
        ? (
          <>
            <p className="area-section__status" role="status" data-testid="home-overview-failed">Couldn&apos;t load</p>
            <button type="button" className="text-button" onClick={retry}>Retry</button>
          </>
        )
        : (
          <>
            {summary && <p className="home-overview__summary" data-testid="home-overview-summary">{summary}</p>}
            <AreaTiles standouts={ready ? { tiles: overviewTiles(ready) } : null} prefix="layers-"
              href={(tile) => layerHref(geographyId, tile.id)} />
            {ready && (
              <ul className="home-overview__chips" aria-label="Flood, air and broadband">
                {overviewChips(ready).map((chip) => {
                  // The flood chip says whose band it is ("Flood, this home"), like the Environment row.
                  const home = chip.id === "flood" ? homeFloodChip(flood, chip.band) : null;
                  const text = `${chip.label}: ${(home ? home.band : chip.band) ?? "No data"}`;
                  return (
                    <li key={chip.id} className="london-chip" data-testid={`overview-chip-${chip.id}`} data-scope={home?.scope}
                      title={home?.title} aria-label={home ? `${text}, ${home.title.replace(/^Flood, /, "")}` : undefined}>
                      {text}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
    </section>
  );
}
