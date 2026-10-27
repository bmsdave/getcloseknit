/**
 * The whole map setup on this device. The map keeps its setup as a query string (the
 * address it writes, lib/map-state.ts + the Show and scale helpers) and saves the same string under
 * SAVED_MAP_STATE_KEY on every change. On every return to the map (logo, "Map →", back, a bare "/")
 * mergeMapSetup builds the setup to open with, per param: a link's own params win for what they set,
 * the saved setup fills the rest, and the defaults fill what neither says.
 *
 * This module adds the Show sub-filters the address did not carry yet: cycle lanes (?cycle=on), road
 * collisions and their filters (?collisions=on or a JSON of what differs from the defaults), recent
 * sales and theirs (?sales=…, the same way) and the crime categories turned off (?crime-off=a,b).
 * Old saved strings stay readable (absent params are defaults), so the key is not bumped.
 */
import type { LegendScaleMode } from "./legend-scale";
import { COLLISION_YEARS, DEFAULT_COLLISION_VIEW, ROAD_USERS, SEVERITIES, type CollisionLight, type CollisionView, type RoadUser } from "./map-collisions";
import { DEFAULT_PLACE_VIEW, placesFromQuery, type PlaceView } from "./map-place-layers";
import { GROWTH_YEARS, PROPERTY_TYPES, type SaleView } from "./map-sale-layers";
import { DEFAULT_SCHOOL_FILTER, isDefaultSchoolFilter, type SchoolFilter } from "./map-school-layer";
import { DEFAULT_SHOWS, showsFromQuery, type MapShows } from "./map-shows";
import { SAVED_MAP_STATE_KEY } from "./map-state";

export { SAVED_MAP_STATE_KEY as MAP_SETUP_KEY };

/** Params a link sets as one group: a layer named by a link brings its own view and period. */
const LAYER_GROUP = ["layer", "period", "scale", "window", "crime-off", "colours", "range", "scope"] as const;
/** The camera; a link naming an area but no position fits that area, so `selected` claims it too. */
const CAMERA_GROUP = ["lat", "lng", "zoom", "bearing"] as const;
/** Show's items, each on its own: a link that turns schools on keeps the saved places. */
const SHOW_PARAMS = ["places", "stations", "mine", "trees", "cycle", "collisions", "sales"] as const;
/** Schools and their filters go together: a link that names any of them sets all three. */
const SCHOOL_GROUP = ["schools", "ofsted", "top10", "alevel"] as const;
/** Never taken from the saved setup: what to select is the link's (a bare "/" opens with no area). */
const LINK_ONLY = ["selected", "uprn", "address"] as const;

/**
 * The setup to open the map with: `link` is the address's query (with or without "?"), `saved` the
 * string saved on this device (null when none). Mode, release and pitch are left to their own rules
 * (adoptSavedState, the 2D/3D choice). Returns a query string without "?".
 */
export function mergeMapSetup(link: string, saved: string | null): string {
  const given = new URLSearchParams(link);
  if (!saved) return given.toString();
  let kept: URLSearchParams;
  try {
    kept = new URLSearchParams(saved);
  } catch {
    return given.toString();
  }
  const merged = new URLSearchParams(given);
  const take = (keys: readonly string[]) => {
    for (const key of keys) {
      const value = kept.get(key);
      if (value !== null) merged.set(key, value);
    }
  };
  if (!LAYER_GROUP.some((key) => given.has(key))) take(LAYER_GROUP);
  if (!CAMERA_GROUP.some((key) => given.has(key)) && !given.has("selected")) take(CAMERA_GROUP);
  for (const key of SHOW_PARAMS) if (!given.has(key)) take([key]);
  if (!SCHOOL_GROUP.some((key) => given.has(key))) take(SCHOOL_GROUP);
  return merged.toString();
}

/** The setup to save: the address the map writes without the chosen home (the area stays, for "Back to the map"). */
export function savedSetup(query: string): string {
  const parameters = new URLSearchParams(query);
  for (const key of LINK_ONLY.slice(1)) parameters.delete(key);
  return parameters.toString();
}

/** Reads the saved setup; null when storage is blocked or empty. */
export function readMapSetup(): string | null {
  try {
    return window.localStorage.getItem(SAVED_MAP_STATE_KEY);
  } catch {
    return null;
  }
}

export function writeMapSetup(query: string): void {
  try {
    window.localStorage.setItem(SAVED_MAP_STATE_KEY, savedSetup(query));
  } catch {
    // Storage may be blocked: the map still works, it just starts fresh next time.
  }
}

/** Privacy › "Clear my data": the map setup, the map colours and the 2D/3D choice go. */
export const MAP_DEVICE_KEYS = [SAVED_MAP_STATE_KEY, "close-knit.palette", "close-knit.map-view"] as const;

export function clearMapSetup(): void {
  for (const key of MAP_DEVICE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to clear when storage is blocked.
    }
  }
}

// ---- Show's sub-filters in the query -----------------------------------------------------------

/** ?cycle=on: the TfL cycle lanes over the map (off by default). */
export function cycleFromQuery(search: string): boolean {
  return new URLSearchParams(search).get("cycle") === "on";
}

export function withCycleQuery(query: string, on: boolean): string {
  const parameters = new URLSearchParams(query);
  if (on) parameters.set("cycle", "on");
  else parameters.delete("cycle");
  return parameters.toString();
}

/** ?crime-off=a,b: the crime categories left out of the Crime layer (Layers › Crime filters). */
export function crimeOffFromQuery(search: string): string[] {
  const raw = new URLSearchParams(search).get("crime-off");
  if (!raw) return [];
  return [...new Set(raw.split(",").map((part) => part.trim()).filter((part) => /^[A-Za-z0-9 _-]{1,60}$/.test(part)))];
}

export function withCrimeOffQuery(query: string, excluded: readonly string[]): string {
  const parameters = new URLSearchParams(query);
  if (excluded.length) parameters.set("crime-off", [...excluded].sort().join(","));
  else parameters.delete("crime-off");
  return parameters.toString();
}

/** What differs from `base`, as a short JSON string ("on" when nothing does). */
function diffValue<T extends object>(view: T, base: T): string {
  const changed = Object.fromEntries(Object.entries(view).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key as keyof T])));
  return Object.keys(changed).length ? JSON.stringify(changed) : "on";
}

function readJson(raw: string): Record<string, unknown> {
  if (raw === "on") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function pickList<T extends string | number>(value: unknown, allowed: readonly T[], fallback: readonly T[]): T[] {
  if (!Array.isArray(value)) return [...fallback];
  return allowed.filter((item) => value.includes(item));
}

/** ?collisions=on (the default filters) or a JSON of the filters that differ; null while off. */
export function collisionsFromQuery(search: string): CollisionView | null {
  const raw = new URLSearchParams(search).get("collisions");
  if (raw === null || raw === "off") return null;
  const json = readJson(raw);
  const base = DEFAULT_COLLISION_VIEW;
  const lights: CollisionLight[] = ["any", "dark", "day"];
  return {
    children: typeof json.children === "boolean" ? json.children : base.children,
    users: pickList<RoadUser>(json.users, ROAD_USERS.map((user) => user.id), base.users),
    severities: pickList<number>(json.severities, SEVERITIES.map((severity) => severity.id), base.severities),
    years: pickList<number>(json.years, [...COLLISION_YEARS], base.years),
    light: lights.includes(json.light as CollisionLight) ? json.light as CollisionLight : base.light,
  };
}

export function withCollisionsQuery(query: string, view: CollisionView | null): string {
  const parameters = new URLSearchParams(query);
  if (view) parameters.set("collisions", diffValue(view, DEFAULT_COLLISION_VIEW));
  else parameters.delete("collisions");
  return parameters.toString();
}

type SaleSetup = Omit<SaleView, "ramp">;

/** ?sales=on (the default view) or a JSON of what differs from `base`; `base` (off) when absent. */
export function salesFromQuery(search: string, base: SaleSetup): SaleSetup {
  const raw = new URLSearchParams(search).get("sales");
  if (raw === null || raw === "off") return base;
  const json = readJson(raw);
  const filters = json.filters && typeof json.filters === "object" ? json.filters as Record<string, unknown> : {};
  const year = (value: unknown, fallback: number) => (typeof value === "number" && Number.isInteger(value) && value >= 1995 && value <= 2100 ? value : fallback);
  const price = (value: unknown, fallback: number | null) => (value === null || (typeof value === "number" && value >= 0) ? value as number | null : fallback);
  return {
    on: true,
    colourBy: json.colourBy === "growth" || json.colourBy === "price" ? json.colourBy : base.colourBy,
    years: GROWTH_YEARS.includes(json.years as never) ? json.years as SaleSetup["years"] : base.years,
    scale: json.scale === "cheaper" || json.scale === "default" || json.scale === "expensive" ? json.scale : base.scale,
    filters: {
      fromYear: year(filters.fromYear, base.filters.fromYear),
      toYear: year(filters.toYear, base.filters.toYear),
      types: pickList(filters.types, PROPERTY_TYPES.map((type) => type.id), base.filters.types),
      newBuild: filters.newBuild === "new" || filters.newBuild === "existing" || filters.newBuild === "any" || filters.newBuild === "none"
        ? filters.newBuild : base.filters.newBuild,
      tenure: filters.tenure === "F" || filters.tenure === "L" || filters.tenure === "any" || filters.tenure === "none" ? filters.tenure : base.filters.tenure,
      minPrice: price(filters.minPrice, base.filters.minPrice),
      maxPrice: price(filters.maxPrice, base.filters.maxPrice),
      years: Array.isArray(filters.years)
        ? filters.years.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1995 && value <= 2100)
        : base.filters.years ?? null,
    },
  };
}

export function withSalesQuery(query: string, view: SaleView, base: SaleSetup): string {
  const parameters = new URLSearchParams(query);
  if (!view.on) {
    parameters.delete("sales");
    return parameters.toString();
  }
  const { ramp: _ramp, ...setup } = view;
  const changed = diffValue({ ...setup, on: true }, { ...base, on: true });
  parameters.set("sales", changed);
  return parameters.toString();
}

// ---- Defaults, for the "Default" buttons ----------------------------------------------------------

/** Everything Show's Default puts back: Local places (default groups) and Stations on, the rest off. */
export interface ShowSetup {
  placeView: PlaceView;
  shows: MapShows;
  cycleLanes: boolean;
  collisions: CollisionView | null;
  saleView: SaleSetup;
  /** Show › Schools' filters. */
  schoolFilter: SchoolFilter;
}

export function defaultShowSetup(defaultSales: SaleSetup): ShowSetup {
  return {
    placeView: { ...DEFAULT_PLACE_VIEW, groups: [...DEFAULT_PLACE_VIEW.groups] },
    shows: { ...DEFAULT_SHOWS },
    cycleLanes: false,
    collisions: null,
    saleView: defaultSales,
    schoolFilter: { ...DEFAULT_SCHOOL_FILTER },
  };
}

/** True when Show holds its defaults (the Default button is then muted). */
export function isDefaultShow(setup: ShowSetup, defaultSales: SaleSetup): boolean {
  const base = defaultShowSetup(defaultSales);
  const { ramp: _ramp, ...sales } = setup.saleView as SaleView;
  return sameSet(setup.placeView.groups, base.placeView.groups) && setup.placeView.on === base.placeView.on
    && JSON.stringify(setup.shows) === JSON.stringify(base.shows)
    && setup.cycleLanes === base.cycleLanes && setup.collisions === null && isDefaultSchoolFilter(setup.schoolFilter)
    && JSON.stringify(sales) === JSON.stringify(base.saleView);
}

/** What Layers' Default puts back: Price per m² · Rank in London · latest, nothing filtered, colours on. */
export interface LayerSetup {
  layer: string;
  period: string;
  scaleMode: string;
  changeWindow: number;
  excludedCrime: readonly string[];
  plain: boolean;
}

export const DEFAULT_LAYER = "price-per-square-metre";
/** The default layer opens on its London rank (owner decision): actual £/m² reads all red at first open. */
export const DEFAULT_SCALE_MODE: LegendScaleMode = "percentile";

/** The scale a layer opens on when the address names none: rank for the default layer, actual values elsewhere. */
export function defaultScaleMode(layer: string): LegendScaleMode {
  return layer === DEFAULT_LAYER ? DEFAULT_SCALE_MODE : "linear";
}

export function isDefaultLayers(setup: LayerSetup, latestPeriod: string, defaultWindow: number): boolean {
  return setup.layer === DEFAULT_LAYER && setup.period === latestPeriod && setup.scaleMode === DEFAULT_SCALE_MODE
    && setup.changeWindow === defaultWindow && setup.excludedCrime.length === 0 && !setup.plain;
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

export { placesFromQuery, showsFromQuery };
