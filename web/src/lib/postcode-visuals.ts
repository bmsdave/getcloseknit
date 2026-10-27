/**
 * Pure maths for the postcode page's infographics: the headline figures,
 * the sales-over-time chart (one dot per sale, area trend lines for
 * context), the homes mix and the postcode-vs-area comparison. Inputs are
 * the recorded sales (address histories) and the postcode's homes; nothing
 * here estimates a value. Places, not people: every figure describes homes
 * and sales, never who lives in them.
 */
import type { ChartTone } from "./chart-geometry";
import type { AddressHistory } from "./contracts";
import { niceTicks, type AreaMarketResponse, type Box, type PropertyTypeCode } from "./market";
import type { PostcodeHome } from "./property-profile";

/** Sales in this many years before today (then twice that) make the "recent" basis. */
export const RECENT_YEARS = 5;
/** Fewer recent sales than this and the typical figure uses every sale on record instead. */
export const MIN_RECENT_SALES = 3;

export interface SalePoint {
  addressId: string;
  date: string;
  /** Decimal year: "2018-07-01" → about 2018.5. */
  time: number;
  price: number;
  /** Flat or house, from the home's latest Land Registry sale; null when unknown. */
  kind: HomeKind | null;
}

export type HomeKind = "flat" | "house";

/** Flats (and maisonettes) apart from houses (terraced, semi-detached, detached); "Other" stays unknown. */
export function homeKind(propertyType: string | null | undefined): HomeKind | null {
  const code = propertyType ? TYPE_CODES[propertyType] : undefined;
  if (code === "F") return "flat";
  return code === "T" || code === "S" || code === "D" ? "house" : null;
}

export function decimalYear(date: string): number {
  const [year, month = "1", day = "1"] = date.split("-");
  return Number(year) + (Number(month) - 1) / 12 + (Number(day) - 1) / 365;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Every recorded sale in the postcode, oldest first; `homes` tells flats from houses. */
export function salePoints(histories: readonly AddressHistory[], homes: readonly PostcodeHome[] | null = null): SalePoint[] {
  const kinds = new Map((homes ?? []).map((home) => [home.addressId, homeKind(home.propertyType)]));
  return histories.flatMap((history) => history.transactions.map((sale) => ({
    addressId: history.addressId,
    date: sale.date,
    time: decimalYear(sale.date),
    price: sale.nominalPrice,
    kind: kinds.get(history.addressId) ?? null,
  }))).sort((a, b) => a.date.localeCompare(b.date) || a.price - b.price);
}

export interface Typical {
  value: number;
  /** "recent": sales in the RECENT_YEARS before the latest; "all": every sale on record (too few recent ones). */
  basis: "recent" | "all";
  count: number;
  fromYear: number;
  toYear: number;
}

export interface PostcodeSummary {
  homes: number;
  sales: number;
  typicalPrice: Typical | null;
  lastSale: SalePoint | null;
  firstYear: number | null;
  /**
   * Typical price of flats and of houses, side by side, when the postcode
   * has both and each has enough recent sales: one middle of a mix of flats
   * and houses describes neither. Empty otherwise.
   */
  byKind: { kind: HomeKind; typical: Typical }[];
  /** Flats and houses both among the sales behind the typical price. */
  blended: boolean;
  /** Each kind's own typical price (recent or all-time), when it has sales. */
  kindTypicals: { kind: HomeKind; typical: Typical }[];
  /** The middle of every sale on record: the chart's caption, never the headline. */
  longRun: Typical | null;
}

/**
 * The middle of the sales in the last RECENT_YEARS (then twice that) before
 * `now`; with too few, the middle of every sale on record ("all", which mixes
 * eras and is never compared with today's area figures).
 */
function typical(points: readonly SalePoint[], pick: (point: SalePoint) => number | null, now: number): Typical | null {
  const usable = points.filter((point) => pick(point) !== null);
  if (usable.length === 0) return null;
  const recent = [RECENT_YEARS, RECENT_YEARS * 2]
    .map((years) => usable.filter((point) => point.time >= now - years))
    .find((window) => window.length >= MIN_RECENT_SALES);
  const chosen = recent ?? usable;
  return {
    value: median(chosen.map((point) => pick(point) as number))!,
    basis: recent ? "recent" : "all",
    count: chosen.length,
    fromYear: Math.floor(chosen[0].time),
    toYear: Math.floor(chosen.at(-1)!.time),
  };
}

/** The hero numbers: how many homes and sales, the typical price and £/m², and the last sale. */
export function postcodeSummary(histories: readonly AddressHistory[], homes: readonly PostcodeHome[] | null,
  today: string = new Date().toISOString().slice(0, 10)): PostcodeSummary {
  const points = salePoints(histories, homes);
  const now = decimalYear(today);
  const kindTypicals = (["flat", "house"] as const).flatMap((kind) => {
    const figure = typical(points.filter((point) => point.kind === kind), (point) => point.price, now);
    return figure ? [{ kind, typical: figure }] : [];
  });
  const byKind = kindTypicals.filter((entry) => entry.typical.basis === "recent");
  const typicalPrice = typical(points, (point) => point.price, now);
  // Flats and houses both among the sales behind the typical price: one middle describes neither.
  const window = typicalPrice ? points.filter((point) => point.time >= typicalPrice.fromYear) : [];
  const blended = window.some((point) => point.kind === "flat") && window.some((point) => point.kind === "house");
  return {
    homes: Math.max(homes?.length ?? 0, histories.length),
    // Homes carry their sale counts even when the page read only some histories.
    sales: Math.max(points.length, (homes ?? []).reduce((sum, home) => sum + home.saleCount, 0)),
    typicalPrice,
    lastSale: points.at(-1) ?? null,
    firstYear: points.length > 0 ? Math.floor(points[0].time) : null,
    byKind: byKind.length === 2 ? byKind : [],
    blended,
    kindTypicals,
    longRun: points.length > 0 ? {
      value: median(points.map((point) => point.price))!, basis: "all", count: points.length,
      fromYear: Math.floor(points[0].time), toYear: Math.floor(points.at(-1)!.time),
    } : null,
  };
}

/**
 * The headline "typical price here", honest about mixes: flats and houses
 * side by side when both have recent sales, the one kind that has when the
 * other is too thin, one figure when the homes are alike, and "too few"
 * when there are not enough recent sales (never a middle of 1990s prices).
 */
export type TypicalHeadline =
  | { kind: "split"; parts: { kind: HomeKind; typical: Typical }[] }
  | { kind: "one-kind"; part: { kind: HomeKind; typical: Typical }; missing: HomeKind }
  | { kind: "single"; typical: Typical }
  | { kind: "too-few" };

export function typicalHeadline(summary: PostcodeSummary): TypicalHeadline {
  if (summary.byKind.length === 2) return { kind: "split", parts: summary.byKind };
  if (!summary.typicalPrice || summary.typicalPrice.basis !== "recent") return { kind: "too-few" };
  if (!summary.blended) return { kind: "single", typical: summary.typicalPrice };
  const part = summary.kindTypicals.find((entry) => entry.typical.basis === "recent");
  if (!part) return { kind: "too-few" };
  return { kind: "one-kind", part, missing: part.kind === "flat" ? "house" : "flat" };
}

/**
 * The area brief's crime words from its region percentile: "Higher than most of London", "... of North West" for a
 * Manchester postcode (the percentile is of the area's own region); "its region" when the region is not known.
 */
export function crimeVersusRegion(percentile: number | null | undefined, region: string | null): string | null {
  if (percentile === null || percentile === undefined || !Number.isFinite(percentile)) return null;
  const place = region ?? "its region";
  if (percentile >= 60) return `Higher than most of ${place}`;
  if (percentile <= 40) return `Lower than most of ${place}`;
  return `About average for ${place}`;
}

/** "sales 2019–2024" or "2024 sales" for a typical figure's basis. */
export function typicalSpan(figure: Typical): string {
  const years = figure.fromYear === figure.toYear ? `${figure.fromYear}` : `${figure.fromYear}–${figure.toYear}`;
  return `${figure.count} ${figure.count === 1 ? "sale" : "sales"}, ${years}`;
}

// ---- Homes mix -------------------------------------------------------------

export const TYPE_CODES: Record<string, PropertyTypeCode> = {
  "Flat or maisonette": "F", Flat: "F", Terraced: "T", "Semi-detached": "S", Detached: "D", Other: "O",
};
const TYPE_ORDER: { code: PropertyTypeCode; label: string; tone: ChartTone }[] = [
  { code: "F", label: "Flats", tone: "c1" },
  { code: "T", label: "Terraced", tone: "c2" },
  { code: "S", label: "Semi-detached", tone: "c3" },
  { code: "D", label: "Detached", tone: "c4" },
  { code: "O", label: "Other", tone: "c5" },
];
export const ENERGY_BANDS = ["A", "B", "C", "D", "E", "F", "G"] as const;
const ENERGY_TONES: ChartTone[] = ["good", "good", "c3", "c5", "c2", "bad", "bad"];
export const SIZE_BANDS: { id: string; label: string; below: number }[] = [
  { id: "under-50", label: "Under 50 m²", below: 50 },
  { id: "50-69", label: "50–69 m²", below: 70 },
  { id: "70-99", label: "70–99 m²", below: 100 },
  { id: "100-149", label: "100–149 m²", below: 150 },
  { id: "150-plus", label: "150 m² or more", below: Infinity },
];

export interface MixPart { id: string; label: string; value: number; tone: ChartTone }
export interface MixRow { id: string; label: string; value: number; display: string }

export interface HomesMix {
  total: number;
  types: MixPart[];
  typesKnown: number;
  energy: MixPart[];
  energyKnown: number;
  sizes: MixRow[];
  sizesKnown: number;
  medianSize: number | null;
  tenure: MixPart[];
  tenureKnown: number;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Size bands with no homes before the first or after the last one that has some are left out; gaps between stay. */
function trimEmpty(rows: MixRow[]): MixRow[] {
  const first = rows.findIndex((row) => row.value > 0);
  if (first < 0) return rows;
  const last = rows.length - 1 - [...rows].reverse().findIndex((row) => row.value > 0);
  return rows.slice(first, last + 1);
}

/** Types, energy ratings (from certificates), floor areas and tenure of the postcode's homes; unknowns are counted, not guessed. */
export function homesMix(homes: readonly PostcodeHome[]): HomesMix {
  const count = <T,>(values: T[], key: T) => values.filter((value) => value === key).length;
  const types = homes.map((home) => (home.propertyType ? TYPE_CODES[home.propertyType] : undefined) ?? null);
  const energy = homes.map((home) => home.energyRating?.trim().toUpperCase().slice(0, 1) ?? null);
  const sizes = homes.flatMap((home) => home.floorAreaSquareMetres === null ? [] : [home.floorAreaSquareMetres]);
  const tenure = homes.map((home) => home.tenure);
  return {
    total: homes.length,
    types: TYPE_ORDER.flatMap(({ code, label, tone }) => {
      const value = count(types, code);
      return value > 0 ? [{ id: code, label: `${label} (${value})`, value, tone }] : [];
    }),
    typesKnown: types.filter((type) => type !== null).length,
    energy: ENERGY_BANDS.flatMap((band, index) => {
      const value = count(energy, band);
      return value > 0 ? [{ id: band, label: `${band} (${value})`, value, tone: ENERGY_TONES[index] }] : [];
    }),
    energyKnown: energy.filter((band) => band !== null && (ENERGY_BANDS as readonly string[]).includes(band)).length,
    sizes: trimEmpty(SIZE_BANDS.map((band, index) => {
      const floor = index === 0 ? 0 : SIZE_BANDS[index - 1].below;
      const value = sizes.filter((size) => size >= floor && size < band.below).length;
      return { id: band.id, label: band.label, value, display: plural(value, "home") };
    })),
    sizesKnown: sizes.length,
    medianSize: median(sizes),
    tenure: (["Freehold", "Leasehold"] as const).flatMap((kind, index) => {
      const value = count(tenure, kind);
      return value > 0 ? [{ id: kind, label: `${kind} (${value})`, value, tone: (index === 0 ? "c3" : "c1") as ChartTone }] : [];
    }),
    tenureKnown: tenure.filter((kind) => kind !== null).length,
  };
}

/** The type most homes here share (three in four or more), for a like-for-like area trend; null when mixed. */
export function dominantType(homes: readonly PostcodeHome[] | null): PropertyTypeCode | null {
  const codes = (homes ?? []).flatMap((home) => {
    const code = home.propertyType ? TYPE_CODES[home.propertyType] : undefined;
    return code ? [code] : [];
  });
  if (codes.length === 0) return null;
  const top = TYPE_ORDER.map(({ code }) => ({ code, value: codes.filter((entry) => entry === code).length }))
    .sort((a, b) => b.value - a.value)[0];
  return top.value / codes.length >= 0.75 ? top.code : null;
}

// ---- Sales over time ---------------------------------------------------------

export type SalesMeasure = "price" | "per-square-metre";

export interface TrendLine {
  key: string;
  label: string;
  points: { time: number; value: number }[];
}

/**
 * One area's yearly medians as a line: the series for `type` when it has at
 * least three points, otherwise all homes. Each 12-month window is placed at
 * its middle.
 */
export function marketTrend(market: AreaMarketResponse | null, measure: SalesMeasure, type: PropertyTypeCode | null, label: string, key: string): TrendLine | null {
  if (!market?.available) return null;
  const read = (series: AreaMarketResponse["trend"][number] | undefined) => (series?.points ?? []).flatMap((point) => {
    const value = measure === "price" ? point.medianPrice : point.medianPricePerSquareMetre;
    return value === null ? [] : [{ time: decimalYear(`${point.windowEnd}-01`) - 0.5, value }];
  });
  const typed = type ? read(market.trend.find((series) => series.propertyType === type)) : [];
  const points = typed.length >= 3 ? typed : read(market.trend.find((series) => series.propertyType === "all"));
  if (points.length < 2) return null;
  const which = typed.length >= 3 && type ? ` (${TYPE_ORDER.find((entry) => entry.code === type)?.label.toLowerCase()})` : "";
  return { key, label: `${label}${which}`, points };
}

export interface SalesChartGeometry {
  dots: { x: number; y: number; sale: SalePoint }[];
  lines: { key: string; label: string; path: string }[];
  yTicks: { value: number; y: number }[];
  xTicks: { year: number; x: number }[];
}

/** Dots for each sale's price and the trend lines, on one time axis and one value axis. */
export function salesChart(sales: readonly SalePoint[], lines: readonly TrendLine[], box: Box): SalesChartGeometry | null {
  if (sales.length === 0) return null;
  const times = [...sales.map((sale) => sale.time), ...lines.flatMap((line) => line.points.map((point) => point.time))];
  const values = [...sales.map((sale) => sale.price), ...lines.flatMap((line) => line.points.map((point) => point.value))];
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const low = ticks[0];
  const high = ticks.at(-1)!;
  const start = Math.floor(Math.min(...times));
  const end = Math.ceil(Math.max(...times));
  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;
  const round = (value: number) => Math.round(value * 10) / 10;
  const x = (time: number) => round(box.left + (end === start ? plotWidth / 2 : ((time - start) / (end - start)) * plotWidth));
  const y = (value: number) => round(high === low ? box.top + plotHeight / 2 : box.top + plotHeight - ((value - low) / (high - low)) * plotHeight);
  const span = end - start;
  const step = span <= 6 ? 1 : span <= 12 ? 2 : span <= 25 ? 5 : 10;
  const xTicks: { year: number; x: number }[] = [];
  for (let year = Math.ceil(start / step) * step; year <= end; year += step) xTicks.push({ year, x: x(year) });
  return {
    dots: sales.map((sale) => ({ x: x(sale.time), y: y(sale.price), sale })),
    lines: lines.map((line) => ({
      key: line.key, label: line.label,
      path: line.points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.time)},${y(point.value)}`).join(""),
    })),
    yTicks: ticks.map((value) => ({ value, y: y(value) })),
    xTicks,
  };
}

// ---- Postcode vs its areas ---------------------------------------------------

export interface CompareInput { id: string; label: string; value: number | null; note?: string }

/** Bars on one scale; areas without a figure are left out (said in the note instead). */
export function compareRows(inputs: readonly CompareInput[], format: (value: number) => string): MixRow[] {
  return inputs.flatMap((input) => input.value === null || input.value <= 0 ? [] : [{
    id: input.id, label: input.label, value: input.value, display: format(input.value),
  }]);
}

/** "12% above" / "8% below" / "in line with" (within 3%). */
export function relativeWords(value: number, reference: number): string {
  const change = (value - reference) / reference;
  if (Math.abs(change) < 0.03) return "in line with";
  return `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "above" : "below"}`;
}

/** London decile (1 = lowest tenth of London areas, 10 = highest) from a London percentile. */
export function londonDecile(percentile: number | null | undefined): number | null {
  if (percentile === null || percentile === undefined || !Number.isFinite(percentile)) return null;
  return Math.min(10, Math.max(1, Math.ceil(percentile / 10)));
}
