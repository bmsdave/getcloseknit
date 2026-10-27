import type { ListingFacts, PageSnapshot } from "../types";

const SQFT_TO_SQM = 0.09290304;
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i;

export function snapshot(doc: Document, url: string): PageSnapshot {
  const scripts = [...doc.scripts];
  const map = doc.getElementById("map");
  return {
    url,
    scripts: scripts.filter((s) => !s.type || s.type === "text/javascript").map((s) => s.textContent ?? ""),
    jsonLd: scripts.filter((s) => s.type === "application/ld+json").map((s) => s.textContent ?? ""),
    nextData: doc.getElementById("__NEXT_DATA__")?.textContent ?? null,
    title: doc.title,
    mapData: map ? { ...map.dataset } as Record<string, string> : null,
  };
}

/** The JSON object that starts at the first "{" after `marker` in `text`. */
export function objectAfter(text: string, marker: string): unknown {
  const block = blockAfter(text, marker);
  if (!block) return null;
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

/**
 * The text of the {…} block (or […] with `open` "[") that starts at the first `open` after `marker`
 * (strings and escapes respected).
 */
export function blockAfter(text: string, marker: string, open: "{" | "[" = "{"): string | null {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const start = text.indexOf(open, at + marker.length);
  if (start < 0) return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** "£2,000 pcm" → 2000; "£450 pw" → a monthly figure; "POA" → null. */
export function parsePrice(text: unknown, market: "buy" | "rent"): number | null {
  if (typeof text === "number") return text > 0 ? Math.round(text) : null;
  if (typeof text !== "string") return null;
  const digits = text.replace(/[^\d.]/g, "");
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(market === "rent" && /\bp\.?w\b|per week|weekly/i.test(text) ? (value * 52) / 12 : value);
}

/** "484 sq. ft" or "45 sq. m" → m². */
export function parseArea(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const value = Number.parseFloat(text.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const sqm = /sq\.?\s*f|ft/i.test(text) ? value * SQFT_TO_SQM : value;
  return sqm > 5 && sqm < 2000 ? Math.round(sqm * 10) / 10 : null;
}

export function postcodeOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return POSTCODE.test(code) ? code : null;
}

export function numberOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function bedroomsOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 10 ? n : null;
}

export function tenureOf(value: unknown): ListingFacts["tenure"] {
  const text = typeof value === "string" ? value.toLowerCase().replace(/_/g, " ") : "";
  if (text.includes("share of freehold")) return "share-of-freehold";
  if (text.includes("freehold")) return "freehold";
  if (text.includes("leasehold")) return "leasehold";
  return "unknown";
}

export function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function get(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// Listing facts v2: each reader returns null unless the page states the fact plainly.

type PropertyType = NonNullable<ListingFacts["propertyType"]>;

/** "Semi-Detached", "semi_detached_house", "Apartment", "3 Bed Terraced House" → the contract's kind. */
export function propertyTypeOf(value: unknown): PropertyType | null {
  if (typeof value !== "string") return null;
  const text = value.toLowerCase().replace(/[_-]/g, " ");
  if (/bungalow/.test(text)) return "bungalow";
  if (/semi ?detached/.test(text)) return "semi-detached";
  if (/\bdetached/.test(text)) return "detached";
  if (/terrace/.test(text)) return "terraced";
  if (/\b(flat|apartment|maisonette|penthouse|studio|duplex|triplex)\b/.test(text)) return "flat";
  if (/\b(land|plot|house ?boat|park home|mobile home|caravan|garage|parking|commercial)\b/.test(text)) return "other";
  // A plain "house", "town house" or "cottage" says nothing about its kind of house.
  return null;
}

/** "D", "Band D" → "D"; "TBC", "Ask agent", "Not available" → null. */
export function councilTaxBandOf(value: unknown): ListingFacts["councilTaxBand"] {
  const band = typeof value === "string" ? /^\s*(?:band\s*)?([A-I])\s*$/i.exec(value)?.[1] : undefined;
  return band ? (band.toUpperCase() as NonNullable<ListingFacts["councilTaxBand"]>) : null;
}

/** "C" → "C"; a page's EPC line such as "EPC Rating = C" or "EPC: B" → "B". */
export function epcRatingOf(value: unknown): ListingFacts["epcRating"] {
  if (typeof value !== "string") return null;
  const rating = /^\s*([A-G])\s*$/i.exec(value)?.[1]
    ?? /\bEPC\b(?:\s*(?:rating|grade|band))?\s*(?:[:=-]|is|of)?\s*([A-G])\b/i.exec(value)?.[1];
  return rating ? (rating.toUpperCase() as NonNullable<ListingFacts["epcRating"]>) : null;
}

/** £ a year: 3494 → 3494; "£405.48 per annum | review…" → 405; "£120 per month" → 1440; "Ask agent" → null. */
export function yearlyAmountOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const match = /£\s*([\d,]+(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  const rest = value.slice(match.index + match[0].length);
  const perYear = /^\s*(?:per month|pcm|a month|monthly|p\/m)/i.test(rest) ? 12
    : /^\s*(?:per quarter|quarterly)/i.test(rest) ? 4
    : /^\s*(?:per week|pw|a week|weekly)/i.test(rest) ? 52 : 1;
  return Math.round(amount * perYear);
}

/** 109 → 109; "Leasehold | 112 yrs left" or "Leasehold (238 years)" → years; 0 or no figure → null. */
export function leaseYearsOf(value: unknown): number | null {
  const n = typeof value === "string" ? numberOrNull(/(\d{1,4})\s*(?:yrs|years)\b/i.exec(value)?.[1]) : numberOrNull(value);
  return n !== null && Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
}

/** "2026-07-14T11:38:42" or "13/10/2026" → "YYYY-MM-DD"; "today" / "yesterday" against `today`. */
export function isoDateOf(value: unknown, today: Date = new Date()): string | null {
  if (typeof value !== "string") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (iso) return validDate(+iso[1], +iso[2], +iso[3]);
  const uk = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(value);
  if (uk) return validDate(+uk[3], +uk[2], +uk[1]);
  const back = /\btoday\b/i.test(value) ? 0 : /\byesterday\b/i.test(value) ? 1 : null;
  if (back === null) return null;
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
  return validDate(day.getFullYear(), day.getMonth() + 1, day.getDate());
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Only the facts the page stated: null, undefined and empty lists are left out of the request. */
export function stated<T extends object>(facts: T): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(facts).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)),
  ) as { [K in keyof T]?: NonNullable<T[K]> };
}
