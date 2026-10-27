/**
 * Search brief: what an agent agreed with a household (areas, budget, criteria) carried in a
 * `#brief=v1.` fragment, and the view model the /brief page draws from area-brief.v1.
 * Pure — no React, no map — so every rule here is tested under plain node.
 *
 * The fragment never reaches the server (it is a URL fragment); only the area ids and the
 * budget go to /api/v1/brief, which marks its answer no-store.
 */
import type { MultiPolygon, Polygon } from "geojson";

export const BRIEF_PREFIX = "#brief=v1.";
export const MAX_BRIEF_AREAS = 12;
const LSOA_ID_RE = /^uk:lsoa:E\d{8}$/;

export type BriefCriterion = "price" | "schools" | "commute" | "safety" | "station";
export const BRIEF_CRITERIA: readonly BriefCriterion[] = ["price", "schools", "commute", "safety", "station"];

export interface BriefDestination {
  label: string;
  latitude: number;
  longitude: number;
}

export interface BriefRequest {
  areas: string[];
  budget: [number | null, number | null];
  market: "buy" | "rent";
  bedrooms: number;
  propertyType: "house" | "flat" | "any";
  criteria: BriefCriterion[];
  destinations: BriefDestination[];
}

// Short keys keep shared links short; the order is fixed so Python and TypeScript encode
// the same bytes (contracts/fixtures/agent-share-links.json pins both).
interface PackedBrief {
  a: string[];
  b: [number | null, number | null];
  m: "buy" | "rent";
  r: number;
  t: "house" | "flat" | "any";
  c: BriefCriterion[];
  d: [string, number, number][];
}

export function encodeBrief(brief: BriefRequest): string {
  const valid = assertBrief(brief);
  const packed: PackedBrief = {
    a: valid.areas, b: valid.budget, m: valid.market, r: valid.bedrooms, t: valid.propertyType,
    c: valid.criteria, d: valid.destinations.map((d) => [d.label, d.latitude, d.longitude]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(packed));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return BRIEF_PREFIX + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeBrief(fragment: string): BriefRequest | null {
  if (!fragment.startsWith(BRIEF_PREFIX)) return null;
  try {
    const body = fragment.slice(BRIEF_PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
    const packed = JSON.parse(new TextDecoder().decode(bytes)) as PackedBrief;
    return assertBrief({
      areas: packed.a, budget: packed.b, market: packed.m, bedrooms: packed.r, propertyType: packed.t,
      criteria: packed.c ?? [], destinations: (packed.d ?? []).map(([label, latitude, longitude]) => ({ label, latitude, longitude })),
    });
  } catch {
    return null;
  }
}

export function assertBrief(brief: BriefRequest): BriefRequest {
  const areas = brief.areas;
  if (!Array.isArray(areas) || areas.length < 1 || areas.length > MAX_BRIEF_AREAS) throw new Error("brief needs 1-12 areas");
  if (new Set(areas).size !== areas.length || !areas.every((id) => LSOA_ID_RE.test(id))) throw new Error("brief areas must be distinct LSOA ids");
  const [low, high] = brief.budget ?? [null, null];
  for (const value of [low, high]) {
    if (value !== null && (!Number.isFinite(value) || value <= 0)) throw new Error("invalid budget");
  }
  if (low !== null && high !== null && low > high) throw new Error("budget minimum above maximum");
  if (brief.market !== "buy" && brief.market !== "rent") throw new Error("invalid market");
  if (!Number.isInteger(brief.bedrooms) || brief.bedrooms < 0 || brief.bedrooms > 8) throw new Error("invalid bedrooms");
  if (!["house", "flat", "any"].includes(brief.propertyType)) throw new Error("invalid property type");
  if (!brief.criteria.every((criterion) => BRIEF_CRITERIA.includes(criterion))) throw new Error("unknown criterion");
  for (const destination of brief.destinations) {
    if (typeof destination.label !== "string" || destination.label.length > 80
      || Math.abs(destination.latitude) > 90 || Math.abs(destination.longitude) > 180) throw new Error("invalid destination");
  }
  return { ...brief, budget: [low, high] };
}

export function briefApiPath(brief: BriefRequest): string {
  const query = new URLSearchParams({
    areas: brief.areas.join(","), bedrooms: String(brief.bedrooms), market: brief.market, propertyType: brief.propertyType,
  });
  if (brief.budget[0] !== null) query.set("budgetMin", String(brief.budget[0]));
  if (brief.budget[1] !== null) query.set("budgetMax", String(brief.budget[1]));
  return `/api/v1/brief?${query.toString()}`;
}

// ---- area-brief.v1 (api/area_api/brief.py) ----------------------------------------------

export type BudgetFit = "within" | "stretch" | "over" | "unknown";
export type SchoolTier = "outstanding" | "good" | "requires-improvement" | "inadequate" | "unknown";

export interface PriceBin { from: number; to: number; count: number }

export type PriceContext =
  | { available: true; sales: number; windowMonths: number; minimumSample: number; matched: "size-and-type" | "size" | "type" | "all";
      floorBand: [number, number]; above: number; median: number; p25: number; p75: number; bins: PriceBin[];
      budgetMinPercentile: number | null; budgetMaxPercentile: number | null }
  | { available: false; sales?: number; minimumSample?: number; windowMonths?: number; floorBand?: [number, number]; reason?: string };

export interface BriefPlace {
  geographyId: string;
  /** Outline for the brief map (GeoJSON Polygon or MultiPolygon); null when unknown. */
  geometry: Polygon | MultiPolygon | null;
  name: string;
  /** The name to show: the friendly title, else the official name; absent from older APIs. */
  displayName?: string | null;
  borough: string | null;
  parentId: string | null;
  center: [number, number] | null;
  outcodes: string[];
  pricePerSquareMetre: number | null;
  estimatedPrice: number | null;
  assumedFloorArea?: number;
  /** Rent searches: the borough's average monthly rent behind estimatedPrice (ONS PIPR). */
  estimatedRent?: { monthly: number; basis: "borough-average"; bedrooms: string; boroughId: string; period: string; sourceVersion: string };
  budgetFit: BudgetFit;
}

export interface BriefArea extends BriefPlace {
  rank: number;
  ring: string[];
  station: { stationId: string; name: string; modes: string[]; walkMinutes: number; center: [number, number]; zone?: string } | null;
  priceContext: PriceContext;
  /** Conservation area, ULEZ / Congestion Charge and planning activity lines (real mode only). */
  locationNotes?: string[];
}

export interface BriefRingArea extends BriefPlace { ringOf: string[] }

export interface BriefSchool {
  urn: string;
  name: string;
  phase: string;
  latitude: number;
  longitude: number;
  distanceMetres: number | null;
  grade: { tier: SchoolTier; label: string; year: string | null };
  attainment8: number | null;
  /** Latest published Progress 8 (secondaries; 0 = national average); absent in older briefs. */
  progress8?: { value: number; year: string | null } | null;
  selectivity: string | null;
  nearAreas: string[];
}

export interface AreaBrief {
  schemaVersion: "area-brief.v1";
  productReleaseId: string;
  request: { budget: [number | null, number | null]; bedrooms: number; market: "buy" | "rent"; propertyType: string };
  areas: BriefArea[];
  ring: BriefRingArea[];
  schools: BriefSchool[];
  sources: { id?: string; release?: string; licence?: string; attribution?: string }[];
  caveats: string[];
}

export const SCHOOL_TIER_LABEL: Record<SchoolTier, string> = {
  outstanding: "Outstanding", good: "Good", "requires-improvement": "Requires improvement",
  inadequate: "Inadequate", unknown: "Not inspected",
};

const gbp = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;

/** The home a ballpark is for: "studio", "2-bed", "5+ bed"; null without a bedroom count. */
export function homeSize(bedrooms: number | null | undefined): string | null {
  if (bedrooms === null || bedrooms === undefined || !Number.isInteger(bedrooms) || bedrooms < 0) return null;
  return bedrooms === 0 ? "studio" : bedrooms >= 5 ? "5+ bed" : `${bedrooms}-bed`;
}

/**
 * A ballpark says what it is: "typical 2-bed ~£497k" (to buy: the area's £/m² × a typical
 * size) or "2-bed rent ~£2,100/mo" (the borough's average); "short" drops "typical" for a map chip.
 */
export function ballparkLabel(price: number, { bedrooms, monthly = false, short = false }: {
  bedrooms: number | null | undefined; monthly?: boolean; short?: boolean;
}): string {
  const size = homeSize(bedrooms);
  const value = `~${formatPrice(price)}${monthly ? "/mo" : ""}`;
  if (!size) return value;
  if (short) return `${size} ${value}`;
  return monthly ? `${size} rent ${value}` : `typical ${size} ${value}`;
}

export function formatPrice(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 2).replace(/0$/, "")}m`;
  if (value >= 10_000) return `£${Math.round(value / 1000)}k`;
  return gbp(value);
}

export function budgetLabel(budget: [number | null, number | null], market: "buy" | "rent"): string {
  const suffix = market === "rent" ? " a month" : "";
  const [low, high] = budget;
  if (low !== null && high !== null) return `${formatPrice(low)}–${formatPrice(high)}${suffix}`;
  if (high !== null) return `up to ${formatPrice(high)}${suffix}`;
  if (low !== null) return `from ${formatPrice(low)}${suffix}`;
  return "no budget given";
}

/** One sentence that places the budget among recent sales of the homes actually compared. */
export function budgetSentence(context: PriceContext, homeLabel: string): string {
  if (!context.available) {
    return context.reason === "no rental evidence"
      ? "Rents are published per borough, not per street, so there is no local spread to place your budget in: compare listings against each other."
      : `Too few comparable sales here (${context.sales ?? 0} of the ${context.minimumSample ?? 10} needed) to place your budget.`;
  }
  const compared = comparedLabel(context, homeLabel);
  const high = context.budgetMaxPercentile;
  const low = context.budgetMinPercentile;
  if (high === null) return `Typical ${compared}: ${formatPrice(context.median)} (middle half ${formatPrice(context.p25)}–${formatPrice(context.p75)}).`;
  const span = low !== null && low !== high ? `${low}–${high}%` : `${high}%`;
  // A budget range is judged by both ends: one that straddles the median is "around the middle".
  const bottom = low ?? high;
  const verdict = bottom >= 75 ? "comfortably above most" : bottom >= 50 ? "above the middle of"
    : high >= 50 ? "around the middle of" : high >= 25 ? "below the middle of" : "below most";
  return `Your budget is ${verdict} recent sales of ${compared} here: it reaches ${span} of them (median ${formatPrice(context.median)}).`;
}

/** What the numbers describe once scarce sales forced a wider comparison. */
export function comparedLabel(context: Extract<PriceContext, { available: true }>, homeLabel: string): string {
  const [low, high] = context.floorBand;
  if (context.matched === "size-and-type") return `${homeLabel}s`;
  if (context.matched === "size") return `homes of ${low}–${high} m² (any type)`;
  if (context.matched === "type") return `${homeLabel.replace(/^\S+ /, "")}s of any size`;
  return "homes of any size and type";
}

export function homeLabel(bedrooms: number, propertyType: string): string {
  const rooms = bedrooms === 0 ? "studio" : `${bedrooms}-bed`;
  const kind = propertyType === "house" ? "house" : propertyType === "flat" ? "flat" : "home";
  return bedrooms === 0 ? rooms : `${rooms} ${kind}`;
}

export function matchedNote(context: PriceContext): string | null {
  if (!context.available) return null;
  const [low, high] = context.floorBand;
  if (context.matched === "size-and-type") return `Homes of ${low}–${high} m², the size that usually means this many bedrooms.`;
  if (context.matched === "size") return `Too few sales of this type, so every home of ${low}–${high} m² (the usual size for this many bedrooms) is shown.`;
  if (context.matched === "type") return "Too few sales of this size, so this property type of any size is shown.";
  return "Too few sales of this size or type, so all standard sales are shown.";
}

/** Which bins the budget band overlaps, for highlighting. */
export function binsInBudget(bins: PriceBin[], budget: [number | null, number | null]): boolean[] {
  const [low, high] = budget;
  if (low === null && high === null) return bins.map(() => false);
  const from = low ?? high!;
  const to = high ?? low!;
  // A range lights the bins it overlaps (a bin starting at the ceiling is not reached); a single
  // budget lights the one bin it falls in.
  return bins.map((bin) => (from === to ? bin.from <= from && from < bin.to : bin.to > from && bin.from < to));
}

export interface SchoolFilter { phase: "all" | "primary" | "secondary"; topOnly: boolean }

export function filterSchools(schools: BriefSchool[], filter: SchoolFilter, areaId?: string): BriefSchool[] {
  return schools.filter((school) =>
    (filter.phase === "all" || school.phase.toLowerCase().includes(filter.phase))
    && (!filter.topOnly || school.grade.tier === "outstanding")
    && (!areaId || school.nearAreas.includes(areaId)));
}

export function ringFor(brief: AreaBrief, areaId: string): BriefRingArea[] {
  return brief.ring.filter((entry) => entry.ringOf.includes(areaId));
}

// ---- map layers ----------------------------------------------------------------------------

export type BriefLayer = "prices" | "ring" | "schools" | "travel";
export const BRIEF_LAYERS: readonly BriefLayer[] = ["prices", "ring", "schools", "travel"];
export const BRIEF_LAYER_LABEL: Record<BriefLayer, string> = {
  prices: "Prices vs budget", ring: "Neighbouring areas", schools: "Schools", travel: "Getting around",
};

export function distanceKm(from: [number, number], to: BriefDestination): number {
  const rad = Math.PI / 180;
  const dLat = (to.latitude - from[1]) * rad;
  const dLng = (to.longitude - from[0]) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from[1] * rad) * Math.cos(to.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
