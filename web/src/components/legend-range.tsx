"use client";

import { useMemo, useSyncExternalStore, type CSSProperties } from "react";

import { effectiveScaleMode } from "@/lib/legend-scale";
import {
  AUTO_SCALE, clampRange, currentViewValues, handleLabel, histogram, histogramDomain, isAutoScale, legendScaleDragging, legendScaleFor, rankIn,
  servedScope, servedScopes, setLegendScale, sliderStep, subscribeViewValues, type ScaleScope,
} from "@/lib/legend-range";
import { loadedMapCoverage, subscribeMapCoverage } from "@/lib/map-coverage";
import { CHANGE_RANGE_PERCENT, sampleRamp } from "@/lib/palettes";
import { terseValue } from "@/lib/view-scale";

import { SatinBlock } from "./knit/satin";
import { legendRamp, ownScaleKey, useOwnScale, useViewBreaks, type MapLegendProps } from "./map-legend";

/** Bars across the histogram: about one per slider centimetre, wide enough to read as satin. */
const BINS = 24;
const WIDTH = 300;
const HEIGHT = 26;
const GAP = 2;
const EMPTY = new Float64Array(0);

/**
 * The reader's own colour scale, under the legend (lib/legend-range.ts): a histogram of the values in view in the
 * layer's colours, two handles setting the ramp's low and high value, the rank's areas (In view, the region, England)
 * on a rank layer, and Reset. A drag recolours the map once per frame; a release writes the address and this device.
 */
export function LegendRange({ legend, region }: { legend: MapLegendProps; region: string }) {
  const key = ownScaleKey(legend);
  const own = useOwnScale(legend);
  const coverage = useSyncExternalStore(subscribeMapCoverage, () => loadedMapCoverage().coverage, () => "london" as const);
  const breaks = useViewBreaks(legend);
  const view = useSyncExternalStore(subscribeViewValues, currentViewValues, () => null);
  const values = view && view.key === key ? view.values : EMPTY;
  const effective = effectiveScaleMode(legend.metric.id, legend.scaleMode, false);
  const ramp = legendRamp(legend, own.range ? null : breaks, own);
  const shades = useMemo(() => (ramp ? sampleRamp(ramp.colours, 101) : []), [ramp?.colours.join()]);
  if (!key || !ramp) return null;
  // Where the handles rest on the automatic scale: the view's ends, the fixed scale's ends, or the values in view.
  const auto: readonly [number, number] | null = breaks && breaks.length >= 2 ? [breaks[0], breaks[breaks.length - 1]]
    : effective === "change" ? [-CHANGE_RANGE_PERCENT, CHANGE_RANGE_PERCENT]
      : effective === "linear" ? legendEnds(legend) : null;
  const domain = histogramDomain(values, own.range ?? auto);
  if (!domain) return null;
  const step = sliderStep(domain[1] - domain[0]);
  const [low, high] = clampRange(own.range?.[0] ?? auto?.[0] ?? domain[0], own.range?.[1] ?? auto?.[1] ?? domain[1], domain, step)
    ?? domain;
  const unit = effective === "change" ? "%" : legend.metric.unit;
  const text = (value: number) => terseValue(value, unit);
  // A rank on the region's or England's scale has no value edges: the bars take their rank among the areas in view.
  const rankScale = effective === "percentile" && !own.range && !breaks;
  const shade = (value: number) => shades[Math.round(Math.min(1, Math.max(0, rankScale ? rankIn(values, value) : ramp.position(value))) * 100)];
  const counts = histogram(values, domain, BINS);
  const tallest = Math.max(1, ...counts);
  const span = domain[1] - domain[0];
  const set = (which: "low" | "high", raw: number) => {
    const next: [number, number] = which === "low" ? [Math.min(raw, high - step), high] : [low, Math.max(raw, low + step)];
    setLegendScale(key, { range: clampRange(next[0], next[1], domain, step) ?? next, scope: own.scope }, { commit: false });
  };
  // A released handle (pointer, touch or key) is written to the address and this device.
  const release = () => {
    if (legendScaleDragging()) setLegendScale(key, legendScaleFor(key), { commit: true });
  };
  const at = (value: number) => (span > 0 ? (value - domain[0]) / span : 0);
  const handle = (which: "low" | "high", value: number) => (
    <input type="range" className="legend-range__input" min={domain[0]} max={domain[1]} step={step} value={value}
      aria-label={handleLabel(legend.metric.label, which, unit)} aria-valuetext={text(value)}
      data-testid={`legend-range-${which}`}
      // The targets overlap when the handles are close: past the middle the low one is on top, as only it can move.
      style={which === "low" && at(value) > 0.5 ? { zIndex: 1 } : undefined}
      onChange={(event) => set(which, Number(event.target.value))}
      onPointerUp={release} onKeyUp={release} onBlur={release} onTouchEnd={release} />
  );
  const pick = (scope: ScaleScope) => setLegendScale(key, { range: null, scope }, { commit: true });
  const labels: Record<ScaleScope, string> = {
    view: "In view", region: region && region !== "England" ? region : "Region", england: "England",
  };
  const scopes = servedScopes(coverage).map((scope) => ({ scope, label: labels[scope] }));
  const barWidth = (WIDTH - GAP * (BINS - 1)) / BINS;
  return (
    <div className="legend-range" role="group" aria-label="Colour range" data-testid="legend-range" data-custom={own.range ? "true" : undefined}>
      <div className="legend-range__slider">
        <svg className="legend-range__bars" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true"
          data-testid="legend-range-bars">
          {counts.map((count, index) => {
            const height = count === 0 ? 0 : Math.max(3, (count / tallest) * HEIGHT);
            const middle = domain[0] + ((index + 0.5) / BINS) * span;
            return height > 0 && (
              <SatinBlock key={index} x={index * (barWidth + GAP)} y={HEIGHT - height} width={barWidth} height={height}
                colour={shade(middle)} seed={index + 1} />
            );
          })}
        </svg>
        <span className="legend-range__in" aria-hidden="true"
          style={{ "--from": at(low).toFixed(4), "--to": at(high).toFixed(4) } as CSSProperties} />
        {handle("low", low)}
        {handle("high", high)}
        <span className="legend-range__value" data-edge={at(low) < 0.2 ? "start" : "end"} data-testid="legend-range-low-value"
          style={{ "--at": at(low).toFixed(4) } as CSSProperties}>{text(low)}</span>
        <span className="legend-range__value" data-edge={at(high) > 0.8 ? "end" : "start"} data-testid="legend-range-high-value"
          style={{ "--at": at(high).toFixed(4) } as CSSProperties}>{text(high)}</span>
      </div>
      <div className="legend-range__row">
        {effective === "percentile" && (
          <div className="menu-seg legend-range__scopes" role="group" aria-label="Rank among">
            {scopes.map((entry) => (
              <button key={entry.scope} type="button" aria-pressed={!own.range && servedScope(own.scope, coverage) === entry.scope}
                data-testid={`legend-scope-${entry.scope}`} onClick={() => pick(entry.scope)}>{entry.label}</button>
            ))}
          </div>
        )}
        {!isAutoScale(own) && (
          <button type="button" className="legend-range__reset" data-testid="legend-range-reset"
            onClick={() => setLegendScale(key, AUTO_SCALE, { commit: true })}>Reset</button>
        )}
      </div>
    </div>
  );
}

/** A fixed scale's lowest and highest stop (the crime filter's own stops when it rescales). */
function legendEnds(legend: MapLegendProps): readonly [number, number] | null {
  const stops = legend.stopsOverride ?? legend.metric.legend;
  if (stops.length < 2) return null;
  const [low, high] = [stops[0].value, stops[stops.length - 1].value];
  return high > low ? [low, high] : null;
}
