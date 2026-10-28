"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

import type { MapDefinition } from "@/lib/contracts";
import { visibleTicks } from "@/lib/legend-ticks";
import { effectiveScaleMode, linearRampPosition, percentileStops, type LegendScaleMode, type LegendStop } from "@/lib/legend-scale";
import { legendCaption, legendCaptionParts, legendTitle, mapPeriodLabel, scaleDirectionNote, UNKNOWN_FILL_COLOR } from "@/lib/map-legend";
import { matchHatchSwatch } from "@/lib/match-map";
import { currentViewCoverage, NO_DATA_LABEL, noDataColour, subscribeViewCoverage } from "@/lib/no-data";
import { topicViewNote } from "@/lib/map-topics";
import type { DataMode } from "@/lib/map-state";
import type { ValueStore } from "@/lib/value-store";
import { currentViewScale, subscribeViewScale, terseValue, viewPosition } from "@/lib/view-scale";
import { AUTO_SCALE, legendScaleFor, legendScaleKey, rangePosition, subscribeLegendScale, type LayerScale } from "@/lib/legend-range";
import { isWildlifeMetric } from "@/lib/nature-layers";
import { onUiThemeChange, resolvedUiTheme } from "@/lib/ui-themes";
import { CHANGE_RANGE_PERCENT, divergingStops, isClearColour } from "@/lib/palettes";
import type { ChangeWindow } from "@/lib/price-change";
import { propertyLayersApply, SOLD_BANDS, SOLD_BANDS_LEGEND } from "@/lib/map-property-layers";
import {
  hueBandRanges,
  PRICE_METRIC_ID,
  priceLabel,
  rampPosition,
  rangeLabel,
  stopsRange,
} from "@/lib/price-scale";

import { BivariateLegendCompact } from "./bivariate-legend";
import { RampSatin, SatinSquare } from "./ramp-knit";

/** Satin blocks across the legend: classes sampled along the ramp, wide enough to read on a phone. */
const LEGEND_BLOCKS = 9;

export interface MapLegendProps {
  metric: MapDefinition;
  period: string;
  mode: DataMode;
  scaleMode: LegendScaleMode;
  changeWindow: ChangeWindow;
  /** What the view's ranks are in: "London", "North West", "its region" (lib/map-coverage viewScopeWords); absent = London. */
  rankScope?: string;
  /**
   * The rank scale is split from the areas in view (lib/view-scale.ts): the legend reads the breaks from their store
   * itself (useViewBreaks), so a new view or a playback step re-renders the legend, not the page.
   */
  inView?: boolean;
  /** Stops rescaled to the filtered crime types; null keeps the published legend. */
  stopsOverride: LegendStop[] | null;
  /** Price and crime: the London median of the shown period, marked on the gradient. */
  median?: number | null;
  /** The price layer's sold-home colours, one per coarse band (the palette's price ramp). */
  soldRamp?: readonly string[];
  /** Homes are on screen (house zoom): the compact key names the sold-home colours. */
  houseZoom?: boolean;
  /** The layer's name as Layers lists it ("Noise"): the title names it first when its own words do not. */
  layerName?: string | null;
  /** The layer's coverage when it is not the map's ("London only", map-topics londonOnlyLayers): said while it is chosen. */
  coverageTag?: string | null;
}

/** Sold homes' colours: the six coarse bands of their last sale, low to high. */
function SoldBands({ ramp, compact }: { ramp: readonly string[]; compact?: boolean }) {
  if (compact) {
    return (
      <span className="map-legend-typical map-legend-sold" data-testid="legend-sold-compact">
        <span className="map-legend-sold-swatches" aria-hidden="true">
          {ramp.map((colour) => <SatinSquare key={colour} colour={colour} size={10} />)}
        </span>
        <span>{SOLD_BANDS_LEGEND}</span>
      </span>
    );
  }
  return (
    <div className="legend-details-sold" data-testid="legend-sold-bands">
      <p className="legend-details-unknown">{SOLD_BANDS_LEGEND}</p>
      <ul className="legend-details-bands" aria-label="Sold home colours">
        {SOLD_BANDS.map((band, index) => (
          <li key={band}>
            <SatinSquare colour={ramp[index]} />
            {band}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface LegendScale {
  /** The ramp, low to high, evenly spaced (knitted as the legend strip). */
  colours: string[];
  /** Tick labels along the gradient, each at its place (0..1): low…high, or −, 0, + for the change scale. */
  /**
   * `words` lead the label and `more` follows it on a wide legend ("Lowest in view £5k", "Lowest in North West");
   * a phone's one-line chip drops both ("£5k", "Lowest"), so its ends never clip.
   */
  ticks: { position: number; label: string; words?: string; more?: string }[];
  testId: string | undefined;
  note: string;
  ariaLabel: string;
  /** The London-typical marker: its place along the gradient (0..1). */
  tick?: { position: number; label: string; value: number };
  /** Price: each hue band's £/m² span, for the colour key in the data selector. */
  bands?: { colour: string; label: string }[];
  /** My match (board V4-21e): the hatch of an area that fails a Must. */
  keys?: { kind: "must"; label: string }[];
  /** Satin blocks to knit (default LEGEND_BLOCKS): one per band for a banded ramp. */
  steps?: number;
  /** Where a painted value sits along the ramp (0..1), for the explainer's marks (layer-explainer.tsx). */
  position: (value: number) => number;
}

/**
 * The compact key on the map's legend chip (map-layers.tsx), phrasing content
 * only (the chip is one button that opens the Layers menu): the layer and its
 * period, "Price per m² · Jun 2026", over the satin scale with its tick labels
 * and the London-typical marker; on a phone one line, the layer then a thin
 * scale between its lowest and highest labels (layout.css). Wildlife layers add
 * "Seen, not absent". What the layer measures, how it is counted and where the
 * chosen area sits are the chip's "?" (layer-explainer.tsx).
 */
/** The legend with the London median read from the map's store (close-knit.tsx): a step moves the tick, not the page. */
export function LiveMapLegend({ median, ...props }: Omit<MapLegendProps, "median"> & { median: ValueStore<number | null> }) {
  const value = useSyncExternalStore(median.subscribe, median.get, () => null);
  return <MapLegend {...props} median={value} />;
}

/**
 * My match before its first criterion: the map is neutral, so the key says how to colour it rather than
 * showing a ramp and a hatch that nothing on the map uses yet.
 */
export function MatchLegendHint() {
  return (
    <span className="map-legend map-legend--hint" data-testid="map-legend">
      <span className="map-legend-caption" data-testid="legend-caption">My match</span>
      <span className="map-legend-note" data-testid="legend-match-empty">Add a budget or what matters to colour the map</span>
    </span>
  );
}

export function MapLegend(props: MapLegendProps) {
  if (props.metric.bivariate) return <BivariateLegendCompact square={props.metric.bivariate} label={props.metric.label} />;
  return <RampLegend {...props} />;
}

/** The view's breaks for this legend's layer (lib/view-scale.ts), or null when its rank scale is the region's. */
export function useViewBreaks(props: Pick<MapLegendProps, "inView" | "metric">): readonly number[] | null {
  const scale = useSyncExternalStore(subscribeViewScale, currentViewScale, () => null);
  return props.inView && scale && scale.metricId === props.metric.id ? scale.breaks : null;
}

/** The store key of the reader's own scale for this legend's layer (lib/legend-range.ts); null where none applies. */
export function ownScaleKey(props: Pick<MapLegendProps, "metric" | "scaleMode">): string | null {
  if (props.metric.bivariate || props.metric.id === "personal-match") return null;
  return legendScaleKey(props.metric.id, effectiveScaleMode(props.metric.id, props.scaleMode, false));
}

/** The reader's own scale for this legend's layer: a drag re-renders the legend, not the page. */
export function useOwnScale(props: Pick<MapLegendProps, "metric" | "scaleMode">): LayerScale {
  const key = ownScaleKey(props);
  return useSyncExternalStore(subscribeLegendScale, () => (key ? legendScaleFor(key) : AUTO_SCALE), () => AUTO_SCALE);
}

function RampLegend(props: MapLegendProps) {
  const own = useOwnScale(props);
  const { scale, caption } = describeLegend(props, useViewBreaks(props), own);
  const { name, rest } = legendCaptionParts(caption, legendTitle(props.metric), props.layerName);
  // The Must hatch's key matches the map's, which recedes at night.
  const theme = useSyncExternalStore(onUiThemeChange, resolvedUiTheme, () => "day" as const);
  const stops = useFittedTicks(scale.ticks.map((tick) => `${tick.words ?? ""}${tick.label}${tick.more ?? ""}`).join("|"));
  // A grey area in view: the key says what grey means (lib/no-data.ts); never on My match, whose grey is a Must's.
  const noData = useSyncExternalStore(subscribeViewCoverage, currentViewCoverage, () => null)?.noData === true
    && props.metric.id !== "personal-match";
  return (
    <span className="map-legend" data-testid="map-legend">
      <span className="map-legend-caption" data-testid="legend-caption">
        <span className="map-legend-caption__name" data-testid="legend-layer-name">{name}</span>
        {rest && <span className="map-legend-caption__rest">{rest}</span>}
        {own.range && <span className="map-legend-custom" data-testid="legend-custom-badge"> · Custom</span>}
        {props.coverageTag && <span className="map-legend-custom" data-testid="legend-coverage-tag"> · {props.coverageTag}</span>}
      </span>
      <span className="map-legend-bar" role="img" aria-label={scale.ariaLabel} data-colours={scale.colours.join(" ")}>
        <RampSatin colours={scale.colours} steps={scale.steps ?? LEGEND_BLOCKS} width={320} height={14} className="map-legend-gradient" />
        {scale.tick && (
          <span
            className="map-legend-tick"
            data-testid="legend-median-tick"
            data-value={scale.tick.value}
            style={{ left: `${(scale.tick.position * 100).toFixed(1)}%` }}
            aria-hidden="true"
          />
        )}
      </span>
      <span className="map-legend-stops" data-testid={scale.testId} ref={stops}>
        {scale.ticks.map((tick, index) => (
          <span key={index} style={{ left: `${(tick.position * 100).toFixed(1)}%` }} data-edge={tick.position === 0 ? "start" : tick.position === 1 ? "end" : undefined}>
            {tick.words && <small className="map-legend-stops__words">{tick.words} </small>}
            {tick.label}
            {tick.more && <small className="map-legend-stops__words">{tick.more}</small>}
          </span>
        ))}
      </span>
      {scale.keys && (
        <span className="map-legend-typical map-legend-keys" data-testid="legend-match-keys">
          {scale.keys.map((key) => (
            <span key={key.kind}>
              <span className={`map-legend-key map-legend-key--${key.kind}`} aria-hidden="true"
                style={{ background: matchHatchSwatch(UNKNOWN_FILL_COLOR, theme) }} />
              {" "}{key.label}
            </span>
          ))}
        </span>
      )}
      {noData && (
        <span className="map-legend-typical map-legend-keys" data-testid="legend-no-data">
          <span>
            <span className="map-legend-key" aria-hidden="true" style={{ background: noDataColour(theme) }} />
            {" "}{NO_DATA_LABEL}
          </span>
        </span>
      )}
      {isWildlifeMetric(props.metric.id) && <span className="map-legend-note" data-testid="legend-wildlife-note">Seen, not absent</span>}
      {topicViewNote(props.metric.id) && <span className="map-legend-note map-legend-view-note" data-testid="legend-view-note">{topicViewNote(props.metric.id)}</span>}
      {props.houseZoom && props.soldRamp && propertyLayersApply(props.metric.id) && <SoldBands ramp={props.soldRamp} compact />}
    </span>
  );
}

/**
 * Tick labels that fit the ramp as drawn (lib/legend-ticks.ts): measured on every resize,
 * the ones that would crowd or collide are hidden (data-fit="hidden"; layout.css keeps their space). A
 * phone's one-line chip lays its ends out inline (no box to measure): nothing is hidden there.
 */
function useFittedTicks(signature: string) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = () => {
      const labels = [...node.children] as HTMLElement[];
      const width = node.getBoundingClientRect().width;
      const inline = getComputedStyle(node).display === "contents";
      const boxes = labels.map((label) => ({ position: Number.parseFloat(label.style.left) / 100 || 0, width: label.offsetWidth }));
      const shown = inline ? labels.map(() => true) : visibleTicks(boxes, width);
      labels.forEach((label, index) => {
        if (shown[index]) delete label.dataset.fit;
        else label.dataset.fit = "hidden";
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [signature]);
  return ref;
}

/** The chip's own ramp for the explainer (layer-explainer.tsx): colours, how to read it and where a value sits. */
export interface LegendRamp {
  colours: string[];
  note: string;
  scaleMode: LegendScaleMode;
  position: (value: number) => number;
}

/** The ramp the chip draws, for the explainer under its "?"; null for a colour square (two counts). */
export function legendRamp(props: MapLegendProps, viewBreaks: readonly number[] | null = null, own: LayerScale = AUTO_SCALE): LegendRamp | null {
  if (props.metric.bivariate) return null;
  const { scale } = describeLegend(props, viewBreaks, own);
  // How to read it in a few words: the direction (both directions on the change scale), and grey.
  const words = scale.note.split(" · ").slice(0, effectiveScaleMode(props.metric.id, props.scaleMode, false) === "change" ? 2 : 1);
  return {
    colours: scale.colours,
    note: [...words, "Grey: no data"].join(" · "),
    scaleMode: effectiveScaleMode(props.metric.id, props.scaleMode, props.stopsOverride !== null),
    position: scale.position,
  };
}

function describeLegend({ metric, period, scaleMode, changeWindow, stopsOverride, median, rankScope }: MapLegendProps,
  breaks: readonly number[] | null = null, own: LayerScale = AUTO_SCALE) {
  const effective = effectiveScaleMode(metric.id, scaleMode, false);
  const range = metric.id === "personal-match" ? null : own.range;
  const scale = range ? customScale(metric, effective, stopsOverride, range)
    : legendScale(metric, effective, stopsOverride, median ?? null, rankScope ?? "London", breaks);
  const caption = effective === "change"
    ? `${legendCaption(metric, null)} · ${changeWindow}-year change to ${mapPeriodLabel(period)}`
    : legendCaption(metric, period);
  return { scale, caption };
}

/**
 * The reader's own range (lib/legend-range.ts): the layer's colours in equal steps between two values, the first
 * colour for anything lower and the last for anything higher ("≤£3k · £6k · £9k+").
 */
function customScale(metric: MapDefinition, scaleMode: LegendScaleMode, stopsOverride: LegendStop[] | null,
  range: readonly [number, number]): LegendScale {
  const stops = scaleMode === "change" ? divergingStops()
    : scaleMode === "percentile" ? percentileStops(metric.legend) : stopsOverride ?? metric.legend;
  const value = (raw: number) => terseValue(raw, scaleMode === "change" ? "%" : metric.unit);
  const [low, high] = range;
  return {
    colours: stops.map((stop) => stop.colour),
    ticks: [
      { position: 0, label: `≤${value(low)}` },
      { position: 0.5, label: value((low + high) / 2) },
      { position: 1, label: `${value(high)}+` },
    ],
    testId: "legend-custom", note: `${scaleDirectionNote(metric.direction)} · Your range, equal steps`,
    ariaLabel: `${metric.label} colour legend, your range ${value(low)} to ${value(high)}`,
    position: (raw) => rangePosition(raw, range) / 100,
  };
}

/** Labels at each stop's place when there are few; the ends and the middle when there are many. */
function stopTicks(stops: readonly { label: string }[]): { position: number; label: string }[] {
  const last = stops.length - 1;
  if (last < 1) return stops.map((stop) => ({ position: 0, label: stop.label }));
  const indexes = stops.length <= 5 ? stops.map((_, index) => index) : [0, Math.round(last / 2), last];
  return indexes.map((index) => ({ position: index / last, label: stops[index].label })).filter((tick) => tick.label);
}

function legendScale(
  metric: MapDefinition,
  scaleMode: LegendScaleMode,
  stopsOverride: LegendStop[] | null,
  median: number | null,
  scope = "London",
  viewBreaks: readonly number[] | null = null,
): LegendScale {
  const note = scaleDirectionNote(metric.direction);
  if (scaleMode === "percentile" && stopsOverride === null && viewBreaks && viewBreaks.length >= 2) {
    // The view's own scale (lib/view-scale.ts): each colour stop at a real value of the areas on screen.
    const last = viewBreaks.length - 1;
    const mid = Math.round(last / 2);
    const value = (index: number) => terseValue(viewBreaks[index], metric.unit);
    return {
      colours: percentileStops(metric.legend).map((stop) => stop.colour),
      ticks: [
        { position: 0, words: "Lowest in view", label: value(0) },
        ...(mid > 0 && mid < last ? [{ position: mid / last, label: value(mid) }] : []),
        { position: 1, words: "Highest", label: value(last) },
      ],
      testId: "legend-percentile", note: `${note} · Each colour an equal share of the areas in view`,
      ariaLabel: `${metric.label} colour legend, lowest to highest in view, ${value(0)} to ${value(last)}`,
      position: (raw) => viewPosition(raw, viewBreaks) / 100,
    };
  }
  if (scaleMode === "change") {
    // Diverging: purple fell, the neutral middle is no change, orange rose; the ±range and colours are fixed.
    return {
      colours: divergingStops().map((stop) => stop.colour),
      ticks: [{ position: 0, label: `−${CHANGE_RANGE_PERCENT}%` }, { position: 0.5, label: "0%" }, { position: 1, label: `+${CHANGE_RANGE_PERCENT}%` }],
      testId: "legend-change",
      note: "▲ orange: prices rose · ▼ purple: prices fell · Same colours whatever the map colours",
      ariaLabel: `${metric.label} price change colour legend`,
      position: (value) => (value + CHANGE_RANGE_PERCENT) / (2 * CHANGE_RANGE_PERCENT),
    };
  }
  if (scaleMode === "percentile" && stopsOverride === null) {
    const stops = percentileStops(metric.legend);
    return {
      colours: stops.map((stop) => stop.colour),
      ticks: [{ position: 0, label: `Lowest in ${scope}` }, { position: 1, label: "Highest" }],
      testId: "legend-percentile", note: `${note} · Coloured by rank in ${scope}`, ariaLabel: `${metric.label} colour legend by rank in ${scope}`,
      position: (value) => value / 100,
    };
  }
  const breaks = (stopsOverride ?? metric.legend).map((stop) => stop.value);
  const stops = stopsOverride ?? metric.legend;
  if (metric.id === "personal-match") {
    // 7 bands by percentile among the scored areas, one block each, least like the search (deep red)
    // to best match (deep blue); an area that fails a Must is hatched (keyed). Per user only.
    const painted = stops.filter((stop) => !isClearColour(stop.colour));
    const last = Math.max(1, painted.length - 1);
    return {
      colours: painted.map((stop) => stop.colour),
      ticks: [{ position: 0, label: "Least like your search" }, { position: 1, label: "Best match" }],
      testId: "legend-match", note: "Coloured by how well each area fits your search · Hatched: fails a Must",
      ariaLabel: "My match colour legend, least like your search to best match",
      keys: [{ kind: "must", label: "fails a Must" }],
      steps: painted.length,
      position: (value) => Math.min(1, Math.max(0, value / last)),
    };
  }
  const range = metric.id === PRICE_METRIC_ID && stopsOverride === null ? stopsRange(stops) : null;
  if (range) {
    // Equal-count breaks fixed for every year, drawn evenly spaced; the tick is
    // this period's London median.
    return {
      colours: stops.map((stop) => stop.colour),
      ticks: stopTicks(stops),
      testId: "legend-price", note: `${note} · Same scale every year, each colour step an equal share of the latest year's areas`,
      ariaLabel: `${metric.label} colour legend, ${rangeLabel(range)}`,
      tick: median === null ? undefined : {
        position: rampPosition(median, stops.map((stop) => stop.value)), value: Math.round(median),
        label: `${scope} typical ${priceLabel(median)}`,
      },
      bands: hueBandRanges(stops),
      position: (value) => rampPosition(value, breaks),
    };
  }
  // Crime: classes from the published breaks (the outlier top capped), and the London-typical rate.
  const crimeTick = metric.id === "crime" && stopsOverride === null && median !== null;
  return {
    colours: stops.map((stop) => stop.colour),
    ticks: stopTicks(stops),
    testId: metric.id === "crime" ? "legend-crime" : undefined, note, ariaLabel: `${metric.label} colour legend`,
    tick: crimeTick ? {
      position: linearRampPosition(median, stops.map((stop) => stop.value)), value: Math.round(median * 10) / 10,
      label: `${scope} typical ${Math.round(median)}`,
    } : undefined,
    position: (value) => linearRampPosition(value, breaks),
  };
}
