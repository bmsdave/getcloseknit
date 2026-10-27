import type { ListingFacts, PageSnapshot } from "../types";
import {
  bedroomsOrNull, councilTaxBandOf, epcRatingOf, get, isoDateOf, leaseYearsOf, numberOrNull, objectAfter, parseArea,
  parsePrice, postcodeOrNull, propertyTypeOf, stated, tenureOf, yearlyAmountOf,
} from "./parse";

const LISTING = /^https:\/\/www\.rightmove\.co\.uk\/properties\/(\d+)/;
const MARKER = "window.__PAGE_MODEL";

/** Rightmove keeps the listing in `window.__PAGE_MODEL`, either plain or flattened into `data`. */
export function rightmove(page: PageSnapshot): ListingFacts | null {
  const id = LISTING.exec(page.url)?.[1];
  if (!id) return null;
  const script = page.scripts.find((text) => text.includes(MARKER));
  if (!script) return null;
  const model = objectAfter(script, MARKER);
  const data = get(model, "data");
  const root = typeof data === "string" ? unflatten(data) : model;
  const property = get(root, "propertyData");
  // A stale model (the page changed without reloading) is never shown against the wrong home.
  if (!property || String(get(property, "id")) !== id) return null;
  const market = get(property, "transactionType") === "RENT" ? "rent" : "buy";
  const outcode = get(property, "address", "outcode");
  const incode = get(property, "address", "incode");
  const sizing = (get(property, "sizings") as unknown[] | undefined)?.find((s) => get(s, "unit") === "sqm");
  const askingPrice = parsePrice(get(property, "prices", "primaryPrice"), market);
  // "Added on 12/10/2026" or "Reduced on 13/10/2026": a reduction's date is when today's price began.
  const update = String(get(property, "listingHistory", "listingUpdateReason") ?? "");
  const reducedOn = /^reduced\b/i.test(update) ? isoDateOf(update) : null;
  const features = get(property, "keyFeatures");
  return {
    portal: "rightmove",
    listingId: id,
    url: `https://www.rightmove.co.uk/properties/${id}`,
    address: (get(property, "address", "displayAddress") as string | undefined)?.trim() || null,
    lat: numberOrNull(get(property, "location", "latitude")),
    lng: numberOrNull(get(property, "location", "longitude")),
    postcode: typeof outcode === "string" && typeof incode === "string" ? postcodeOrNull(`${outcode} ${incode}`) : null,
    market,
    askingPrice,
    bedrooms: bedroomsOrNull(get(property, "bedrooms")),
    floorAreaSqm: sizing ? parseArea(`${get(sizing, "minimumSize")} sq m`) : null,
    tenure: tenureOf(get(property, "tenure", "tenureType")),
    ...stated({
      propertyType: propertyTypeOf(get(property, "propertySubType")) ?? propertyTypeOf(get(property, "soldPropertyType")),
      councilTaxBand: councilTaxBandOf(get(property, "livingCosts", "councilTaxBand")),
      serviceChargeYearly: yearlyAmountOf(get(property, "livingCosts", "annualServiceCharge")),
      groundRentYearly: yearlyAmountOf(get(property, "livingCosts", "annualGroundRent")),
      leaseYearsRemaining: leaseYearsOf(get(property, "tenure", "yearsRemainingOnLease")),
      // The page's EPC is a chart image; agents often state the rating in a key feature ("EPC Rating = C").
      epcRating: Array.isArray(features) ? features.map(epcFeature).find(Boolean) ?? null : null,
      listedOn: /^added\b/i.test(update) ? isoDateOf(update) : null,
      priceChanges: reducedOn && askingPrice !== null ? [{ date: reducedOn, price: askingPrice }] : [],
    }),
  };
}

function epcFeature(text: unknown): ListingFacts["epcRating"] {
  return typeof text === "string" && /\bEPC\b/i.test(text) ? epcRatingOf(text) : null;
}

/**
 * The flattened form: a JSON array whose first item is the root and whose objects and arrays hold
 * indexes into the same array (negative indexes stand for undefined and special numbers).
 */
export function unflatten(data: string): unknown {
  let values: unknown[];
  try {
    values = JSON.parse(data) as unknown[];
  } catch {
    return null;
  }
  if (!Array.isArray(values)) return null;
  const done = new Map<number, unknown>();
  const resolve = (index: unknown): unknown => {
    if (typeof index !== "number" || index < 0 || index >= values.length) return null;
    if (done.has(index)) return done.get(index);
    const value = values[index];
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      done.set(index, out);
      for (const item of value) out.push(resolve(item));
      return out;
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      done.set(index, out);
      for (const [key, item] of Object.entries(value)) out[key] = resolve(item);
      return out;
    }
    return value;
  };
  return resolve(0);
}
