/**
 * "Since your last visit" on each saved area: new sales and the £ per m² move since this
 * device last opened Saved. GET /api/v1/areas/{id}/since counts the standard sales completed after the
 * newest one seen last time and gives today's median £ per m²; the device keeps what it saw (one small
 * versioned document per device, never sent anywhere), so the move is today's median against that.
 *
 * A visit is a day: opening Saved again the same day keeps comparing with the visit before, so the line
 * holds still all day; the first visit only records what it saw and shows no line.
 */
import type { GeographyId } from "./contracts";
import type { MarketBasis } from "./market";

export const SAVED_SINCE_KEY = "close-knit.saved-since.v1";
/** At most this many saved areas are checked per visit (the newest first). */
export const MAX_SINCE_AREAS = 8;
/** A move under this share of the median reads as no change. */
const MOVE_THRESHOLD = 0.005;

export interface AreaSinceResponse {
  schemaVersion: "area-since.v1";
  geographyId: GeographyId;
  date: string;
  basis: MarketBasis;
  months: number;
  newSales: number;
  newestSale: string | null;
  /** The area view's Price tile (its value and month); sales is null for a borough or MSOA. */
  pricePerSquareMetre: { median: number | null; windowEnd: string | null; sales: number | null };
  sourceVersion: string | null;
  attribution: string | null;
  caveats: string[];
}

/** What this device saw of one area on one day. */
export interface SinceSeen {
  /** The visit, YYYY-MM-DD (local day). */
  on: string;
  /** The newest sale on the register then; the next visit counts sales after it. */
  newest: string | null;
  /** Median £ per m² then, and the 12-month window it came from. */
  ppm: number | null;
  windowEnd: string | null;
}

/** One area's record: the last visit and, while that is today, the visit before it. */
export interface SinceRecord extends SinceSeen {
  previous?: SinceSeen;
}

export type SinceStore = Record<string, SinceRecord>;

/** The local day, YYYY-MM-DD. */
export function localDay(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function cleanSeen(value: unknown): SinceSeen | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.on !== "string" || !DAY.test(entry.on)) return null;
  return {
    on: entry.on,
    newest: typeof entry.newest === "string" && DAY.test(entry.newest) ? entry.newest : null,
    ppm: typeof entry.ppm === "number" && Number.isFinite(entry.ppm) && entry.ppm > 0 ? entry.ppm : null,
    windowEnd: typeof entry.windowEnd === "string" && MONTH.test(entry.windowEnd) ? entry.windowEnd : null,
  };
}

/**
 * The £ per m² is the area view's Price tile (the figure on the same row). A v1 document kept the market
 * summary's median, another series: its sales stay, its £ per m² is forgotten (so no move against it is shown).
 */
const SINCE_SCHEMA = "saved-since.v2";
const OLD_SERIES_SCHEMA = "saved-since.v1";

function withoutOldPrice(seen: SinceSeen): SinceSeen {
  return { ...seen, ppm: null, windowEnd: null };
}

/** The stored document, with anything malformed dropped (never repaired into something else). */
export function parseSinceStore(raw: string | null): SinceStore {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown; areas?: unknown };
    const old = parsed.schemaVersion === OLD_SERIES_SCHEMA;
    if ((parsed.schemaVersion !== SINCE_SCHEMA && !old) || !parsed.areas || typeof parsed.areas !== "object") return {};
    const store: SinceStore = {};
    for (const [id, value] of Object.entries(parsed.areas as Record<string, unknown>)) {
      const read = cleanSeen(value);
      if (!read || !/^uk:(lsoa|msoa|lad):E\d{8}$/.test(id)) continue;
      const seen = old ? withoutOldPrice(read) : read;
      const before = cleanSeen((value as { previous?: unknown }).previous);
      const previous = before && old ? withoutOldPrice(before) : before;
      store[id] = previous && previous.on < seen.on ? { ...seen, previous } : seen;
    }
    return store;
  } catch {
    return {};
  }
}

export function serializeSinceStore(store: SinceStore): string {
  return JSON.stringify({ schemaVersion: SINCE_SCHEMA, areas: store });
}

/** The visit to compare with today: the last one, or the one before it when the last is today. */
export function baselineFor(record: SinceRecord | undefined, today: string): SinceSeen | null {
  if (!record) return null;
  if (record.on < today) return record;
  return record.previous ?? null;
}

/** The date to ask the API about: sales after the newest one seen, else after that visit's day. */
export function sinceQueryDate(baseline: SinceSeen | null, today: string): string {
  return baseline?.newest ?? baseline?.on ?? today;
}

/** Today's record: what the answer shows, keeping the visit before when the last one is today too. */
export function recordVisit(record: SinceRecord | undefined, answer: AreaSinceResponse, today: string): SinceRecord {
  const seen: SinceSeen = {
    on: today,
    newest: answer.newestSale ?? record?.newest ?? null,
    ppm: answer.pricePerSquareMetre.median,
    windowEnd: answer.pricePerSquareMetre.windowEnd,
  };
  const previous = record ? (record.on < today ? stripPrevious(record) : record.previous) : undefined;
  return previous ? { ...seen, previous } : seen;
}

function stripPrevious(record: SinceRecord): SinceSeen {
  return { on: record.on, newest: record.newest, ppm: record.ppm, windowEnd: record.windowEnd };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]}`;
}

export interface SinceLine {
  text: string;
  /** Something changed (new sales or a price move): the line is ink, else muted. */
  changed: boolean;
}

/**
 * The line under a saved area: "Since 12 Oct: 3 new sales · £/m² up 2%", or "No change since 12 Oct".
 * Null on a first visit. A price move counts only when the 12-month window has moved on and both medians
 * are known; it is the area's median, never a figure for one home.
 */
export function sinceLine(baseline: SinceSeen | null, answer: AreaSinceResponse): SinceLine | null {
  if (!baseline) return null;
  const parts: string[] = [];
  if (answer.newSales > 0) parts.push(`${answer.newSales} new sale${answer.newSales === 1 ? "" : "s"}`);
  const now = answer.pricePerSquareMetre;
  if (baseline.ppm !== null && now.median !== null && now.windowEnd !== null && now.windowEnd !== baseline.windowEnd) {
    const move = (now.median - baseline.ppm) / baseline.ppm;
    if (Math.abs(move) >= MOVE_THRESHOLD) {
      const percent = Math.max(1, Math.round(Math.abs(move) * 100));
      parts.push(`£/m² ${move > 0 ? "up" : "down"} ${percent}%`);
    }
  }
  const when = dayLabel(baseline.on);
  return parts.length ? { text: `Since ${when}: ${parts.join(" · ")}`, changed: true } : { text: `No change since ${when}`, changed: false };
}

export function sincePath(id: GeographyId, date: string): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/since?${new URLSearchParams({ date }).toString()}`;
}

export function readSinceStore(): SinceStore {
  try {
    return parseSinceStore(window.localStorage.getItem(SAVED_SINCE_KEY));
  } catch {
    return {};
  }
}

export function writeSinceStore(store: SinceStore): void {
  try {
    window.localStorage.setItem(SAVED_SINCE_KEY, serializeSinceStore(store));
  } catch {
    // Storage full or blocked: the next visit shows no line, nothing breaks.
  }
}
