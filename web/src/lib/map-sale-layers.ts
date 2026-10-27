/**
 * Sold-price map (HM Land Registry Price Paid): one pin per home from zoom 15
 * with its last sale, merged cells of recent sales at zooms 11–14. Pure style
 * and filter definitions so colours, filters and tooltips are unit-testable;
 * the map component only adds and updates them.
 */
import type { ExpressionSpecification, FilterSpecification, LayerSpecification, VectorSourceSpecification } from "maplibre-gl";
import type { MapImage } from "./map-yarn-images";
import { withRelease } from "./release-url";

export const SALE_SOURCE_ID = "sales";
export const SALE_CELL_LAYER = "sale-cells";
export const SALE_PIN_LAYER = "sale-pins";
export const SALE_LAYER_IDS = [SALE_CELL_LAYER, SALE_PIN_LAYER] as const;
export const SALE_CELL_MIN_ZOOM = 11;
export const SALE_PIN_MIN_ZOOM = 15;
export const SALE_TILE_MAX_ZOOM = 16;

export const SALE_ATTRIBUTION =
  "Contains HM Land Registry data © Crown copyright and database right 2026. "
  + "This data is licensed under the Open Government Licence v3.0.";

/** A pin is coloured by its recorded price or its area's growth; never a value today or a per-sale £/m². */
export type SaleColourBy = "price" | "growth";
export type GrowthYears = 1 | 3 | 5 | 10 | 20;
export type SaleScale = "cheaper" | "default" | "expensive";
export type PropertyType = "D" | "S" | "T" | "F" | "O";

export interface SaleFilters {
  fromYear: number;
  toYear: number;
  types: PropertyType[];
  /** Show's year chips: the years picked, or null for every year from fromYear to toYear. */
  years?: number[] | null;
  /** "none": both chips off in Show, so no pin passes. */
  newBuild: "any" | "new" | "existing" | "none";
  tenure: "any" | "F" | "L" | "none";
  minPrice: number | null;
  maxPrice: number | null;
}

export interface SaleView {
  on: boolean;
  colourBy: SaleColourBy;
  years: GrowthYears;
  scale: SaleScale;
  filters: SaleFilters;
  /** Six colours low to high; defaults to the green-to-red ramp. */
  ramp?: readonly string[];
}

export const FIRST_SALE_YEAR = 1995;
/** A pin without the value it is coloured by (and its key in Show). */
export const SALE_NO_DATA = "#b8b8b8";
export const PROPERTY_TYPES: Array<{ id: PropertyType; label: string }> = [
  { id: "D", label: "Detached" },
  { id: "S", label: "Semi" },
  { id: "T", label: "Terraced" },
  { id: "F", label: "Flat" },
  { id: "O", label: "Other" },
];
export const GROWTH_YEARS: GrowthYears[] = [1, 3, 5, 10, 20];

// ---- Show › Recent sales as chip lists --------------------------------------------------
// Tenure and new build stay one value each in the filters (and in links); the chips are their two halves.

export type TenureChip = "F" | "L";
export type BuildChip = "new" | "existing";
export const TENURE_CHIPS: Array<{ id: TenureChip; label: string }> = [{ id: "F", label: "Freehold" }, { id: "L", label: "Leasehold" }];
export const BUILD_CHIPS: Array<{ id: BuildChip; label: string }> = [{ id: "new", label: "New build" }, { id: "existing", label: "Existing" }];

export function tenureChips(tenure: SaleFilters["tenure"]): TenureChip[] {
  return tenure === "any" ? ["F", "L"] : tenure === "none" ? [] : [tenure];
}

export function tenureFromChips(chips: readonly TenureChip[]): SaleFilters["tenure"] {
  return chips.length === 2 ? "any" : chips[0] ?? "none";
}

export function buildChips(newBuild: SaleFilters["newBuild"]): BuildChip[] {
  return newBuild === "any" ? ["new", "existing"] : newBuild === "none" ? [] : [newBuild];
}

export function buildFromChips(chips: readonly BuildChip[]): SaleFilters["newBuild"] {
  return chips.length === 2 ? "any" : chips[0] ?? "none";
}

/**
 * Year chips: "Earlier" and the last five years, each on or off (All · None). "Earlier" stands for every
 * year from 1995 to the one before the chips. Every chip on is null (no year filter beyond from–to).
 */
export type YearChip = "earlier" | `${number}`;

export function yearChipOptions(latestYear: number): Array<{ id: YearChip; label: string }> {
  const recent = Array.from({ length: 5 }, (_, index) => latestYear - 4 + index);
  return [{ id: "earlier", label: "Earlier" }, ...recent.map((year) => ({ id: `${year}` as YearChip, label: `${year}` }))];
}

function chipYears(chip: YearChip, latestYear: number): number[] {
  if (chip !== "earlier") return [Number(chip)];
  return Array.from({ length: Math.max(0, latestYear - 4 - FIRST_SALE_YEAR) }, (_, index) => FIRST_SALE_YEAR + index);
}

export function yearChips(years: SaleFilters["years"], latestYear: number): YearChip[] {
  const options = yearChipOptions(latestYear).map((option) => option.id);
  if (!years) return options;
  return options.filter((chip) => chipYears(chip, latestYear).every((year) => years.includes(year)));
}

export function yearsFromChips(chips: readonly YearChip[], latestYear: number): SaleFilters["years"] {
  if (chips.length === yearChipOptions(latestYear).length) return null;
  return chips.flatMap((chip) => chipYears(chip, latestYear)).sort((a, b) => a - b);
}

export function defaultSaleView(latestYear: number): SaleView {
  return {
    on: false,
    colourBy: "price",
    years: 5,
    scale: "default",
    filters: {
      fromYear: FIRST_SALE_YEAR, toYear: latestYear,
      // "Other" is mostly portfolio and commercial transfers; opt-in only.
      types: PROPERTY_TYPES.filter((type) => type.id !== "O").map((type) => type.id),
      newBuild: "any", tenure: "any", minPrice: null, maxPrice: null, years: null,
    },
  };
}

export interface SaleStop {
  value: number;
  colour: string;
  label: string;
}


const PRICE_STOPS = [200_000, 350_000, 500_000, 750_000, 1_200_000, 2_500_000];
const GROWTH_STOPS: Record<GrowthYears, number[]> = {
  1: [-10, -4, 0, 3, 6, 12],
  3: [-15, -5, 0, 8, 15, 30],
  5: [-15, -5, 5, 15, 25, 45],
  10: [0, 20, 40, 60, 80, 120],
  20: [50, 100, 150, 200, 250, 350],
};

// "Cheaper" stretches the colour range over cheaper homes, "expensive" over
// dearer ones (housemetric's scale switch); growth keeps one scale.
const SCALE_FACTOR: Record<SaleScale, number> = { cheaper: 0.6, default: 1, expensive: 1.8 };

function money(value: number): string {
  return value >= 1_000_000 ? `£${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}m` : `£${Math.round(value / 1000)}k`;
}

/**
 * Sale pins and cells: one hue, mauve-plum, light to deep (ΔE ≥ 14 from every reserved map
 * colour): red means collisions and green nature, so the old red–green ramp is gone from the pins. The
 * homes' fill at house zoom keeps the chosen palette (view.ramp).
 */
export const SALE_PIN_RAMP = ["#fbd1ef", "#d7b0cc", "#b391aa", "#917389", "#715669", "#574050"] as const;

export function saleStops(view: Pick<SaleView, "colourBy" | "years" | "scale" | "ramp">): SaleStop[] {
  const ramp = SALE_PIN_RAMP;
  if (view.colourBy === "growth") {
    return GROWTH_STOPS[view.years].map((value, index) => ({
      value, colour: ramp[index], label: `${value > 0 ? "+" : ""}${value}%`,
    }));
  }
  const factor = SCALE_FACTOR[view.scale];
  return PRICE_STOPS.map((value, index) => {
    const scaled = Math.round(value * factor / 100) * 100;
    return { value: scaled, colour: ramp[index], label: money(scaled) };
  });
}

/** The tile attribute a colour mode reads. */
export function saleAttribute(view: Pick<SaleView, "colourBy" | "years">): string {
  if (view.colourBy === "growth") return `g${view.years}`;
  return view.colourBy;
}

/** Pins are coloured by their recorded price or their area's growth; never a value today or a per-sale £/m². */
export function saleColour(view: Pick<SaleView, "colourBy" | "years" | "scale" | "ramp">): ExpressionSpecification {
  const attribute = saleAttribute(view);
  const stops = saleStops(view).flatMap((stop) => [stop.value, stop.colour]);
  return [
    "case",
    ["==", ["get", attribute], null], SALE_NO_DATA,
    ["interpolate", ["linear"], ["to-number", ["get", attribute]], ...stops],
  ] as ExpressionSpecification;
}

/**
 * Client-side filter on individual pins (zoom 15+). Merged cells summarise
 * recent sales and are not filtered: the panel says so.
 */
export function saleFilter(filters: SaleFilters): FilterSpecification {
  const clauses: ExpressionSpecification[] = [
    [">=", ["get", "year"], filters.fromYear],
    ["<=", ["get", "year"], filters.toYear],
    ["in", ["get", "type"], ["literal", filters.types]],
  ];
  if (filters.years) clauses.push(["in", ["get", "year"], ["literal", filters.years]]);
  if (filters.newBuild === "none" || filters.tenure === "none") clauses.push(["boolean", false]);
  if (filters.newBuild === "new" || filters.newBuild === "existing") clauses.push(["==", ["get", "new_build"], filters.newBuild === "new" ? 1 : 0]);
  if (filters.tenure === "F" || filters.tenure === "L") clauses.push(["==", ["get", "tenure"], filters.tenure]);
  if (filters.minPrice !== null) clauses.push([">=", ["get", "price"], filters.minPrice]);
  if (filters.maxPrice !== null) clauses.push(["<=", ["get", "price"], filters.maxPrice]);
  return ["all", ...clauses] as FilterSpecification;
}

export function saleSource(origin: string, release?: string | null): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [withRelease(`${origin}/api/v1/tiles/sales/{z}/{x}/{y}.pbf`, release)],
    minzoom: SALE_CELL_MIN_ZOOM,
    maxzoom: SALE_TILE_MAX_ZOOM,
  };
}

/** The rounded square (a house footprint) every sale pin and cell is drawn with, tinted per sale (SDF). */
export const SALE_SQUARE_IMAGE = "sale-square";
const SQUARE_PX = 10;
const SDF_BUFFER = 3;

/**
 * The square as a signed distance field (MapLibre's SDF convention: 0.75 at the edge, 1/8 per pixel), so
 * one image takes any colour and an ink outline (icon-halo). Drawn at once; null without a browser.
 */
export function saleSquareImage(ratio: number): MapImage | null {
  if (typeof document === "undefined") return null;
  const scale = Math.max(1, Math.ceil(ratio));
  const size = (SQUARE_PX + SDF_BUFFER * 2) * scale;
  const half = (SQUARE_PX * scale) / 2;
  const radius = 2.5 * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.abs(x + 0.5 - size / 2) - (half - radius);
      const dy = Math.abs(y + 0.5 - size / 2) - (half - radius);
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
      data[(y * size + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round(255 * (0.75 - outside / (8 * scale)))));
    }
  }
  return { width: size, height: size, data };
}

/**
 * The sale pin's outline: ink by Day; by Night the snow white, since the deep plums on the navy basemap are
 * under 2:1 and an ink outline adds nothing there (WCAG 1.4.11; marker audit).
 */
export function saleHaloColour(theme: "day" | "night"): string {
  return theme === "night" ? "#f4f7fa" : "#22252c";
}

export function saleLayers(view: SaleView, theme: "day" | "night" = "day"): LayerSpecification[] {
  const colour = saleColour(view);
  const square = { "icon-image": SALE_SQUARE_IMAGE, "icon-allow-overlap": true, "icon-ignore-placement": true } as const;
  return [
    {
      id: SALE_CELL_LAYER, type: "symbol", source: SALE_SOURCE_ID, "source-layer": "sale_cells",
      minzoom: SALE_CELL_MIN_ZOOM, maxzoom: SALE_PIN_MIN_ZOOM,
      layout: { ...square, "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 14.9, 1.3] },
      paint: { "icon-color": colour, "icon-opacity": 0.85 },
    },
    {
      id: SALE_PIN_LAYER, type: "symbol", source: SALE_SOURCE_ID, "source-layer": "sales",
      minzoom: SALE_PIN_MIN_ZOOM,
      filter: saleFilter(view.filters),
      layout: { ...square, "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 0.8, 18, 1.6] },
      paint: {
        "icon-color": colour,
        "icon-halo-color": saleHaloColour(theme),
        "icon-halo-width": ["case", ["==", ["get", "precision"], "postcode"], 0, 0.8],
        "icon-opacity": ["case", ["==", ["get", "precision"], "postcode"], 0.55, 0.95],
      },
    },
  ];
}

const TYPE_LABEL: Record<string, string> = Object.fromEntries(PROPERTY_TYPES.map((type) => [type.id, type.label]));

function formatDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1))
    .toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Percent with one decimal and a sign (tile floats carry float32 noise). */
function percent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function pounds(value: unknown): string | null {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? null : `£${Math.round(number).toLocaleString("en-GB")}`;
}

/** Tooltip lines for a hovered pin or merged cell: a cell's median £/m² (three or more homes), never a pin's. */
export function saleTooltipLines(layer: string, properties: Record<string, unknown> | undefined, view: Pick<SaleView, "years">): string[] {
  if (!properties) return [];
  const growth = properties[`g${view.years}`];
  const areaGrowth = typeof growth === "number" ? `Area £/m² ${percent(growth)} over ${view.years}y` : null;
  if (layer === SALE_CELL_LAYER) {
    return [
      `${Number(properties.n) || 0} homes sold in the last five years`,
      `Median last sale ${pounds(properties.price) ?? "—"}`,
      ...(properties.ppm ? [`Median ${pounds(properties.ppm)}/m²`] : []),
      ...(areaGrowth ? [areaGrowth] : []),
      "Zoom in for individual sales",
    ];
  }
  const lines = [
    `${pounds(properties.price) ?? "—"} · ${formatDate(properties.date) ?? "unknown date"}`,
    [TYPE_LABEL[String(properties.type)] ?? "Home", properties.tenure === "L" ? "leasehold" : properties.tenure === "F" ? "freehold" : null,
      Number(properties.new_build) === 1 ? "new build" : null].filter(Boolean).join(" · "),
  ];
  const previous = pounds(properties.previous_price);
  const previousDate = formatDate(properties.previous_date);
  if (previous && previousDate) {
    const annual = typeof properties.growth === "number" ? ` (${percent(properties.growth)}/yr)` : "";
    lines.push(`Before: ${previous} · ${previousDate}${annual}`);
  }
  if (areaGrowth) lines.push(areaGrowth);
  if (properties.category === "B") lines.push("Non-standard sale (repossession, buy-to-let or company)");
  if (properties.precision === "postcode") lines.push("Placed at its postcode centre");
  return lines;
}

/**
 * A sale pin is drawn 8–16 px but takes a tap of at least 44 × 44 px (WCAG 2.5.5; marker audit): the map looks
 * in this box around the finger and picks the nearest pin. The drawn square keeps its size.
 */
export const SALE_TAP_PX = 44;

export function saleTapBox(point: { x: number; y: number }): [[number, number], [number, number]] {
  const half = SALE_TAP_PX / 2;
  return [[point.x - half, point.y - half], [point.x + half, point.y + half]];
}

export interface SalePinSelection {
  uprn: string | null;
  addressId: string;
  area: string | null;
}

export function salePinSelection(properties: Record<string, unknown> | undefined): SalePinSelection | null {
  const addressId = properties?.id;
  if (typeof addressId !== "string" || !addressId.startsWith("uk:addr:")) return null;
  const uprn = properties?.uprn;
  const area = properties?.area;
  return {
    addressId,
    uprn: typeof uprn === "string" || typeof uprn === "number" ? String(uprn) : null,
    area: typeof area === "string" ? area : null,
  };
}
