import type { ListingFacts, PageSnapshot } from "../types";
import {
  bedroomsOrNull, blockAfter, councilTaxBandOf, epcRatingOf, get, isoDateOf, leaseYearsOf, parseArea, parseJson,
  parsePrice, propertyTypeOf, stated, tenureOf, yearlyAmountOf,
} from "./parse";

const LISTING = /^https:\/\/www\.zoopla\.co\.uk\/(for-sale|to-rent|new-homes)\/details\/(\d+)/;
// The listing's own point is its "location":{"coordinates":{…}}; the page also carries other points
// (EV chargers nearby, travel times). In streamed data the quotes may be escaped once.
const COORDINATES = /location\\?"\s*:\s*\{\s*\\?"coordinates\\?"\s*:\s*\{\s*\\?"latitude\\?"\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*\\?"longitude\\?"\s*:\s*(-?\d+(?:\.\d+)?)/g;
const PUSH = /^\s*self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?\s*$/;
const TAXONOMY = '"analyticsTaxonomy":';

/** Zoopla: price, bedrooms and floor size from the RealEstateListing JSON-LD; the point from the page data. */
export function zoopla(page: PageSnapshot): ListingFacts | null {
  const match = LISTING.exec(page.url);
  if (!match) return null;
  const [, section, id] = match;
  const listing = page.jsonLd.map(parseJson).find((item) => get(item, "@type") === "RealEstateListing");
  if (!listing || !String(get(listing, "mainEntityOfPage") ?? "").includes(`/details/${id}`)) return null;
  const market = section === "to-rent" ? "rent" : "buy";
  const props = (get(listing, "additionalProperty") as unknown[] | undefined) ?? [];
  const prop = (name: string) => get(props.find((p) => get(p, "name") === name), "value");
  const weekly = get(listing, "offers", "eligibleDuration", "unitCode") === "WEE";
  const price = parsePrice(get(listing, "offers", "price"), market);
  const askingPrice = price !== null && weekly ? Math.round((price * 52) / 12) : price;
  const point = lastPoint(page.scripts);
  const details = streamedDetails(streamText(page.scripts), id);
  const lastChange = details.changes.at(-1);
  return {
    portal: "zoopla",
    listingId: id,
    url: `https://www.zoopla.co.uk/${section}/details/${id}/`,
    address: addressFromName(get(listing, "name")),
    lat: point?.[0] ?? null,
    lng: point?.[1] ?? null,
    postcode: null,
    market,
    askingPrice,
    bedrooms: bedroomsOrNull(prop("Bedrooms")),
    floorAreaSqm: parseArea(prop("Floor size")),
    tenure: tenureOf(get(details.taxonomy, "tenure")),
    ...stated({
      propertyType: propertyTypeOf(get(details.taxonomy, "propertyType")),
      councilTaxBand: councilTaxBandOf(details.nts.council_tax_band),
      serviceChargeYearly: yearlyAmountOf(details.nts.service_charge),
      groundRentYearly: yearlyAmountOf(details.nts.ground_rent),
      // "Leasehold (111 years)": the years left on the lease, as the material information gives them.
      leaseYearsRemaining: leaseYearsOf(details.nts.tenure),
      epcRating: epcRatingOf(get(details.taxonomy, "epcRating")),
      listedOn: isoDateOf(get(listing, "datePosted")),
      // Zoopla gives the dates of its price changes, not the prices: the latest one began today's price.
      priceChanges: lastChange && askingPrice !== null ? [{ date: lastChange, price: askingPrice }] : [],
    }),
  };
}

/** Next.js streams the page's data as `self.__next_f.push([1, "<text>"])` scripts; this is their text joined. */
function streamText(scripts: string[]): string {
  const parts: string[] = [];
  for (const text of scripts) {
    const push = PUSH.exec(text);
    if (!push) continue;
    try {
      const item = JSON.parse(push[1]) as unknown[];
      if (typeof item[1] === "string") parts.push(item[1]);
    } catch {
      // Not a data chunk.
    }
  }
  return parts.join("");
}

interface Details {
  taxonomy: unknown;
  /** Material information by key: tenure, council_tax_band, service_charge, ground_rent. */
  nts: Record<string, string>;
  /** Price change dates, oldest first. */
  changes: string[];
}

/**
 * The listing's analytics summary (type, tenure, EPC) and its material information follow each other in the
 * stream; only the summary for this listing is trusted. Data streamed later (client-side navigation) wins.
 */
function streamedDetails(text: string, id: string): Details {
  const details: Details = { taxonomy: null, nts: {}, changes: [] };
  for (let at = text.indexOf(TAXONOMY); at >= 0; at = text.indexOf(TAXONOMY, at + 1)) {
    const rest = text.slice(at);
    const block = blockAfter(rest, TAXONOMY);
    const taxonomy = parseJson(block);
    if (!block || String(get(taxonomy, "listingId")) !== id) continue;
    details.taxonomy = taxonomy;
    const after = rest.slice(rest.indexOf(block) + block.length);
    const nts = /^\s*,\s*"ntsInfo"\s*:/.test(after) ? parseJson(blockAfter(after, '"ntsInfo":', "[")) : null;
    details.nts = {};
    for (const item of Array.isArray(nts) ? nts : []) {
      const key = get(item, "key");
      const value = get(item, "value");
      if (typeof key === "string" && typeof value === "string") details.nts[key] = value;
    }
  }
  const marker = '"priceHistory":{';
  const at = text.lastIndexOf(marker);
  if (details.taxonomy && at >= 0) {
    const changes = get(parseJson(blockAfter(text.slice(at), '"priceHistory":')), "priceChanges");
    details.changes = (Array.isArray(changes) ? changes : [])
      .map((change) => isoDateOf(get(change, "priceChangeDate")))
      .filter((date): date is string => date !== null)
      .sort();
  }
  return details;
}

/** The listing's point: streamed data is appended, so after client-side navigation the latest is this page's. */
function lastPoint(scripts: string[]): [number, number] | null {
  let found: [number, number] | null = null;
  for (const text of scripts) {
    for (const m of text.matchAll(COORDINATES)) found = [Number(m[1]), Number(m[2])];
  }
  return found;
}

/** "2 bed flat for sale Brett Road, London E8" → "Brett Road, London E8". */
function addressFromName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const address = name.split(/ (?:for sale|to rent) /)[1]?.trim();
  return address || null;
}
