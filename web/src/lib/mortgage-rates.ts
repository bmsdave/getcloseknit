// Bank Rate against quoted 2-, 3- and 5-year fixed mortgage rates at 75%
// loan-to-value, monthly, from the Bank of England database (IADB). The
// numbers live in a dated JSON next to this file; this module parses the
// IADB CSV (to refresh that JSON) and lays the series out as an SVG chart.
// A month the Bank has not published yet stays null and breaks the line.

export type RateKey = "bankRate" | "fixed2" | "fixed3" | "fixed5";

export const RATE_KEYS: readonly RateKey[] = ["bankRate", "fixed2", "fixed3", "fixed5"];

/** IADB series code for each line. */
export const IADB_SERIES: Record<RateKey, string> = {
  bankRate: "IUMABEDR",
  fixed2: "IUMBV34",
  fixed3: "IUMBV37",
  fixed5: "IUMBV42",
};

export const RATE_LABELS: Record<RateKey, string> = {
  bankRate: "Bank Rate",
  fixed2: "2-year fixed",
  fixed3: "3-year fixed",
  fixed5: "5-year fixed",
};

export interface RatePoint {
  /** Calendar month, YYYY-MM. */
  month: string;
  bankRate: number | null;
  fixed2: number | null;
  fixed3: number | null;
  fixed5: number | null;
}

export interface RateDataset {
  meta: {
    source: string;
    url: string;
    retrieved: string;
    licence: string;
    attribution: string;
    series: Record<RateKey, { code: string; title: string }>;
    refresh: string;
  };
  points: RatePoint[];
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/**
 * Parse an IADB CSV export (CSVF=TN, UsingCodes=Y): a `DATE,<codes…>`
 * header, then rows like `31 Jan 1996,6.25,7.1,,`. Months before
 * `fromMonth` are dropped. Blank cells become null, never 0.
 */
export function parseIadbCsv(csv: string, fromMonth = "1996-01"): RatePoint[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]?.split(",").map((cell) => cell.trim()) ?? [];
  if (header[0] !== "DATE") throw new Error("IADB CSV must start with a DATE column");
  const column = (key: RateKey) => {
    const index = header.indexOf(IADB_SERIES[key]);
    if (index < 0) throw new Error(`IADB CSV is missing series ${IADB_SERIES[key]}`);
    return index;
  };
  const indexes = Object.fromEntries(RATE_KEYS.map((key) => [key, column(key)])) as Record<RateKey, number>;
  const points: RatePoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const month = isoMonth(cells[0] ?? "");
    if (month < fromMonth) continue;
    points.push({
      month,
      bankRate: cell(cells[indexes.bankRate]),
      fixed2: cell(cells[indexes.fixed2]),
      fixed3: cell(cells[indexes.fixed3]),
      fixed5: cell(cells[indexes.fixed5]),
    });
  }
  return points;
}

function isoMonth(date: string): string {
  const match = /^\s*\d{1,2} ([A-Z][a-z]{2}) (\d{4})\s*$/.exec(date);
  const month = match ? MONTHS[match[1]] : undefined;
  if (!match || !month) throw new Error(`unrecognised IADB date "${date}"`);
  return `${match[2]}-${month}`;
}

function cell(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** The latest month with a value for every line, or null. */
export function latestComplete(points: readonly RatePoint[]): RatePoint | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (RATE_KEYS.every((key) => point[key] !== null)) return point;
  }
  return null;
}

/** Fixed rate minus Bank Rate, in percentage points (null when either is missing). */
export function spreadOverBankRate(point: RatePoint, key: Exclude<RateKey, "bankRate">): number | null {
  const fixed = point[key];
  if (fixed === null || point.bankRate === null) return null;
  return Math.round((fixed - point.bankRate) * 100) / 100;
}

export interface RateChartBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RateChart {
  lines: { key: RateKey; segments: string[] }[];
  yTicks: { value: number; y: number }[];
  xTicks: { label: string; x: number }[];
  maxRate: number;
}

/**
 * SVG geometry for the chart. The y axis runs from 0 to the next whole
 * multiple of `yStep` above the highest rate, so 0% sits on the baseline.
 * The x axis is one step per month; ticks mark January every `yearStep` years.
 */
export function rateChart(
  points: readonly RatePoint[],
  box: RateChartBox,
  { yStep = 2, yearStep = 5 }: { yStep?: number; yearStep?: number } = {},
): RateChart {
  const values = points.flatMap((point) => RATE_KEYS.map((key) => point[key])).filter((v): v is number => v !== null);
  const maxRate = values.length === 0 ? yStep : Math.max(yStep, Math.ceil(Math.max(...values) / yStep) * yStep);
  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;
  const x = (index: number) => box.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => box.top + plotHeight - (value / maxRate) * plotHeight;
  const lines = RATE_KEYS.map((key) => ({ key, segments: segmentsFor(points, key, x, y) }));
  const yTicks: RateChart["yTicks"] = [];
  for (let value = 0; value <= maxRate; value += yStep) yTicks.push({ value, y: round(y(value)) });
  const xTicks = points.flatMap((point, index) => {
    const [year, month] = point.month.split("-");
    return month === "01" && Number(year) % yearStep === 0 ? [{ label: year, x: round(x(index)) }] : [];
  });
  return { lines, yTicks, xTicks, maxRate };
}

function segmentsFor(
  points: readonly RatePoint[],
  key: RateKey,
  x: (index: number) => number,
  y: (value: number) => number,
): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    const value = point[key];
    if (value === null) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${round(x(index))},${round(y(value))}`);
  });
  if (current.length > 0) segments.push(current.join(" "));
  return segments;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatMonth(month: string): string {
  const [year, number] = month.split("-");
  const name = Object.keys(MONTHS).find((key) => MONTHS[key] === number) ?? number;
  return `${name} ${year}`;
}
