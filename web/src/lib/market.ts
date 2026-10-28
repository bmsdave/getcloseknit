/**
 * Local market by property type (HM Land Registry Price Paid, category A):
 * the contract of GET /api/v1/areas/{id}/market-by-type and /recent-sales, their
 * readers, wording and the chart geometry MarketSection draws. Missing values
 * stay null and read "unknown", never 0.
 */
import type { CoverageReason } from "./coverage-reason";
import type { Carrier, GeographyId } from "./contracts";
import { isFixtureSourceVersion } from "./fixtures";
import type { DataMode } from "./map-state";

export type PropertyTypeCode = "D" | "S" | "T" | "F" | "O";
export type MarketSeriesType = PropertyTypeCode | "all";
export type RecentSalesSort = "nearest" | "newest";

export const PROPERTY_TYPE_CODES: readonly PropertyTypeCode[] = ["D", "S", "T", "F", "O"];
export const PROPERTY_TYPE_LABELS: Record<MarketSeriesType, string> = {
  all: "All homes", D: "Detached", S: "Semi-detached", T: "Terraced", F: "Flat", O: "Other",
};
export const TENURE_LABELS: Record<string, string> = { F: "Freehold", L: "Leasehold", U: "Unknown" };
export const SQUARE_FEET_PER_SQUARE_METRE = 10.7639;
export const RECENT_PAGE_SIZE = 20;

export interface MarketTypeStats {
  propertyType: MarketSeriesType;
  sales: number;
  medianPrice: number | null;
  p5: number | null;
  p25: number | null;
  p75: number | null;
  p95: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  pricePerSquareMetreSales: number;
  medianPricePerSquareMetre: number | null;
}

export interface MarketTrendPoint {
  windowEnd: string;
  sales: number;
  medianPrice: number | null;
  medianPricePerSquareMetre: number | null;
}

export interface MarketTrendSeries {
  propertyType: MarketSeriesType;
  points: MarketTrendPoint[];
}

export interface MarketBasis {
  geographyId: GeographyId;
  name: string;
  carrier: Carrier;
  widened: boolean;
  minimumSales: number;
}

export interface AreaMarketResponse {
  schemaVersion: "area-market-by-type.v1";
  productReleaseId?: string;
  geographyId: GeographyId;
  name: string | null;
  available: boolean;
  basis: MarketBasis | null;
  window: { start: string; end: string } | null;
  summary: MarketTypeStats | null;
  byType: MarketTypeStats[];
  trend: MarketTrendSeries[];
  sourceVersion: string | null;
  attribution: string | null;
  caveats: string[];
}

export interface RecentSale {
  transactionId: string;
  date: string;
  address: string;
  postcode: string;
  propertyType: PropertyTypeCode;
  tenure: string;
  newBuild: boolean;
  price: number;
  distanceMetres: number | null;
}

export interface RecentSalesResponse {
  schemaVersion: "area-recent-sales.v1";
  geographyId: GeographyId;
  basis: MarketBasis;
  months: number;
  since: string | null;
  until: string | null;
  sort: RecentSalesSort;
  page: number;
  pageSize: number;
  total: number;
  sales: RecentSale[];
  sourceVersion: string | null;
  /** "london-only": each sale is per-home data, London's alone, and this area is elsewhere (no list, not "none"). */
  coverage?: CoverageReason | null;
}

export function marketPath(id: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/market-by-type`;
}

export function recentSalesPath(id: GeographyId, page: number, sort: RecentSalesSort, pageSize = RECENT_PAGE_SIZE): string {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
  return `/api/v1/areas/${encodeURIComponent(id)}/recent-sales?${query.toString()}`;
}

/** Parse a market payload; real mode never accepts demo numbers. */
export function readAreaMarket(payload: unknown, mode: DataMode): AreaMarketResponse | null {
  const market = payload as Partial<AreaMarketResponse> | null;
  if (!market || market.schemaVersion !== "area-market-by-type.v1" || !Array.isArray(market.byType) || !Array.isArray(market.trend)) {
    return null;
  }
  if (mode === "real" && market.sourceVersion && isFixtureSourceVersion(market.sourceVersion)) return null;
  return market as AreaMarketResponse;
}

export function readRecentSales(payload: unknown, mode: DataMode): RecentSalesResponse | null {
  const list = payload as Partial<RecentSalesResponse> | null;
  if (!list || list.schemaVersion !== "area-recent-sales.v1" || !Array.isArray(list.sales) || !list.basis) return null;
  if (mode === "real" && list.sourceVersion && isFixtureSourceVersion(list.sourceVersion)) return null;
  return list as RecentSalesResponse;
}

export function perSquareFoot(perSquareMetre: number | null): number | null {
  return perSquareMetre === null ? null : perSquareMetre / SQUARE_FEET_PER_SQUARE_METRE;
}

export function formatPounds(value: number | null): string {
  return value === null ? "unknown" : `£${Math.round(value).toLocaleString("en-GB")}`;
}

/** Short money for chart axes: £950, £85k, £1.2m. */
export function formatPoundsShort(value: number): string {
  const size = Math.abs(value);
  if (size >= 1_000_000) return `£${trim(value / 1_000_000)}m`;
  if (size >= 10_000) return `£${Math.round(value / 1000)}k`;
  if (size >= 1000) return `£${trim(value / 1000)}k`;
  return `£${Math.round(value)}`;
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07" → "Jul 2026". */
export function formatMonth(period: string): string {
  const [year, month] = period.split("-");
  return `${MONTHS[Number(month) - 1] ?? "?"} ${year}`;
}

/** "2026-06-22" → "22 Jun 2026". */
export function formatDay(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? "?"} ${year}`;
}

const CARRIER_WORDS: Record<Carrier, string> = {
  lsoa: "this neighbourhood", msoa: "the wider neighbourhood", lad: "the borough",
};

/** One plain sentence on which area the figures describe. */
export function basisSentence(basis: MarketBasis, sales: number): string {
  const count = `${sales.toLocaleString("en-GB")} sale${sales === 1 ? "" : "s"}`;
  if (!basis.widened) return `Based on ${count} in ${CARRIER_WORDS[basis.carrier]} in the last 12 months.`;
  return `Fewer than ${basis.minimumSales} homes sold here in a year, so these figures cover ${CARRIER_WORDS[basis.carrier]}, ${basis.name} (${count}).`;
}

/** Types that have any sale in the latest 12 months, in the fixed order. */
export function typesWithSales(market: AreaMarketResponse): MarketTypeStats[] {
  return market.byType.filter((stats) => stats.sales > 0);
}

// ---------------------------------------------------------------- charts

export interface Box {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** About `count` round tick values covering [low, high]. */
export function niceTicks(low: number, high: number, count = 4): number[] {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [];
  if (high === low) return [low];
  const raw = (high - low) / Math.max(1, count - 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let tick = Math.floor(low / step) * step; tick <= high + step * 1e-9; tick += step) {
    ticks.push(Math.round(tick * 1e6) / 1e6);
  }
  if (ticks.at(-1)! < high) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

export interface LineSeriesInput {
  key: MarketSeriesType;
  values: readonly (number | null)[];
}

export interface LineChartGeometry {
  /** One path per series; a gap (null) breaks the line. */
  lines: { key: MarketSeriesType; path: string; points: { index: number; x: number; y: number; value: number }[] }[];
  ticks: { value: number; y: number }[];
  xs: number[];
}

/** Shared y scale (from the lowest tick, not from 0) for several yearly series. */
export function lineChart(series: readonly LineSeriesInput[], slots: number, box: Box): LineChartGeometry | null {
  const observed = series.flatMap((entry) => entry.values.filter((value): value is number => value !== null));
  if (observed.length === 0 || slots < 1) return null;
  const tickValues = niceTicks(Math.min(...observed), Math.max(...observed));
  const low = tickValues[0];
  const high = tickValues.at(-1)!;
  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;
  const x = (index: number) => round(box.left + (slots === 1 ? plotWidth / 2 : (index / (slots - 1)) * plotWidth));
  const y = (value: number) => round(high === low ? box.top + plotHeight / 2 : box.top + plotHeight - ((value - low) / (high - low)) * plotHeight);
  const lines = series.map((entry) => {
    const points = entry.values.flatMap((value, index) => value === null ? [] : [{ index, x: x(index), y: y(value), value }]);
    let path = "";
    entry.values.forEach((value, index) => {
      if (value === null) return;
      path += `${index > 0 && entry.values[index - 1] !== null ? "L" : "M"}${x(index)},${y(value)}`;
    });
    return { key: entry.key, path, points };
  }).filter((line) => line.points.length > 0);
  return {
    lines,
    ticks: tickValues.map((value) => ({ value, y: y(value) })),
    xs: Array.from({ length: slots }, (_, index) => x(index)),
  };
}

export interface BoxRow {
  key: MarketSeriesType;
  y: number;
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
}

/** Horizontal box plot rows (P5–P95 whiskers, P25–P75 box, median) on one shared price axis. */
export function boxPlot(stats: readonly MarketTypeStats[], box: Box, rowHeight: number):
  { rows: BoxRow[]; ticks: { value: number; x: number }[] } | null {
  const usable = stats.filter((entry) => entry.p5 !== null && entry.p25 !== null && entry.medianPrice !== null
    && entry.p75 !== null && entry.p95 !== null);
  if (usable.length === 0) return null;
  const tickValues = niceTicks(Math.min(...usable.map((entry) => entry.p5!)), Math.max(...usable.map((entry) => entry.p95!)));
  const low = tickValues[0];
  const high = tickValues.at(-1)!;
  const plotWidth = box.width - box.left - box.right;
  const x = (value: number) => round(high === low ? box.left + plotWidth / 2 : box.left + ((value - low) / (high - low)) * plotWidth);
  return {
    rows: usable.map((entry, index) => ({
      key: entry.propertyType,
      y: round(box.top + index * rowHeight + rowHeight / 2),
      p5: x(entry.p5!), p25: x(entry.p25!), median: x(entry.medianPrice!), p75: x(entry.p75!), p95: x(entry.p95!),
    })),
    ticks: tickValues.map((value) => ({ value, x: x(value) })),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
