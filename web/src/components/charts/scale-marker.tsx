import { Dot } from "@/components/knit";
import { SatinSpan } from "@/components/ramp-knit";

import { ChartUnknown } from "./chart-unknown";

/** data-range is in twentieths of the track (a stable test hook). */
const COLS = 20;

const pct = (share: number) => `${(Math.min(1, Math.max(0, share)) * 100).toFixed(2)}%`;
/** Keeps an edge label inside the chart: left-aligned near 0, right-aligned near 1. */
const anchor = (share: number) => (share < 0.15 ? "start" : share > 0.85 ? "end" : "middle");

/**
 * A value's place on a low→high bar (position 0..1, see scalePosition), with
 * an optional London tick and an optional range band (e.g. the middle 50%).
 * Satin: the track is unworked --wool felt and the range a satin block
 * stitched into it; the dot is a plain Dot.
 * The dot is this area; label is the accessible sentence and must carry the
 * numbers, because positions alone are not readable.
 */
export function ScaleMarker({ position, marker = null, range, low, high, label }: {
  position: number | null; marker?: number | null; range?: [number, number]; low: string; high: string; label: string;
}) {
  if (position === null) return <ChartUnknown />;
  const [from, to] = range ? [Math.min(...range), Math.max(...range)].map((share) => Math.round(Math.min(1, Math.max(0, share)) * COLS)) : [0, 0];
  return (
    <div className="chart chart-scale" role="img" aria-label={label} data-has-marker={marker !== null ? "" : undefined}>
      {marker !== null && (
        <span className="chart-scale__marker-label" data-anchor={anchor(marker)} style={{ left: pct(marker) }}>London</span>
      )}
      <span className="chart-scale__track" data-range={range ? `${from}-${to}` : undefined}>
        <SatinSpan from={range ? Math.min(...range) : null} to={range ? Math.max(...range) : null} colour="var(--chart-1)" width={240} height={14} className="chart-scale__satin" />
        {marker !== null && <span className="chart-scale__marker" style={{ left: pct(marker) }} />}
        <span className="chart-scale__dot" style={{ left: pct(position) }}><Dot colour="var(--yarn-cherry)" size={18} /></span>
      </span>
      <span className="chart-scale__ends"><span>{low}</span><span>{high}</span></span>
    </div>
  );
}
