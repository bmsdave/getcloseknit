"use client";

import { useMemo } from "react";

import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import {
  type AreaShortLetsResponse, rateWords, readAreaShortLets, shortLetBars, shortLetScaleLabel, shortLetsPath, shortLetsValue,
  type ShortLetsValue,
} from "@/lib/short-lets";
import { BarList, ScaleMarker } from "./charts";
import { HelpTip } from "./help-tip";
import { useSectionJson } from "./section-seed";

/** The area's short-lets payload; null while loading or when not served (demo mode never fetches it). */
export function useAreaShortLets(geographyId: GeographyId, mode: DataMode): AreaShortLetsResponse | null {
  const payload = useSectionJson(mode === "real" ? shortLetsPath(geographyId) : null);
  return useMemo(() => payload ? readAreaShortLets(payload) : null, [payload]);
}

/** Short lets in the local market: listings per 1,000 homes on London's scale, then entire homes and activity. */
export function ShortLets({ geographyId, mode }: { geographyId: GeographyId; mode: DataMode }) {
  const value = shortLetsValue(useAreaShortLets(geographyId, mode));
  return value ? <ShortLetsView value={value} /> : null;
}

export function ShortLetsView({ value }: { value: ShortLetsValue }) {
  const rate = rateWords(value.per1000Homes);
  return (
    <div className="short-lets" data-testid="short-lets">
      <h3 className="market-heading">Short lets <HelpTip id="short-lets" /></h3>
      <p className="market-basis" data-testid="short-lets-rate">
        <strong>{value.listings === 0 ? "None listed" : rate ?? `${value.listings.toLocaleString("en-GB")} listed`}</strong>
        {value.regionPer1000Homes !== null && ` · London ${Math.round(value.regionPer1000Homes)}`}
      </p>
      {value.regionPercentile !== null && (
        <ScaleMarker position={value.regionPercentile / 100} marker={0.5} low="Fewest" high="Most" label={shortLetScaleLabel(value)} />
      )}
      {value.listings > 0 && <BarList rows={shortLetBars(value)} label="Airbnb listings here" />}
    </div>
  );
}

/** For the section's ⓘ: the attribution, then the caveats. */
export function ShortLetsSources({ geographyId, mode }: { geographyId: GeographyId; mode: DataMode }) {
  const response = useAreaShortLets(geographyId, mode);
  if (!response || !shortLetsValue(response)) return null;
  const lines = new Set([...response.sources.map((source) => source.attribution), ...response.caveats]);
  return <>{[...lines].map((line) => <p key={line}>{line}</p>)}</>;
}
