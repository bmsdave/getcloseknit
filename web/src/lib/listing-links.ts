/**
 * Links out from one home to the portals and HM Land Registry. A port of
 * `home_listing_links` in api/area_api/home_search.py (Claude's tools), pinned
 * on both sides by contracts/fixtures/home-listing-links.json. Links only:
 * Close Knit never fetches, copies or hosts listings or their photos.
 */
import type { AddressHistory, PropertySummary } from "./contracts";
import { normalisePostcode } from "./postcode-page";

export type Portal = "rightmove" | "zoopla" | "onthemarket";

export const LISTING_LINKS_NOTE = "Links to the portals; Close Knit doesn't host listings.";

const PORTAL_LABELS: Record<Portal, string> = { rightmove: "Rightmove", zoopla: "Zoopla", onthemarket: "OnTheMarket" };

/** Rightmove's sold-prices page (past listings with their photos), then homes for sale there. */
export function homeListingLinks(postcode: string): Record<Portal, string> | null {
  const code = normalisePostcode(postcode);
  if (!code) return null;
  const slug = code.toLowerCase().replace(" ", "-");
  const outcode = code.split(" ")[0].toLowerCase();
  return {
    rightmove: `https://www.rightmove.co.uk/house-prices/${slug}.html`,
    zoopla: `https://www.zoopla.co.uk/for-sale/property/${outcode}/?q=${encodeURIComponent(code)}`,
    onthemarket: `https://www.onthemarket.com/for-sale/property/${slug}/`,
  };
}

/** HM Land Registry's own Price Paid search for the postcode: the public record of every sale. */
export function pricePaidSearchUrl(postcode: string): string {
  return `https://landregistry.data.gov.uk/app/ppd/search?postcode=${encodeURIComponent(postcode).replace(/%20/g, "+")}`;
}

export interface HomeCardLinks {
  postcode: string;
  priceRecord: string;
  portals: { portal: Portal; label: string; href: string }[];
}

/**
 * The map card's links for a home. A hidden home (privacy objection) is not
 * found by the API, so with neither record there is nothing to link.
 */
export function homeCardLinks(property: PropertySummary | null, address: AddressHistory | null): HomeCardLinks | null {
  const tail = (property?.displayAddress ?? address?.displayAddress ?? "").split(",").at(-1) ?? "";
  return listingLinks(normalisePostcode(address?.postcode ?? "") ?? normalisePostcode(tail));
}

/** A home's links from its postcode (the property page's); none without a valid one. */
export function listingLinks(rawPostcode: string | null): HomeCardLinks | null {
  const postcode = normalisePostcode(rawPostcode ?? "");
  const links = postcode ? homeListingLinks(postcode) : null;
  if (!postcode || !links) return null;
  return {
    postcode,
    priceRecord: pricePaidSearchUrl(postcode),
    portals: (Object.keys(PORTAL_LABELS) as Portal[]).map((portal) => ({ portal, label: PORTAL_LABELS[portal], href: links[portal] })),
  };
}

export type AreaPortal = Portal | "openrent";
const AREA_PORTAL_LABELS: Record<AreaPortal, string> = { ...PORTAL_LABELS, openrent: "OpenRent" };
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/;

/** What an area's listing links are filtered by: the search's market, and its ceiling and bedrooms if it has them. */
export interface AreaListingFilter {
  market: "buy" | "rent";
  maxPrice: number | null;
  minBedrooms: number | null;
}

/**
 * The portals' own searches for a postcode district: homes for sale (or to rent, OpenRent too) within the
 * filter. A port of `portal_links` in api/area_api/home_search.py (Claude's get_listing_search_links),
 * pinned on both sides by contracts/fixtures/area-listing-links.json; without a price or bedrooms the
 * search is left open.
 */
export function areaListingLinks(rawOutcode: string, filter: AreaListingFilter): { portal: AreaPortal; label: string; href: string }[] {
  const code = rawOutcode.trim().toUpperCase();
  if (!OUTCODE.test(code)) return [];
  const lower = code.toLowerCase();
  const query = (pairs: [string, number | string | null][]) => {
    const kept = pairs.filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`);
    return kept.length ? `?${kept.join("&")}` : "";
  };
  const price = filter.maxPrice;
  const beds = filter.minBedrooms === null ? null : Math.max(0, filter.minBedrooms);
  const links: Partial<Record<AreaPortal, string>> = filter.market === "buy" ? {
    rightmove: `https://www.rightmove.co.uk/property-for-sale/${code}.html${query([["maxPrice", price], ["minBedrooms", beds]])}`,
    zoopla: `https://www.zoopla.co.uk/for-sale/property/${lower}/${query([["price_max", price], ["beds_min", beds], ["q", code]])}`,
    onthemarket: `https://www.onthemarket.com/for-sale/property/${lower}/${query([["max-price", price], ["min-bedrooms", beds]])}`,
  } : {
    rightmove: `https://www.rightmove.co.uk/property-to-rent/${code}.html${query([["maxPrice", price], ["minBedrooms", beds]])}`,
    zoopla: `https://www.zoopla.co.uk/to-rent/property/${lower}/${query([["price_frequency", "per_month"], ["price_max", price], ["beds_min", beds], ["q", code]])}`,
    onthemarket: `https://www.onthemarket.com/to-rent/property/${lower}/${query([["max-price", price], ["min-bedrooms", beds]])}`,
    openrent: `https://www.openrent.co.uk/properties-to-rent/${lower}${query([["prices_max", price], ["bedrooms_min", beds]])}`,
  };
  return (Object.keys(links) as AreaPortal[]).map((portal) => ({ portal, label: AREA_PORTAL_LABELS[portal], href: links[portal]! }));
}

/** Rightmove's sold prices for a whole postcode district (past listings with their photos). */
export function districtSoldPricesUrl(rawOutcode: string): string | null {
  const code = rawOutcode.trim().toUpperCase();
  return OUTCODE.test(code) ? `https://www.rightmove.co.uk/house-prices/${code.toLowerCase()}.html` : null;
}
