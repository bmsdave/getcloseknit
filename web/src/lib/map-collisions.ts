/**
 * The Road collisions overlay ("Show on map"): everyone hurt in a London road collision in the last
 * five years, from DfT STATS19 (GET /api/v1/tiles/collisions, migration 065).
 * - Zoomed out: one continuous warm heat map, casualties weighted by severity (fatal 10,
 *   serious 3, slight 1), normalised by zoom so London's busiest corridors reach the top colour at every
 *   zoom; it fades out by 14.5.
 * - From street zoom (variant C "Who was hurt"): one burst per casualty filled with its
 *   severity colour, the road user drawn in white on it; severity is size and outline too (fatal 24 px
 *   with a dark outline, serious 20, slight 16; the road user at 14 px is 8 px and could not be made out). An invisible
 *   32 px circle under each, plus 8 px of slop, takes the taps.
 *
 * Filters run in the browser on the tile's fields: children and who was hurt everywhere; severity as the
 * heat's weights and the bursts' filter; year and light at street zoom, where each burst is one casualty.
 * The tiles never carry a date, a time or a sex: a child at an exact point on a known day can identify a family.
 */
import type { ExpressionSpecification, FilterSpecification, LayerSpecification, VectorSourceSpecification } from "maplibre-gl";
import { putImage, rasterise, type MapImage } from "./map-yarn-images";
import { withRelease } from "./release-url";

export const COLLISION_SOURCE_ID = "collisions";
export const COLLISION_HEAT_LAYER = "collision-heat";
/** Invisible tap targets (≥ 32 px) under the bursts; the popup reads these. */
export const COLLISION_HIT_LAYER = "collision-point";
export const COLLISION_MARKER_LAYER = "collision-marker";
export const COLLISION_LAYERS = [COLLISION_HEAT_LAYER, COLLISION_HIT_LAYER, COLLISION_MARKER_LAYER] as const;
export const COLLISION_MIN_ZOOM = 10;
/** Where the bursts take over from the heat (year and light apply from here). */
export const COLLISION_POINT_ZOOM = 14;
/** The heat is gone and the bursts are fully in. */
export const COLLISION_HANDOVER_ZOOM = 14.5;
/**
 * The area fill steps back to this share of its strength while the heat shows (below the handover): the warm
 * heat over a warm area colour (Price per m²'s top classes) could not be told apart (marker audit).
 */
export const COLLISION_AREA_FADE = 0.35;
const COLLISION_TILE_MAX_ZOOM = 16;

export const COLLISION_ATTRIBUTION = "Road collisions: DfT STATS19, last five years (Open Government Licence v3.0)";

export const ROAD_USERS = [
  { id: "pedestrian", label: "Walking" },
  { id: "cyclist", label: "Cycling" },
  { id: "escooter", label: "E-scooter" },
  { id: "motorcycle", label: "Motorcycle" },
  { id: "car", label: "Car" },
  { id: "bus", label: "Bus" },
  { id: "goods", label: "Van or lorry" },
  { id: "other", label: "Other" },
] as const;
export type RoadUser = (typeof ROAD_USERS)[number]["id"];

// Yarn colours (DESIGN.md): fatal cherry, serious tangerine, slight sun. STATS19's own words: Fatal, Serious, Slight.
// Tangerine means collisions only: cycle lanes are sky.
// `weight` is each casualty's weight in the heat map (the "?" says the same); `px` the burst's size.
export const SEVERITIES = [
  { id: 1, label: "Fatal", colour: "#e2453c", weight: 10, px: 24 },
  { id: 2, label: "Serious", colour: "#f28b30", weight: 3, px: 20 },
  { id: 3, label: "Slight", colour: "#f6c445", weight: 1, px: 16 },
] as const;

export const COLLISION_YEARS = [2021, 2022, 2023, 2024, 2025] as const;

/** DfT's road safety open data (STATS19). police.uk has no page per collision, so there is no deep link. */
export const STATS19_URL = "https://www.gov.uk/government/statistical-data-sets/road-safety-open-data";

/** Who was hurt, in the popup's words: the tiles say how they travelled, never whether they drove. */
const WHO: Record<RoadUser, string> = {
  pedestrian: "Pedestrian", cyclist: "Cyclist", escooter: "E-scooter rider", motorcycle: "Motorcyclist",
  car: "In a car", bus: "On a bus", goods: "In a van or lorry", other: "Other road user",
};

/** One casualty as the street-zoom tile carries it (year, severity, road user, child, dark). */
export interface CollisionRecord {
  severity: 1 | 2 | 3;
  label: string;
  year: number | null;
  who: string;
  dark: boolean;
}

export function collisionRecord(properties: Record<string, unknown>): CollisionRecord | null {
  const severity = SEVERITIES.find((entry) => entry.id === Number(properties.severity));
  if (!severity) return null;
  const user = String(properties.road_user ?? "other") as RoadUser;
  const year = Number(properties.year);
  return {
    severity: severity.id, label: severity.label,
    year: Number.isFinite(year) && year > 0 ? year : null,
    who: `${WHO[user] ?? WHO.other}${properties.child === true || properties.child === "true" ? " · child 0–15" : ""}`,
    dark: properties.dark === true || properties.dark === "true",
  };
}

/** The popup over the dots under the pointer: one casualty, or a stack (count, and Zoom in until street level). */
export type CollisionPopup =
  | { kind: "one"; record: CollisionRecord }
  | { kind: "many"; count: number; zoomIn: boolean; records: CollisionRecord[] };

/** Zoomed in this far, dots still on one spot are one place: the popup lists them instead of Zoom in. */
export const COLLISION_LIST_ZOOM = 17;
const LISTED = 4;

export function collisionPopup(features: readonly Record<string, unknown>[], zoom: number): CollisionPopup | null {
  const records = features.map(collisionRecord).filter((record): record is CollisionRecord => record !== null)
    .sort((a, b) => a.severity - b.severity);
  if (records.length === 0) return null;
  if (records.length === 1) return { kind: "one", record: records[0] };
  const zoomIn = zoom < COLLISION_LIST_ZOOM;
  return { kind: "many", count: records.length, zoomIn, records: zoomIn ? [] : records.slice(0, LISTED) };
}

/** A record on one line: "Serious · 2023 · Dark". */
export function collisionRecordLine(record: CollisionRecord): string {
  return [record.label, record.year, record.dark ? "Dark" : null].filter((part) => part !== null).join(" · ");
}

/** The hover peek over the dots (the map tooltip): a casualty, or how many and the first few. */
export function collisionPeekLines(content: CollisionPopup | null): string[] {
  if (!content) return [];
  if (content.kind === "one") return [collisionRecordLine(content.record), content.record.who];
  return [`${content.count} people hurt here`, ...content.records.map((record) => `${collisionRecordLine(record)} · ${record.who}`)];
}

export type CollisionLight = "any" | "dark" | "day";

export interface CollisionView {
  children: boolean;
  users: readonly RoadUser[];
  severities: readonly number[];
  years: readonly number[];
  light: CollisionLight;
}

export const DEFAULT_COLLISION_VIEW: CollisionView = {
  children: false,
  users: ROAD_USERS.map((user) => user.id),
  severities: SEVERITIES.map((severity) => severity.id),
  years: [...COLLISION_YEARS],
  light: "any",
};

/** A map link with the collisions overlay on (e.g. from a home's Safety section; map-setup's
 * collisionsFromQuery reads `on` as the default filters). */
export function withCollisionsOn(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}collisions=on`;
}

export function collisionSource(origin: string, release?: string | null): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [withRelease(`${origin}/api/v1/tiles/collisions/{z}/{x}/{y}.pbf`, release)],
    minzoom: COLLISION_MIN_ZOOM,
    maxzoom: COLLISION_TILE_MAX_ZOOM,
    attribution: COLLISION_ATTRIBUTION,
  };
}

/** Children and who: fields every tile carries (the heat; severity is its weights). */
export function collisionHeatFilter(view: CollisionView): FilterSpecification {
  return ["all",
    ...(view.children ? [["==", ["get", "child"], true] as ExpressionSpecification] : []),
    ["in", ["get", "road_user"], ["literal", [...view.users]]],
  ] as FilterSpecification;
}

/** Children, who and severity: the street-zoom casualties. */
export function collisionFilter(view: CollisionView): FilterSpecification {
  return [...(collisionHeatFilter(view) as unknown[]),
    ["in", ["get", "severity"], ["literal", [...view.severities]]],
  ] as FilterSpecification;
}

/** The street-zoom dots also carry year and light. */
export function collisionPointFilter(view: CollisionView): FilterSpecification {
  const light: ExpressionSpecification[] = view.light === "dark" ? [["==", ["get", "dark"], true]]
    : view.light === "day" ? [["==", ["get", "dark"], false]] : [];
  return ["all", collisionFilter(view) as ExpressionSpecification,
    ["in", ["get", "year"], ["literal", [...view.years]]], ...light] as FilterSpecification;
}

/** Whether the street-only filters (year, light) narrow anything. */
export function streetOnlyFilters(view: CollisionView): boolean {
  return view.light !== "any" || view.years.length !== COLLISION_YEARS.length;
}

export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

// Each choice's share of London's 127,875 casualties in 2021-25 (STATS19), to keep a narrow selection visible.
const USER_SHARE: Record<RoadUser, number> = {
  car: 0.34, motorcycle: 0.218, cyclist: 0.201, pedestrian: 0.173, bus: 0.039, goods: 0.017, escooter: 0.0104, other: 0.0024,
};
// Severity's share of the heat (casualties × weight: 0.38% fatal × 10, 14.45% serious × 3, 85.17% slight × 1).
const SEVERITY_SHARE: Record<number, number> = { 1: 0.0287, 2: 0.3276, 3: 0.6437 };
const CHILD_SHARE = 0.059;

/** Roughly what share of the heat the view keeps (choices treated as independent). */
export function collisionSelectionShare(view: CollisionView): number {
  const users = view.users.reduce((sum, user) => sum + USER_SHARE[user], 0);
  const severities = view.severities.reduce((sum, severity) => sum + (SEVERITY_SHARE[severity] ?? 0), 0);
  return users * severities * (view.children ? CHILD_SHARE : 1);
}

/**
 * Heat intensity by zoom: a casualty's share of the screen shrinks four times per zoom level, so the
 * intensity grows four times per level (busiest corridors reach the top colour at every zoom, not only
 * zoomed in), and it is raised as the view narrows, so "children only" or "fatal" still shows where they cluster.
 */
export function collisionHeatIntensity(view: CollisionView): ExpressionSpecification {
  // Softened (power 0.8) so a narrow selection shows its clusters without every lone casualty glowing.
  const scale = (1 / Math.max(collisionSelectionShare(view), 0.02)) ** 0.8;
  const top = 1.5 * scale;
  return ["interpolate", ["exponential", 4], ["zoom"], 10, top / 4 ** 4, 14, top];
}

/** Casualties of one severity in a feature: a grid cell's n1 / n2 / n3, or a single casualty (z13+). */
function severityCount(id: number): ExpressionSpecification {
  return ["coalesce", ["get", `n${id}`], ["case", ["==", ["get", "severity"], id], ["coalesce", ["get", "n"], 1], 0]];
}

/** The heat's weight: casualties × severity weight, for the severities picked (none picked: no heat). */
export function collisionHeatWeight(view: CollisionView): ExpressionSpecification | number {
  const terms = SEVERITIES.filter((severity) => view.severities.includes(severity.id))
    .map((severity) => ["*", severity.weight, severityCount(severity.id)] as ExpressionSpecification);
  if (terms.length === 0) return 0;
  return terms.length === 1 ? terms[0] : ["+", ...terms] as ExpressionSpecification;
}

/** The heat's ramp: transparent → amber → red → deep red; the layer's opacity caps it at 0.75. */
export const COLLISION_HEAT_RAMP = ["rgba(242,163,58,0)", "#f2a33a", "#f28b30", "#e2453c", "#9b1c1c"] as const;

// ---- Street-zoom bursts (variant C) -----------------------------------------------------------

/** The road user drawn on a burst: the most vulnerable reading of how they travelled. */
export type CollisionGlyph = "walk" | "bike" | "car" | "moto";
const GLYPH_OF: Record<RoadUser, CollisionGlyph> = {
  pedestrian: "walk", cyclist: "bike", escooter: "bike", motorcycle: "moto", car: "car", bus: "car", goods: "car", other: "car",
};
export const COLLISION_GLYPHS: readonly CollisionGlyph[] = ["walk", "bike", "moto", "car"];
export const COLLISION_GLYPH_LABEL: Record<CollisionGlyph, string> = { walk: "pedestrian", bike: "cyclist", moto: "motorcyclist", car: "car occupant" };
/** Placement order among bursts: worse first, then the more vulnerable. */
const GLYPH_RANK: Record<CollisionGlyph, number> = { walk: 0, bike: 1, moto: 2, car: 3 };

export function collisionGlyph(roadUser: string): CollisionGlyph {
  return GLYPH_OF[roadUser as RoadUser] ?? "car";
}

export function collisionIconId(severity: number, glyph: CollisionGlyph): string {
  return `collision-${severity}-${glyph}`;
}

const BURST = "M12.00 0.50 L14.57 4.95 L19.39 3.19 L18.50 8.25 L23.33 10.00 L19.39 13.30 L21.96 17.75 L16.82 17.75 L15.93 22.81 "
  + "L12.00 19.50 L8.07 22.81 L7.18 17.75 L2.04 17.75 L4.61 13.30 L0.67 10.00 L5.50 8.25 L4.61 3.19 L9.43 4.95Z";
const GLYPH_MARKUP: Record<CollisionGlyph, string> = {
  walk: `<circle cx="12.5" cy="5.5" r="2"/><path d="M12 8.5 10.5 14l3 2.5V21M10.5 14 8 21M11.5 10.5l3.5 2.5 2.5-.5M11.5 10.5 8 12.5"/>`,
  bike: `<circle cx="6.5" cy="15.5" r="3.6"/><circle cx="17.5" cy="15.5" r="3.6"/><path d="M6.5 15.5 10 8.5h5l2.5 7M10 8.5 12.5 15.5M14 6h2.5"/>`,
  moto: `<circle cx="6" cy="16" r="3.4"/><circle cx="18" cy="16" r="3.4"/><path d="M6 16h6l3-6h3M9.5 10h4"/>`,
  car: `<path d="M4 15.5v-3l2-4.5h12l2 4.5v3Z"/><circle cx="8" cy="16.5" r="1.6"/><circle cx="16" cy="16.5" r="1.6"/>`,
};

/**
 * A burst on a 24-unit grid (board V4-04, refined C): filled with the severity colour all the way (no white
 * core), the road user in white with a soft dark edge; fatal has a dark outline, the rest a white one with a
 * thin dark rim outside it (a sun burst with a white edge on the snow Day map was 1.5:1).
 */
export function collisionIconMarkup(severity: 1 | 2 | 3, glyph: CollisionGlyph): string {
  const { colour } = SEVERITIES[severity - 1];
  const [edge, width] = severity === 1 ? ["#22252c", 1.6] : ["#ffffff", 1.4];
  const strands = GLYPH_MARKUP[glyph];
  const rim = severity === 1 ? "" : `<path d="${BURST}" fill="none" stroke="#22252c" stroke-opacity="0.6" stroke-width="${width + 1.1}" stroke-linejoin="round"/>`;
  // A little inside the 24-unit grid, so the rim's tips are not cut off.
  return `<g transform="translate(12 12) scale(0.95) translate(-12 -12)">${rim}`
    + `<path d="${BURST}" fill="${colour}" stroke="${edge}" stroke-width="${width}" stroke-linejoin="round"/>`
    + `<g transform="translate(12 12) scale(0.6) translate(-12 -12)" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<g stroke="#22252c" stroke-width="4.2" stroke-opacity="0.55">${strands}</g><g stroke="#ffffff" stroke-width="2.6">${strands}</g></g></g>`;
}

type ImageMap = Parameters<typeof putImage>[0];

/** Adds the 12 bursts (3 severities × 4 road users) at their own sizes; resolves once all are in. */
export async function addCollisionIcons(map: ImageMap, pixelRatio: number): Promise<void> {
  const ratio = Math.max(1, Math.ceil(pixelRatio));
  await Promise.all(SEVERITIES.flatMap((severity) => COLLISION_GLYPHS.map(async (glyph) => {
    const id = collisionIconId(severity.id, glyph);
    if (map.hasImage(id)) return;
    const image: MapImage | null = await rasterise(collisionIconMarkup(severity.id, glyph), 24, ratio * (severity.px / 24));
    if (image && !map.hasImage(id)) putImage(map, id, image, ratio);
  })));
}

const glyphExpression: ExpressionSpecification = ["match", ["get", "road_user"],
  "pedestrian", "walk", ["cyclist", "escooter"], "bike", "motorcycle", "moto", "car"];
const glyphRank: ExpressionSpecification = ["match", ["get", "road_user"],
  "pedestrian", GLYPH_RANK.walk, ["cyclist", "escooter"], GLYPH_RANK.bike, "motorcycle", GLYPH_RANK.moto, GLYPH_RANK.car];

export function collisionLayers(view: CollisionView): LayerSpecification[] {
  const common = { source: COLLISION_SOURCE_ID, "source-layer": "collisions" };
  const [low, top] = [COLLISION_HEAT_RAMP[0], COLLISION_HEAT_RAMP[4]];
  return [
    { ...common, id: COLLISION_HEAT_LAYER, type: "heatmap", minzoom: COLLISION_MIN_ZOOM, maxzoom: 15, filter: collisionHeatFilter(view),
      paint: {
        "heatmap-weight": collisionHeatWeight(view),
        "heatmap-intensity": collisionHeatIntensity(view),
        // At least 1.6 × the grid's on-screen spacing (tile / 128 = 4 px), so cells merge into corridors.
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 12, 12, 14, 13, 16, 14, 18],
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
          0, low, 0.08, COLLISION_HEAT_RAMP[1], 0.35, COLLISION_HEAT_RAMP[2], 0.7, COLLISION_HEAT_RAMP[3], 1, top],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], COLLISION_POINT_ZOOM, 0.75, COLLISION_HANDOVER_ZOOM, 0],
      } },
    { ...common, id: COLLISION_HIT_LAYER, type: "circle", minzoom: COLLISION_POINT_ZOOM, filter: collisionPointFilter(view),
      paint: { "circle-radius": 16, "circle-opacity": 0, "circle-stroke-width": 0 } },
    { ...common, id: COLLISION_MARKER_LAYER, type: "symbol", minzoom: COLLISION_POINT_ZOOM, filter: collisionPointFilter(view),
      layout: {
        "icon-image": ["concat", "collision-", ["to-string", ["get", "severity"]], "-", glyphExpression],
        // Bursts give way to school caps and stations placed before them, never hide labels or each other;
        // the worst and the most vulnerable are drawn on top.
        "icon-allow-overlap": false,
        "icon-ignore-placement": true,
        "icon-padding": 0,
        "symbol-sort-key": ["+", ["*", 10, ["-", 4, ["get", "severity"]]], ["-", 3, glyphRank]],
      },
      paint: { "icon-opacity": ["interpolate", ["linear"], ["zoom"], COLLISION_POINT_ZOOM, 0, COLLISION_HANDOVER_ZOOM, 1] } },
  ];
}
