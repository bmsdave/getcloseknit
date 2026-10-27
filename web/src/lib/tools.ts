// Shared bits of the /tools pages: the always-visible advice notice, the
// list of tools and the link a property or area uses to prefill a price.
import type { AddressHistory, GeographyId, PreferenceProfile, PropertySummary, SaleRecord } from "./contracts";
import { isUnsetProfile } from "./profile-state";
import type { UserCandidate } from "./user-candidates";
import type { Sourced } from "./sourced";

export const NOT_ADVICE =
  "Not financial advice. These are rough sums with your own numbers; check them with a "
  + "solicitor, mortgage broker or tax adviser before you rely on them.";

/** The mortgage rates tracker's own notice: it shows averages, not anyone's numbers. */
export const RATES_NOT_OFFERS =
  "Averages, not offers. These are what lenders charged on average for new loans; your rate depends on your "
  + "deposit, income, credit record and fees. Not financial advice: ask a mortgage broker.";

/** The example price the calculators open with, so a result shows before anyone types. */
export const EXAMPLE_PRICE_SOURCED: Sourced<number> = { value: 500_000, kind: "assumption", source: "Close Knit", asOf: "2026-10" };
export const EXAMPLE_PRICE = EXAMPLE_PRICE_SOURCED.value;

export type ToolSlug = "stamp-duty" | "mortgage-rates" | "investor" | "check-a-home";

/** Each tool: its page title, and the short name on the tool tabs (no "Calculator" words). */
export const TOOLS: { slug: ToolSlug; title: string; label: string }[] = [
  { slug: "stamp-duty", title: "Stamp duty calculator", label: "Stamp duty" },
  { slug: "mortgage-rates", title: "Mortgage rates tracker", label: "Mortgage rates" },
  { slug: "investor", title: "Buy-to-let calculator", label: "Buy-to-let" },
  { slug: "check-a-home", title: "Check a home", label: "Check a home" },
];

export interface ToolPrefill {
  price: number | null;
  /** Where the price came from, e.g. an address or area name. */
  from: string | null;
  /** The month of the sale the price is ("2022-11"), said beside it; absent for other prices. */
  sold?: string | null;
}

const SOLD_PATTERN = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2022-11-15" or "2022-11" → "2022-11"; null for anything that is not a sale month. */
export function saleMonth(date: string | null | undefined): string | null {
  const month = date?.slice(0, 7) ?? "";
  return SOLD_PATTERN.test(month) ? month : null;
}

/** "Nov 2022" for a sale month. */
export function soldWords(sold: string): string {
  const [year, month] = sold.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/**
 * A home's tools start from its last sale only when that sale is dated, and carry the date
 * so the tool says how old the price is. No date: no price (the tools open on their example).
 */
export function datedSalePrefill(sale: { price: number; date: string | null } | null, from: string): Partial<ToolPrefill> {
  const sold = saleMonth(sale?.date);
  return sale && sold ? { price: sale.price, from, sold } : {};
}

const MAX_PRICE = 100_000_000;
const MAX_LABEL = 80;

/** Link to a tool with the price (and its source) filled in. */
export function toolHref(slug: ToolSlug, prefill: Partial<ToolPrefill> = {}): string {
  return withQuery(`/tools/${slug}`, prefillParams(prefill));
}

function prefillParams(prefill: Partial<ToolPrefill>): URLSearchParams {
  const params = new URLSearchParams();
  const price = cleanPrice(prefill.price);
  if (price !== null) params.set("price", String(price));
  const from = cleanLabel(prefill.from);
  if (price !== null && from !== null) params.set("from", from);
  const sold = saleMonth(prefill.sold);
  if (price !== null && sold !== null) params.set("sold", sold);
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

/**
 * The money tools for a chosen home start from its own last sale: its record
 * first, then its recorded last standard sale, then its building's address
 * history. Never the area's typical price: that stays with the cost worksheet.
 */
export function toolPrefill(
  record: SaleRecord | null, stock: PropertySummary | null, address: AddressHistory | null,
): Partial<ToolPrefill> {
  // Only a dated sale, and its month goes with it.
  const recorded = record?.transactions.at(-1);
  if (record && recorded) return datedSalePrefill({ price: recorded.nominalPrice, date: recorded.date }, record.address);
  const stockSale = stock?.lastSale;
  if (stock && stockSale) return datedSalePrefill({ price: stockSale.nominalPrice, date: stockSale.date }, stock.displayAddress);
  const building = address?.transactions.at(-1);
  return address && building ? datedSalePrefill({ price: building.nominalPrice, date: building.date }, address.displayAddress) : {};
}

/**
 * Keeps `?price=` in the address as the price is typed (replaceState: no navigation, no
 * history entry), so the tool tabs, a reload and a copied link all carry the same price. A typed price
 * drops the old `from`; no valid price drops both.
 */
export function carryPrice(price: number | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const clean = cleanPrice(price);
  const before = url.searchParams.get("price");
  if (clean === null) {
    if (before === null) return;
    url.searchParams.delete("price");
    url.searchParams.delete("from");
    url.searchParams.delete("sold");
  } else {
    if (before === String(clean)) return;
    url.searchParams.set("price", String(clean));
    // A typed price is nobody's sale: its source and sale month go.
    if (before !== null) {
      url.searchParams.delete("from");
      url.searchParams.delete("sold");
    }
  }
  // null state: Next syncs useSearchParams (the tabs) with it; its own entries carry __NA and are skipped.
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Read `?price=…&from=…` from a page's search params; bad values are ignored. */
export function readPrefill(params: Record<string, string | string[] | undefined>): ToolPrefill {
  const price = cleanPrice(Number(first(params.price)));
  return {
    price,
    from: price === null ? null : cleanLabel(first(params.from)),
    sold: price === null ? null : saleMonth(first(params.sold)),
  };
}

/** What "Check a home" starts from: an area, a home in it and a price; each may be missing. */
export interface CheckHomeContext extends ToolPrefill {
  /** A neighbourhood (LSOA) id, or null. */
  area: GeographyId | null;
  /** The chosen home's UPRN, or null. */
  uprn: string | null;
}

const AREA_PATTERN = /^uk:lsoa:[EW]\d{8}$/;
const UPRN_PATTERN = /^\d{1,12}$/;

/** Link to "Check a home" for an area (and a home in it), with the price the sums start from. */
export function checkHomeHref(context: Partial<CheckHomeContext> = {}): string {
  const { area, uprn } = readCheckHome({ area: context.area ?? undefined, uprn: context.uprn ?? undefined });
  const params = new URLSearchParams();
  if (area !== null) params.set("area", area);
  if (uprn !== null) params.set("uprn", uprn);
  for (const [key, value] of prefillParams(context)) params.set(key, value);
  return withQuery("/tools/check-a-home", params);
}

/** A saved listing's asking price (to buy) as the price "Check a home" starts from. */
export function askingPrefill(candidate: Pick<UserCandidate, "asking" | "address"> | null | undefined): ToolPrefill | null {
  const asking = candidate?.asking?.value;
  if (!asking || asking.kind !== "sale") return null;
  const price = cleanPrice(asking.amount);
  return price === null ? null : { price, from: cleanLabel(candidate!.address.value) };
}

/**
 * The price a search carries into "Check a home": the My match budget to buy, when the
 * household set one (an unset search, or one to rent, carries none).
 */
export function searchBudgetPrefill(profile: PreferenceProfile | null): ToolPrefill | null {
  if (!profile || isUnsetProfile(profile) || profile.market !== "buy") return null;
  const price = cleanPrice(profile.maximumBudget);
  return price === null ? null : { price, from: "your budget" };
}

/** Read `?area=…&uprn=…&price=…&from=…`; bad values are dropped and the page works without them. */
export function readCheckHome(params: Record<string, string | string[] | undefined>): CheckHomeContext {
  const area = first(params.area);
  const uprn = first(params.uprn);
  return {
    ...readPrefill(params),
    area: area && AREA_PATTERN.test(area) ? area as GeographyId : null,
    uprn: uprn && UPRN_PATTERN.test(uprn) ? uprn : null,
  };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function cleanPrice(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_PRICE) return null;
  return Math.round(value);
}

function cleanLabel(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_LABEL) : null;
}
