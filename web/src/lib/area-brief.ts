import type { AreaLocationResponse } from "./area-location";
import type { Carrier, GeographyId, TypicalPrice } from "./contracts";
import { formatMoney } from "./money-format";
import type { CostAssumptions } from "./housing-cost";
import type { Sourced } from "./sourced";
import { sortByTopic } from "./topic-order";

/**
 * The area card's sections, in the owner's one fixed order (docs/area-card-2026-10/decisions.md):
 * the same on /area, in the map sheet at full height, in the sticky tab chips and for every
 * tile and tag. Each is one always-open section; unrelated topics are never merged.
 */
const CARD_LIST = [
  { id: "overview", title: "Overview", icon: "star" },
  { id: "price", title: "Price", icon: "trend" },
  { id: "getting-around", title: "Getting around", icon: "train" },
  { id: "safety", title: "Safety", icon: "crime" },
  { id: "schools", title: "Schools", icon: "school" },
  { id: "local-places", title: "Local places", icon: "place-coffee" },
  { id: "environment", title: "Green & quiet", icon: "tree" },
  { id: "health", title: "Health", icon: "heart" },
  { id: "homes", title: "Homes", icon: "home" },
  { id: "people", title: "People", icon: "people" },
  { id: "living-costs", title: "Living costs", icon: "income" },
] as const;

export type AreaCardId = (typeof CARD_LIST)[number]["id"];

/** Overview leads; every other section is its own topic (lib/topic-order.ts). */
export const AREA_CARDS = sortByTopic(CARD_LIST, (card) => (card.id === "overview" ? null : card.id));

const CARD_IDS: readonly string[] = AREA_CARDS.map((card) => card.id);

export function isAreaCardId(value: unknown): value is AreaCardId {
  return typeof value === "string" && CARD_IDS.includes(value);
}

/** Old #card links (before 2026-10) land on the section that now holds their topic. */
const LEGACY_CARD: Record<string, AreaCardId> = {
  sales: "price", living: "safety", around: "getting-around", council: "living-costs",
};

/** The section a #hash names (old card names included), else null. */
export function cardFromHash(hash: string): AreaCardId | null {
  const id = hash.replace(/^#/, "");
  return isAreaCardId(id) ? id : LEGACY_CARD[id] ?? null;
}

/** A home chosen on the map: its UPRN (when known) and its address id. */
export interface ChosenHome { uprn: string | null; addressId: string | null }

/** The map's data mode and release, carried so the full page reads the same evidence. */
export interface DataSource { mode: string; release: string }

/**
 * The full page for an area, carrying the chosen home (so its card and tools
 * come along), the map's data mode and an optional card to open.
 */
export function areaPageHref(
  geographyId: GeographyId, home: ChosenHome | null = null, card: AreaCardId | null = null, source: DataSource | null = null,
): string {
  const [, carrier, code] = geographyId.split(":");
  const query = new URLSearchParams();
  if (home?.uprn && /^[0-9]+$/.test(home.uprn)) query.set("uprn", home.uprn);
  if (home?.addressId) query.set("address", home.addressId);
  if (source) {
    query.set("mode", source.mode);
    query.set("release", source.release);
  }
  const search = query.toString();
  return `/area/${carrier}/${code}${search ? `?${search}` : ""}${card ? `#${card}` : ""}`;
}

/** A map view to come back to: where the map looked and what coloured it. */
export interface MapView { latitude: number; longitude: number; zoom: number; layer: string }

/** The map, opened on this area (the full page's way back), at the last map view when one is given. */
export function mapHref(geographyId: GeographyId, source: DataSource | null = null, view: MapView | null = null): string {
  const query = new URLSearchParams();
  if (view) {
    query.set("lat", String(view.latitude));
    query.set("lng", String(view.longitude));
    query.set("zoom", String(view.zoom));
    query.set("layer", view.layer);
  }
  query.set("selected", geographyId);
  if (source) {
    query.set("mode", source.mode);
    query.set("release", source.release);
  }
  return `/?${query.toString()}`;
}

/** Map-only parameters: an old /area/lsoa/… link carrying one of them opened the map, and still does. */
export const MAP_ONLY_PARAMETERS = ["layer", "period", "lat", "lng", "zoom", "pitch", "bearing", "palette", "scale", "window"] as const;

/** The map URL for an old area link with map parameters, else null (the full page answers). */
export function legacyMapRedirect(geographyId: GeographyId, search: URLSearchParams): string | null {
  if (!MAP_ONLY_PARAMETERS.some((key) => search.has(key))) return null;
  const query = new URLSearchParams(search);
  query.delete("uprn");
  query.delete("address");
  query.set("selected", geographyId);
  return `/?${query.toString()}`;
}

/** "Partly in a conservation area" — the land's rules as a short line (null when outside or unknown). */
function conservationLine(location: AreaLocationResponse | null): string | null {
  const presence = location?.available ? location.conservation?.presence : undefined;
  if (presence === "inside") return "In a conservation area";
  if (presence === "partly") return "Partly in a conservation area";
  return null;
}

/** Planning card header: the land's rules and activity, from the location payload. */
export function planningFigure(location: AreaLocationResponse | null | "unknown"): string {
  if (location === null) return "…";
  if (location === "unknown" || !location.available) return "No planning figures for this area";
  if (location.conservation === null && !location.planning) return "No planning figures for this area";
  const conservation = conservationLine(location);
  const applications = location.planning ? `${location.planning.applications} applications in 2 years` : null;
  return [conservation, applications].filter(Boolean).join(" · ") || "Not in a conservation area";
}

export interface CostPrefillInput {
  market: "buy" | "rent";
  /** Typical price for the chosen home size in the area (never a figure for one home). */
  price: number | null;
  /** Latest average 5-year fixed mortgage rate, % a year. */
  rate: number | null;
}

/** A 10% deposit and a 25-year term: stated assumptions the reader can change. */
export const COST_PREFILL_ASSUMPTION: Sourced<{ depositShare: number; termYears: number }> = {
  value: { depositShare: 0.1, termYears: 25 },
  kind: "assumption",
  source: "Close Knit",
  asOf: "2026-10",
};
export const ASSUMED_DEPOSIT_SHARE = COST_PREFILL_ASSUMPTION.value.depositShare;
export const ASSUMED_TERM_YEARS = COST_PREFILL_ASSUMPTION.value.termYears;

/**
 * Worksheet start values for a buyer: the area's typical price for the chosen
 * size, a stated 10% deposit and 25-year term, and the latest average fixed
 * rate. Renters and an unknown price start empty (nothing is guessed).
 */
export function costPrefill({ market, price, rate }: CostPrefillInput): Partial<CostAssumptions> {
  if (market !== "buy" || price === null || !(price > 0)) return {};
  return {
    price,
    deposit: Math.round((price * ASSUMED_DEPOSIT_SHARE) / 1000) * 1000,
    termYears: ASSUMED_TERM_YEARS,
    ...(rate !== null && rate > 0 ? { annualInterestRatePct: Math.round(rate * 100) / 100 } : {}),
  };
}

/** Leasehold due diligence applies unless the home is known to be freehold. */
export function mayBeLeasehold(tenure: string | null | undefined): boolean {
  return !/^freehold$/i.test(tenure ?? "");
}

const TYPICAL_PRICE_LABELS: Record<TypicalPrice["propertyType"], string> = {
  all: "All homes", flat: "Flats", terraced: "Terraced", semi: "Semi", detached: "Detached",
};

/**
 * The brief's typical home prices by type ("Flats £455k"), the map layer's labels.
 * `wider` marks a type taken from a wider area (too few sales here). About the
 * area's sales, never a figure for one home.
 */
export function typicalPriceItems(typical: readonly TypicalPrice[], carrier: Carrier): {
  key: TypicalPrice["propertyType"]; label: string; price: string; wider: boolean;
}[] {
  return typical.map((entry) => ({
    key: entry.propertyType,
    label: TYPICAL_PRICE_LABELS[entry.propertyType],
    price: formatMoney(entry.price),
    wider: entry.carrier !== carrier,
  }));
}
