/**
 * House-level map: street blocks (parcels merged between OpenStreetMap roads)
 * coloured by their median from zoom 12 (clear without one, so the area fill
 * shows); from 15 a sold home (a parcel-less dwelling, or a parcel of one home)
 * takes the coarse band of its last sale against similar homes sold in its
 * area that year (the tile's `band`, migration 041), and every other home is
 * a clear outline over its area's colour. Pure style definitions and feature
 * helpers so paint rules, hover/selection states and tooltip text are
 * unit-testable; the map component only adds/updates them.
 */
import type { ExpressionSpecification, LayerSpecification, VectorSourceSpecification } from "maplibre-gl";

import type { MapDefinition, MapLayerId } from "./contracts";
import { UNKNOWN_FILL_COLOR } from "./map-legend";
import { formatPerArea } from "./money-format";
import { DEFAULT_PALETTE, paletteById, paletteRamp, sampleRamp } from "./palettes";
import { logColourExpression, PRICE_METRIC_ID } from "./price-scale";
import type { ResolvedTheme } from "./ui-themes";
import { withRelease } from "./release-url";

export const PROPERTY_SOURCE_ID = "properties";
export const BLOCK_FILL_LAYER = "block-fill";
export const BLOCK_OUTLINE_LAYER = "block-outline";
export const PARCEL_FILL_LAYER = "parcel-fill";
export const PARCEL_OUTLINE_LAYER = "parcel-outline";
export const DWELLING_LAYER = "dwelling-point";
export const PROPERTY_LAYER_IDS = [BLOCK_FILL_LAYER, BLOCK_OUTLINE_LAYER, PARCEL_FILL_LAYER, PARCEL_OUTLINE_LAYER, DWELLING_LAYER] as const;
/** Layers a pointer can hover or tap. */
export const INTERACTIVE_LAYER_IDS = [PARCEL_FILL_LAYER, DWELLING_LAYER, BLOCK_FILL_LAYER] as const;
export const BLOCK_MIN_ZOOM = 12;
export const PARCEL_MIN_ZOOM = 15;
export const PROPERTY_TILE_MAX_ZOOM = 16;
export const SELECTED_OUTLINE_COLOUR = "#2f5bd3";
/** Resting parcel outlines and dwelling rings: each theme's --ink, drawn faint. */
export const NEUTRAL_LINE: Readonly<Record<ResolvedTheme, string>> = { day: "#22252c", night: "#f4f7fa" };

/**
 * A sold home's band, low to high (the tile's `band` 0..5): where its last sale
 * sat among same-type sales in its area that year, as the property page words it.
 * Never a percentile or a price.
 */
export const SOLD_BANDS = ["Bottom 10%", "Bottom quarter", "Lower middle", "Upper middle", "Top quarter", "Top 10%"] as const;
export const SOLD_BANDS_LEGEND = "Sold homes: where the last sale sat among similar homes sold here that year";
/** The standard palette's price ramp (cheap is good), one colour per band. */
export const DEFAULT_SOLD_RAMP: readonly string[] = sampleRamp(paletteRamp(paletteById(DEFAULT_PALETTE), PRICE_METRIC_ID), SOLD_BANDS.length);
const CLEAR = "rgba(0, 0, 0, 0)";
const SOLD: ExpressionSpecification = ["!=", ["get", "band"], null];

/**
 * A Land Registry title wider than any one home's plot (m², the tile's `area`,
 * migration 046): beyond the largest 0.2% of one-home parcels (London sample,
 * Oct 2026: p99 ≈ 1,080 m², p99.5 ≈ 1,520 m², p99.8 ≈ 2,570 m²). Some titles
 * cover a whole estate.
 */
export const SHARED_PARCEL_AREA = 2500;
/**
 * A parcel that is more than one home's plot: several homes on it, or a title
 * over SHARED_PARCEL_AREA. Hovering or choosing a home there never fills it
 * (the estate would light up); it keeps a faint outline and the chosen home is
 * marked on its own. A tile without `area` (before migration 046) reads as small.
 */
export const SHARED_PARCEL: ExpressionSpecification = ["any",
  [">", ["to-number", ["get", "dwellings"]], 1],
  [">", ["to-number", ["get", "area"]], SHARED_PARCEL_AREA]];

/** What paints the homes: the chosen palette's six price colours and the UI theme. */
export interface HomePaint {
  ramp: readonly string[];
  theme: ResolvedTheme;
}
const DEFAULT_HOME_PAINT: HomePaint = { ramp: DEFAULT_SOLD_RAMP, theme: "day" };

/** Verbatim statements the INSPIRE licence requires wherever parcels are shown. */
export const PROPERTY_ATTRIBUTION =
  "This information is subject to Crown copyright and database rights 2026 and is reproduced with the "
  + "permission of HM Land Registry. The polygons (including the associated geometry, namely x, y co-ordinates) "
  + "are subject to Crown copyright and database rights 2026 Ordnance Survey 100026316. "
  + "Contains OS data © Crown copyright and database right 2026.";

/** One-line form for tight spaces; the full statement stays one tap away. */
export const PROPERTY_ATTRIBUTION_SHORT = "Land outlines © Crown copyright 2026 HM Land Registry · OS 100026316";

/** The one layer whose homes the property map colours (stock value is merged into it). */
export function propertyLayersApply(layer: MapLayerId): boolean {
  return layer === PRICE_METRIC_ID;
}

/** Whether parcels (and their licence statements) are on screen. */
export function parcelsShown(layer: MapLayerId, zoom: number): boolean {
  return propertyLayersApply(layer) && zoom >= PARCEL_MIN_ZOOM;
}

/** Whether street blocks are on screen. */
export function blocksShown(layer: MapLayerId, zoom: number): boolean {
  return propertyLayersApply(layer) && zoom >= BLOCK_MIN_ZOOM && zoom < PARCEL_MIN_ZOOM;
}

export function propertySource(origin: string, release?: string | null): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [withRelease(`${origin}/api/v1/tiles/properties/{z}/{x}/{y}.pbf`, release)],
    minzoom: BLOCK_MIN_ZOOM,
    maxzoom: PROPERTY_TILE_MAX_ZOOM,
    // The licence statements are rendered verbatim by the map toolbar while
    // parcels are on screen; a source attribution would only crowd the control.
  };
}

/**
 * Street blocks on the price legend's log axis by the median £/m² of their
 * homes (`ppm`, only over three or more); fewer homes are grey. Homes never
 * get a colour of their own: no figure for one home (owner decision).
 */
export function blockColour(metric: MapDefinition): ExpressionSpecification {
  const value = ["get", "ppm"];
  return [
    "case",
    ["==", value, null], UNKNOWN_FILL_COLOR,
    logColourExpression(value, metric.legend),
  ] as unknown as ExpressionSpecification;
}

const HOVER: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];
const SELECTED: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];

function byState<T>(selected: T, hover: T, base: T): ExpressionSpecification {
  return ["case", SELECTED, selected, HOVER, hover, base] as ExpressionSpecification;
}

/** A band (0 = bottom 10% … 5 = top 10%) to its colour on the ramp; anything else is clear. */
export function soldBandColour(ramp: readonly string[]): ExpressionSpecification {
  return ["match", ["to-number", ["get", "band"]], ...ramp.flatMap((colour, band) => [band, colour]), CLEAR] as unknown as ExpressionSpecification;
}

/**
 * The paint that follows the palette and the theme: a sold home in its band's
 * colour (cobalt only as the hover or choice tint of an unsold one); outlines
 * and rings a faint ink until hovered or chosen.
 */
export function homePaint({ ramp, theme }: HomePaint) {
  const band = soldBandColour(ramp);
  const line = byState(SELECTED_OUTLINE_COLOUR, SELECTED_OUTLINE_COLOUR, NEUTRAL_LINE[theme]);
  return {
    [PARCEL_FILL_LAYER]: { "fill-color": ["case", SOLD, band, SELECTED_OUTLINE_COLOUR] as ExpressionSpecification },
    [PARCEL_OUTLINE_LAYER]: { "line-color": line },
    [DWELLING_LAYER]: {
      "circle-color": ["case", SOLD, band, SELECTED_OUTLINE_COLOUR] as ExpressionSpecification,
      "circle-stroke-color": line,
    },
  };
}

/**
 * A street block's fill (street zoom drowned in solid colour on a phone, where a small area opens
 * below zoom 15 and blocks cover it): near full strength while blocks are small (zoom 12), a tint like the
 * area fill's (STREET_FILL_SCALE) by street zoom 15, so streets, houses and places read through it; the
 * outline (BLOCK_OUTLINE_LAYER) keeps each block's colour. A block without a median is clear.
 */
export const BLOCK_FILL_STRENGTH = 0.85;
export function blockFillOpacity(): ExpressionSpecification {
  const at = (strength: number): ExpressionSpecification => ["case", ["==", ["get", "ppm"], null], 0, strength];
  return ["interpolate", ["linear"], ["zoom"],
    BLOCK_MIN_ZOOM, at(BLOCK_FILL_STRENGTH), 13.5, at(0.6), PARCEL_MIN_ZOOM, at(STREET_FILL_SCALE)];
}

export function propertyLayers(metric: MapDefinition, home: HomePaint = DEFAULT_HOME_PAINT): LayerSpecification[] {
  const paint = homePaint(home);
  return [
    {
      id: BLOCK_FILL_LAYER, type: "fill", source: PROPERTY_SOURCE_ID, "source-layer": "blocks",
      minzoom: BLOCK_MIN_ZOOM, maxzoom: PARCEL_MIN_ZOOM,
      // A block without a median (under three homes) is clear: the area fill under it shows.
      paint: { "fill-color": blockColour(metric), "fill-opacity": blockFillOpacity() },
    },
    {
      // Its edge in its own colour: the block still reads once its fill is a tint, by Day and
      // Night alike; hovering thickens it (feature-state cannot sit inside the fill's zoom curve).
      id: BLOCK_OUTLINE_LAYER, type: "line", source: PROPERTY_SOURCE_ID, "source-layer": "blocks",
      minzoom: BLOCK_MIN_ZOOM, maxzoom: PARCEL_MIN_ZOOM,
      paint: {
        "line-color": blockColour(metric),
        "line-opacity": ["case", ["==", ["get", "ppm"], null], 0, 0.9],
        "line-width": ["case", HOVER, 2.5, 1.2],
      },
    },
    {
      id: PARCEL_FILL_LAYER, type: "fill", source: PROPERTY_SOURCE_ID, "source-layer": "parcels",
      minzoom: PARCEL_MIN_ZOOM,
      // A sold home in its band; any other is clear (its area's colour), tinted when hovered or
      // chosen. A parcel wider than one home never brightens or tints: the whole title would light up.
      paint: {
        ...paint[PARCEL_FILL_LAYER],
        "fill-opacity": ["case",
          SHARED_PARCEL, ["case", SOLD, 0.8, 0],
          SOLD, byState(0.95, 0.95, 0.8), byState(0.35, 0.2, 0)],
      },
    },
    {
      id: PARCEL_OUTLINE_LAYER, type: "line", source: PROPERTY_SOURCE_ID, "source-layer": "parcels",
      minzoom: PARCEL_MIN_ZOOM,
      paint: {
        ...paint[PARCEL_OUTLINE_LAYER],
        // A shared title is only outlined faintly when hovered or chosen; a home's plot gets the full ring.
        "line-opacity": ["case", SHARED_PARCEL, byState(0.75, 0.6, 0.3), byState(1, 0.9, 0.3)],
        "line-width": ["case", SHARED_PARCEL, byState(1.4, 1.2, 0.6), byState(3, 1.6, 0.6)],
      },
    },
    {
      id: DWELLING_LAYER, type: "circle", source: PROPERTY_SOURCE_ID, "source-layer": "dwellings",
      minzoom: PARCEL_MIN_ZOOM,
      paint: {
        ...paint[DWELLING_LAYER],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 3, 18, 7],
        "circle-stroke-width": byState(3, 2, 0.8),
        "circle-opacity": ["case", SOLD, byState(1, 1, 0.9), byState(0.9, 0.6, 0)],
      },
    },
  ];
}

export const AREA_FADE_ZOOM = 12;

/**
 * Whether the area fill steps back to a fifth: only under sale pins and cells
 * from zoom 12, which carry their own colour. Street blocks and homes keep it
 * at strength, so a block without a median and a home without a sale show
 * their area's colour.
 */
export function areaFadedUnderHouses(zoom: number, house: { sales: boolean }): boolean {
  return zoom >= AREA_FADE_ZOOM && house.sales;
}

/**
 * The fill at a fifth while houses carry the colour, but still as context.
 * MapLibre accepts zoom only on the outside of an expression with feature-state
 * terms: opacityOverZoom puts the zoom around this one.
 */
export const HOUSE_FADED_FILL = 0.2;
export function areaFillOpacityWithParcels(base: ExpressionSpecification, faded: boolean): ExpressionSpecification {
  return faded ? (["*", HOUSE_FADED_FILL, base] as ExpressionSpecification) : base;
}

export interface DwellingFeature {
  uprn: string;
  addressId: string | null;
}

/** The dwelling a parcel or point click refers to; null when the feature carries no dwelling. */
export function dwellingFromFeature(properties: Record<string, unknown> | undefined): DwellingFeature | null {
  const uprn = properties?.uprn;
  if (typeof uprn !== "string" && typeof uprn !== "number") return null;
  const addressId = properties?.address_id;
  return { uprn: String(uprn), addressId: typeof addressId === "string" ? addressId : null };
}

export interface HoverTarget {
  sourceLayer: "blocks" | "parcels" | "dwellings";
  id: string | number;
}

/** Identifies a hovered feature for feature-state; null when it cannot be addressed. */
export function hoverTarget(layer: string, id: string | number | undefined): HoverTarget | null {
  if (id === undefined || id === null) return null;
  const sourceLayer = layer === BLOCK_FILL_LAYER ? "blocks" : layer === DWELLING_LAYER ? "dwellings" : "parcels";
  return { sourceLayer, id };
}

/**
 * Tooltip lines for a hovered feature. Blocks summarise their homes; a sold
 * parcel or dwelling names the address when the tile carries it (zoom 16+), the
 * year of its last sale and its band in words. Never a value today, and never a
 * home's £/m² (the tile has none while the EPC licence is pending).
 */
export function tooltipLines(layer: string, properties: Record<string, unknown> | undefined, unit: string): string[] {
  if (!properties) return [];
  if (layer === BLOCK_FILL_LAYER) {
    // A block is a summary, never a target: a click selects the area under it, so the
    // tooltip says how to reach the homes instead of zooming there.
    const ppm = properties.ppm == null ? NaN : Number(properties.ppm);
    const dwellings = Number(properties.dwellings) || 0;
    const homes = `${dwellings} ${dwellings === 1 ? "home" : "homes"}`;
    return [Number.isFinite(ppm) ? `${homes} · median ${formatPerArea(ppm, unit)}` : `${homes} · too few for a median`, "Zoom in to see homes"];
  }
  const year = typeof properties.latest_sale === "string" ? properties.latest_sale.slice(0, 4) : null;
  if (!year) return [];
  const address = typeof properties.address === "string" ? properties.address : null;
  const dwellings = Number(properties.dwellings) || 1;
  const head = address ?? (dwellings > 1 ? `${dwellings} dwellings on this parcel` : "Dwelling");
  const band = properties.band == null ? null : SOLD_BANDS[Number(properties.band)];
  // A title wider than any home's plot: the pointer may be streets away from the home itself.
  const wide = Number(properties.area) > SHARED_PARCEL_AREA
    ? [dwellings > 1 ? "Outline: their land title, wider than the homes" : "Outline: its land title, wider than the home"] : [];
  return [head, dwellings > 1 ? `Latest sale here ${year}` : `Sold ${year}`,
    ...(band ? [`${band} of similar homes sold here that year`] : []), ...wide];
}

/**
 * Zoomed in, the map itself matters more than the area's colour: the fill keeps
 * its full strength to zoom 12, then steps back to a tint (40%) by street zoom 15,
 * so streets, houses and places read through it while the colour still says which
 * area (at 60% from zoom 17 only, street zoom drowned in solid colour).
 */
export const STREET_FILL_SCALE = 0.4;
export function zoomFillScale(zoom: number): number {
  if (zoom <= 12) return 1;
  if (zoom >= 15) return STREET_FILL_SCALE;
  return 1 - (zoom - 12) / 3 * (1 - STREET_FILL_SCALE);
}

/**
 * The share of its strength the area fill keeps: the strongest of the zoom step-back and the
 * layer's own fades (a colour square's translucency, places on top), never their product, so
 * at street zoom every layer's colour stays readable.
 */
export function areaFillFade(zoom: number, fades: number[]): number {
  return Math.min(zoomFillScale(zoom), ...fades);
}

/**
 * `base` scaled by `scaleAt(zoom)` for every zoom, in one expression (zoom on the outside, as MapLibre requires), so
 * the fill's opacity is set once rather than on each zoomend. A changed data-driven paint property makes MapLibre lay
 * the source's tiles out again and drop the tiles it keeps for zooming back, which then load again
 * (perf/layer-load/README.md, repeat visit). Sampled at each step's zoom (a hair before it too, for steps such as
 * `zoom >= 14`) and every quarter zoom between `from` and `to` (where the fade is a slope); straight runs collapse.
 */
export function opacityOverZoom(base: ExpressionSpecification, scaleAt: (zoom: number) => number, steps: number[],
  from = 12, to = 15): ExpressionSpecification | number {
  const zooms = new Set<number>([0, 24]);
  for (let zoom = from; zoom <= to; zoom += 0.25) zooms.add(zoom);
  for (const step of steps) {
    zooms.add(step);
    zooms.add(Math.round((step - 0.01) * 100) / 100);
  }
  const sampled = [...zooms].sort((a, b) => a - b).map((zoom) => [zoom, Math.round(scaleAt(zoom) * 1000) / 1000] as const);
  // Keep a stop only where the scale bends: a point on the line between its neighbours adds nothing.
  const stops = sampled.filter(([zoom, scale], index) => {
    if (index === 0 || index === sampled.length - 1) return true;
    const [z0, s0] = sampled[index - 1];
    const [z1, s1] = sampled[index + 1];
    return Math.abs(s0 + (s1 - s0) * (zoom - z0) / (z1 - z0) - scale) > 1e-6;
  });
  const scaled = (scale: number) => (scale === 0 ? 0 : scale === 1 ? base : ["*", scale, base] as ExpressionSpecification);
  if (stops.every(([, scale]) => scale === stops[0][1])) return scaled(stops[0][1]);
  return ["interpolate", ["linear"], ["zoom"], ...stops.flatMap(([zoom, scale]) => [zoom, scaled(scale)])] as ExpressionSpecification;
}
