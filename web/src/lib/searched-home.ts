/**
 * The plain address an old postcode link carries as `?address=` (parseSearchedHome); the postcode
 * page redirects a numbered one to the street-level home (street-home.ts). Also the area price
 * ranges by type (areaPriceRanges): the middle half of the area's recorded sales of each type,
 * only from at least AREA_RANGE_MIN_SALES of them. They describe the area, never one home.
 */
import { PROPERTY_TYPE_LABELS, type AreaMarketResponse } from "./market";

export interface SearchedHome {
  address: string;
}

export interface AreaPriceRange {
  label: string;
  sales: number;
  low: number;
  high: number;
}

const ADDRESS = /^[A-Za-z0-9 ,.'/-]{3,80}$/;
export const AREA_RANGE_MIN_SALES = 5;

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** The searched home from the page's query; null when absent or not a plain address. */
export function parseSearchedHome(query: Record<string, string | string[] | undefined>): SearchedHome | null {
  const address = first(query.address)?.replace(/\s+/g, " ").trim() ?? "";
  if (!ADDRESS.test(address) || !/[A-Za-z]/.test(address)) return null;
  return { address };
}

/** The middle half of the area's recorded sales by type, only for types with enough sales. */
export function areaPriceRanges(market: AreaMarketResponse | null): AreaPriceRange[] {
  if (!market?.available) return [];
  return market.byType
    .filter((stats) => stats.propertyType !== "all" && stats.sales >= AREA_RANGE_MIN_SALES
      && stats.p25 !== null && stats.p75 !== null)
    .map((stats) => ({ label: PROPERTY_TYPE_LABELS[stats.propertyType], sales: stats.sales, low: stats.p25!, high: stats.p75! }));
}
