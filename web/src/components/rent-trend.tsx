"use client";

import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { readRentTrend, RENT_TREND_LABELS, rentTrendCell, rentTrendPath, type AreaRentTrendResponse } from "@/lib/rent-trend";

import { useSectionJson } from "./section-seed";
import { Sparkline } from "./sparkline";
import { regionShare } from "@/lib/evidence-format";
import { scopeName } from "@/lib/scope-name";
import { SourceNote } from "@/components/source-note";

const pounds = (value: number) => `£${value.toLocaleString("en-GB")}`;
const pct = (value: number | null) => value === null ? "–" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

function useRentTrend(geographyId: GeographyId, mode: DataMode): AreaRentTrendResponse | null {
  const payload = useSectionJson(rentTrendPath(geographyId));
  return payload ? readRentTrend(payload, mode) : null;
}

/** The borough's rent for the household's bedrooms, its line since 2015, change over 1 and 5 years and rank in its region. */
export function RentTrendBlock({ trend, bedrooms }: { trend: AreaRentTrendResponse | null; bedrooms: number | null }) {
  const value = trend?.value;
  const cell = value?.available ? rentTrendCell(value, bedrooms) : null;
  if (!value || !cell || cell.rent === null) return null;
  const rank = value.regionPercentile["rent-change-1y"];
  const borough = value.borough?.name ?? "Borough";
  // The comparison and rank are the area's region's (London for London; API rankScope).
  const scope = scopeName(value);
  const peers = scope === "London" ? "London boroughs" : `local authorities in ${scope}`;
  return (
    <div className="rent-trend" data-testid="rent-trend">
      <dl className="key-numbers">
        <div>
          <dt>Rent, {RENT_TREND_LABELS[cell.category]}</dt>
          <dd>{pounds(cell.rent)} / month · {borough} average</dd>
        </div>
        <div>
          <dt>Rent change</dt>
          <dd>1 yr {pct(cell.change1yPct)} · 5 yr {pct(cell.change5yPct)} ({scope} {pct(cell.regionChange1yPct)} · {pct(cell.regionChange5yPct)})</dd>
        </div>
        {typeof rank === "number" && (
          <div>
            <dt>{scope} rank</dt>
            <dd>Faster rise than {regionShare(rank)}% of {peers}</dd>
          </div>
        )}
      </dl>
      {cell.series.length > 1 && (
        <Sparkline compact testId="rent-trend-sparkline" values={cell.series.map((point) => point.rent)}
          periods={cell.series.map((point) => point.month)} format={pounds}
          subject={`${borough} average rent, ${RENT_TREND_LABELS[cell.category]}`} />
      )}
    </div>
  );
}

/** The section's ⓘ lines: licence and caveats, word for word. */
export function RentTrendSourcesBlock({ trend }: { trend: AreaRentTrendResponse | null }) {
  if (!trend?.value.available) return null;
  return (
    <>
      {trend.sources.map((source) => <p key={source.release}>{source.sourceName}: {source.attribution}</p>)}
      {trend.caveats.map((caveat) => <SourceNote key={caveat} text={caveat} />)}
    </>
  );
}

export function RentTrend({ geographyId, mode, bedrooms }: { geographyId: GeographyId; mode: DataMode; bedrooms: number | null }) {
  return <RentTrendBlock trend={useRentTrend(geographyId, mode)} bedrooms={bedrooms} />;
}

export function RentTrendSources({ geographyId, mode }: { geographyId: GeographyId; mode: DataMode }) {
  return <RentTrendSourcesBlock trend={useRentTrend(geographyId, mode)} />;
}
