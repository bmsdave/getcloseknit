/**
 * Postcode sector pages (/sector/W5-1): pure parsing, scales and formatting.
 * The page and its charts (components/sector-charts.tsx) only draw what these
 * return, so the numbers are unit-tested here (tests/sector.test.ts).
 * Aggregates only: a sector's or a street's middle, never one home.
 */
import type {
  MultiPolygon, Polygon, Position,
} from "geojson";

import type {
  SectorDistribution, SectorIndexPoint, SectorIndexZone, SectorListItem, SectorReturn, SectorValue,
} from "./contracts";
import { formatPerArea } from "./money-format";
import { normalisePostcode } from "./postcode-page";

const OUTWARD = "[A-Z]{1,2}\\d[A-Z\\d]?";
const SECTOR_CODE = new RegExp(`^(${OUTWARD}) (\\d)$`);
/** A typed sector needs its separator: "W5 1" or "W5-1", never "W51" (district W51? sector W5 1?). */
const SECTOR_QUERY = new RegExp(`^(${OUTWARD})[\\s-]+(\\d)$`, "i");

// ---- Codes, slugs, links --------------------------------------------------------------------

/** "W5-1", "w5 1", "W5%201" → { code: "W5 1", slug: "W5-1" }; null for anything else. */
export function sectorFromParam(param: string): { code: string; slug: string } | null {
  let text = param.replace(/\+/g, " ");
  try {
    text = decodeURIComponent(text);
  } catch {
    // a malformed escape is read as typed
  }
  const match = SECTOR_CODE.exec(text.trim().toUpperCase().replace(/[-_\s]+/g, " "));
  if (!match) return null;
  const code = `${match[1]} ${match[2]}`;
  return { code, slug: sectorSlug(code) };
}

export function sectorSlug(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "-");
}

export function sectorPath(code: string): string {
  return `/sector/${sectorSlug(code)}`;
}

/** The sector a full postcode sits in: "W5 1AA" → "W5 1". */
export function sectorOfPostcode(postcode: string): string | null {
  const normal = normalisePostcode(postcode);
  return normal ? normal.slice(0, -2) : null;
}

/** A search box query that names a sector ("w5 1", "W5-1") → "W5 1"; null otherwise. */
export function sectorQuery(query: string): string | null {
  const match = SECTOR_QUERY.exec(query.trim());
  return match ? `${match[1].toUpperCase()} ${match[2]}` : null;
}

/** "W5 1 · Ealing Broadway", or the code alone while the name is unknown. */
export function sectorTitle(sector: { code: string; name: string | null }): string {
  return sector.name ? `${sector.code} · ${sector.name}` : sector.code;
}

// ---- Reading the API -----------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * The sector from GET /api/v1/sectors/{slug}: the envelope's value, or the bare
 * value. Null when the payload has no sector code; missing lists read as empty.
 */
export function readSector(payload: unknown): SectorValue | null {
  const body = record(payload);
  const value = record(body?.value) ?? body;
  const sector = record(value?.sector);
  if (!value || !sector || typeof sector.code !== "string" || typeof sector.slug !== "string") return null;
  const list = <T>(key: string): T[] => (Array.isArray(value[key]) ? value[key] as T[] : []);
  return {
    sector: value.sector as SectorValue["sector"],
    distribution: (record(value.distribution) as SectorValue["distribution"]) ?? null,
    index: (record(value.index) as SectorValue["index"]) ?? null,
    returns: list("returns"),
    nearby: list("nearby"),
    streets: list("streets"),
  };
}

/** GET /api/v1/sectors?q=: a bare list or an envelope of one; rows without a code and slug are dropped. */
export function readSectorList(payload: unknown): SectorListItem[] {
  const rows = Array.isArray(payload) ? payload : record(payload)?.value;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const item = record(row);
    if (!item || typeof item.code !== "string" || typeof item.slug !== "string") return [];
    const center = Array.isArray(item.center) && item.center.length === 2 && item.center.every((n) => typeof n === "number")
      ? item.center as [number, number] : null;
    return [{ code: item.code, slug: item.slug, name: typeof item.name === "string" ? item.name : null, ...(center ? { center } : {}) }];
  });
}

// ---- Scales ---------------------------------------------------------------------------------

export interface LinearScale {
  (value: number): number;
  domain: readonly [number, number];
}

/** Maps domain onto range; a zero-width domain maps to the middle of the range. */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]): LinearScale {
  const [d0, d1] = domain, [r0, r1] = range;
  const scale = ((value: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0))) as LinearScale;
  scale.domain = domain;
  return scale;
}

/** A round step (1, 2 or 5 × 10ⁿ) giving about `count` intervals over `span`. */
export function niceStep(span: number, count = 4): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/** The domain widened to whole steps, with every tick inside it. */
export function niceDomain(min: number, max: number, count = 4): { domain: [number, number]; ticks: number[] } {
  if (min === max) return { domain: [min - 1, max + 1], ticks: [min] };
  const step = niceStep(max - min, count);
  const low = Math.floor(min / step) * step, high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(+tick.toFixed(6));
  return { domain: [low, high], ticks };
}

/** The shared £/m² scale for the nearby rows: lowest p25 to highest p75; null when no row has both. */
export function sharedRange(rows: readonly { p25: number | null; p75: number | null }[]): { domain: [number, number]; ticks: number[] } | null {
  const known = rows.filter((row): row is { p25: number; p75: number } => row.p25 !== null && row.p75 !== null);
  if (known.length === 0) return null;
  return niceDomain(Math.min(...known.map((row) => row.p25)), Math.max(...known.map((row) => row.p75)), 3);
}

/** The histogram's £/m² domain: the sector's buckets, widened to the district's p09–p91 so both strips fit. */
export function distributionDomain(sector: SectorDistribution, district: SectorDistribution | null): [number, number] {
  const edges = sector.buckets.flatMap((bucket) => [bucket.from, bucket.to]);
  const values = [...edges, sector.p09, sector.p91, ...(district ? [district.p09, district.p91] : [])];
  return [Math.min(...values), Math.max(...values)];
}

export interface HistogramBar { x: number; width: number; height: number; from: number; to: number; count: number }

/** One bar per bucket, heights against the tallest bucket; `gap` user units between bars. */
export function histogramBars(buckets: SectorDistribution["buckets"], x: LinearScale, plotHeight: number, gap = 2): HistogramBar[] {
  const tallest = Math.max(0, ...buckets.map((bucket) => bucket.count));
  return buckets.map((bucket) => {
    const left = x(bucket.from), right = x(bucket.to);
    return {
      x: left + gap / 2, width: Math.max(0, right - left - gap),
      height: tallest > 0 ? (bucket.count / tallest) * plotHeight : 0,
      from: bucket.from, to: bucket.to, count: bucket.count,
    };
  });
}

/** A box strip's positions: p09–p91 whiskers, the p25–p75 box and the p50 line. */
export function boxGeometry(distribution: Pick<SectorDistribution, "p09" | "p25" | "p50" | "p75" | "p91">, x: LinearScale) {
  return {
    whiskerFrom: x(distribution.p09), whiskerTo: x(distribution.p91),
    boxFrom: x(distribution.p25), boxTo: x(distribution.p75), median: x(distribution.p50),
  };
}

/** An inline p25–p75 bar on the shared scale, as fractions 0..1 of the row's width. */
export function rangeBar(row: { p25: number | null; p50: number | null; p75: number | null }, domain: readonly [number, number]) {
  if (row.p25 === null || row.p75 === null) return null;
  const at = linearScale(domain, [0, 1]);
  return { from: at(row.p25), to: at(row.p75), median: row.p50 === null ? null : at(row.p50) };
}

// ---- Index chart ----------------------------------------------------------------------------

export interface IndexLine {
  zone: SectorIndexZone;
  /** SVG path data per unbroken run of years; a null year breaks the line. */
  nominal: string[];
  real: string[];
  /** The last real point: the line's end dot. */
  end: { x: number; y: number; year: number; value: number } | null;
}

export interface IndexChart {
  lines: IndexLine[];
  yTicks: { value: number; y: number }[];
  xTicks: { year: number; x: number }[];
}

const r1 = (value: number) => Math.round(value * 10) / 10;

function runs(points: readonly SectorIndexPoint[], key: "nominal" | "real", x: LinearScale, y: LinearScale): string[] {
  const paths: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    const value = point[key];
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 1) paths.push(current.join(""));
      current = [];
      continue;
    }
    current.push(`${current.length ? "L" : "M"}${r1(x(point.year))} ${r1(y(value))}`);
  }
  if (current.length > 1) paths.push(current.join(""));
  return paths;
}

/**
 * The index lines for `zones` (nominal and real each), on one y scale over every value drawn.
 * Null when no zone has two known years.
 */
export function indexChart(
  series: readonly { zone: SectorIndexZone; points: SectorIndexPoint[] }[],
  zones: readonly SectorIndexZone[],
  box: { width: number; height: number; left: number; right: number; top: number; bottom: number },
): IndexChart | null {
  const shown = zones.flatMap((zone) => series.filter((entry) => entry.zone === zone));
  const values = shown.flatMap((entry) => entry.points.flatMap((point) => [point.nominal, point.real]))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const years = shown.flatMap((entry) => entry.points.filter((point) => point.nominal !== null || point.real !== null).map((point) => point.year));
  if (values.length < 2 || new Set(years).size < 2) return null;
  const { domain, ticks } = niceDomain(Math.min(...values), Math.max(...values), 4);
  const y = linearScale(domain, [box.height - box.bottom, box.top]);
  const x = linearScale([Math.min(...years), Math.max(...years)], [box.left, box.width - box.right]);
  const lines = shown.map((entry): IndexLine => {
    const last = [...entry.points].reverse().find((point) => point.real !== null);
    return {
      zone: entry.zone,
      nominal: runs(entry.points, "nominal", x, y),
      real: runs(entry.points, "real", x, y),
      end: last?.real != null ? { x: r1(x(last.year)), y: r1(y(last.real)), year: last.year, value: last.real } : null,
    };
  });
  const [first, final] = x.domain;
  const step = final - first > 12 ? 5 : final - first > 5 ? 2 : 1;
  const xTicks: { year: number; x: number }[] = [];
  for (let year = Math.ceil(first / step) * step; year <= final; year += step) xTicks.push({ year, x: r1(x(year)) });
  return { lines, yTicks: ticks.map((value) => ({ value, y: r1(y(value)) })), xTicks };
}

// ---- Headline and returns -------------------------------------------------------------------

const MINUS = "−";

/** A growth fraction as a signed percent: 0.032 → "+3.2%", −0.01 → "−1.0%"; null → "—". */
export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const percent = Math.round(value * 1000) / 10;
  if (percent === 0) return "0.0%";
  return `${percent > 0 ? "+" : MINUS}${Math.abs(percent).toFixed(1)}%`;
}

/** A £/m² range with the unit once: "£7,310–£9,180/m²". */
export function formatPpmRange(low: number, high: number): string {
  return `${formatPerArea(low, "")}–${formatPerArea(high)}`;
}

export const RETURN_YEARS = [1, 5, 10, 20] as const;

export interface ReturnsRow {
  years: (typeof RETURN_YEARS)[number];
  sector: { nominal: string; real: string } | null;
  district: { nominal: string; real: string } | null;
}

/** The returns table: a row per horizon either zone has, a year's growth (compound) as text. */
export function returnsRows(returns: readonly SectorReturn[]): ReturnsRow[] {
  const cell = (years: number, zone: SectorReturn["zone"]) => {
    const row = returns.find((entry) => entry.years === years && entry.zone === zone);
    return row ? { nominal: formatRate(row.nominalPa), real: formatRate(row.realPa) } : null;
  };
  return RETURN_YEARS
    .map((years) => ({ years, sector: cell(years, "sector"), district: cell(years, "district") }))
    .filter((row) => row.sector || row.district);
}

export interface SectorHeadline {
  /** Middle £/m² of the sector's sales in 24 months; null when suppressed (under 20 sales). */
  median: number | null;
  sales: number | null;
  /** The sector's real (after CPIH) change over the last year, a fraction; null when not published. */
  realChange: number | null;
  periodEnd: string | null;
}

export function sectorHeadline(value: SectorValue): SectorHeadline {
  const sector = value.distribution?.sector ?? null;
  const year = value.returns.find((entry) => entry.years === 1 && entry.zone === "sector");
  return {
    median: sector?.p50 ?? null,
    sales: sector?.sales ?? null,
    realChange: year ? year.realPa : null,
    periodEnd: value.distribution?.periodEnd ?? null,
  };
}

// ---- Mini map -------------------------------------------------------------------------------

/**
 * The boundary as SVG path data fitted into width × height (equirectangular,
 * longitude scaled by cos(latitude) so the shape is not stretched). Null without rings.
 */
export function outlinePath(geometry: Polygon | MultiPolygon | null, width: number, height: number, pad = 4): string | null {
  if (!geometry) return null;
  const polygons: Position[][][] = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const all = polygons.flat(2);
  if (all.length < 3) return null;
  const lons = all.map((point) => point[0]), lats = all.map((point) => point[1]);
  const [west, east, south, north] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const squash = Math.cos(((south + north) / 2) * Math.PI / 180);
  const spanX = (east - west) * squash, spanY = north - south;
  const unit = Math.min((width - pad * 2) / (spanX || 1), (height - pad * 2) / (spanY || 1));
  const offsetX = (width - spanX * unit) / 2, offsetY = (height - spanY * unit) / 2;
  const project = ([lon, lat]: Position) => `${r1(offsetX + (lon - west) * squash * unit)} ${r1(offsetY + (north - lat) * unit)}`;
  return polygons.flatMap((polygon) => polygon.map((ring) => `M${ring.map(project).join("L")}Z`)).join("");
}
