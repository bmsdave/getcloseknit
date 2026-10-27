import type { ListingFacts, PageSnapshot } from "../types";
import {
  bedroomsOrNull, councilTaxBandOf, epcRatingOf, get, leaseYearsOf, numberOrNull, parseJson, parsePrice, postcodeOrNull,
  propertyTypeOf, stated, tenureOf, yearlyAmountOf,
} from "./parse";

const LISTING = /^https:\/\/www\.onthemarket\.com\/details\/(\d+)/;

/** OnTheMarket: the listing in `__NEXT_DATA__` › initialReduxState.property, the postcode in its dataLayer. */
export function onthemarket(page: PageSnapshot): ListingFacts | null {
  const id = LISTING.exec(page.url)?.[1];
  if (!id) return null;
  const state = get(parseJson(page.nextData), "props", "pageProps", "initialReduxState");
  const property = get(state, "property");
  // Client-side navigation leaves the first page's data behind: only trust it for its own listing.
  if (!property || String(get(property, "id")) !== id) return null;
  const layer = get(state, "metadata", "dataLayer");
  const channel = String(get(layer, "channel") ?? get(property, "channel") ?? "");
  const market = /rent|letting/i.test(channel) ? "rent" : "buy";
  // The "Key information" list: [{title: "Tenure", value: "Leasehold  |  112 yrs left"}, {title: "Council tax", …}].
  const keyInfo = get(property, "keyInfo");
  const info = (title: string) =>
    get((Array.isArray(keyInfo) ? keyInfo : []).find((item) => get(item, "title") === title), "value");
  return {
    portal: "onthemarket",
    listingId: id,
    url: `https://www.onthemarket.com/details/${id}/`,
    address: (get(property, "displayAddress") as string | undefined)?.trim() || null,
    lat: numberOrNull(get(property, "location", "lat")),
    lng: numberOrNull(get(property, "location", "lon")),
    postcode: postcodeOrNull(get(layer, "postcode")),
    market,
    askingPrice: parsePrice(get(property, "price"), market),
    bedrooms: bedroomsOrNull(get(property, "bedrooms")),
    floorAreaSqm: null,
    tenure: tenureOf(get(property, "tenure") ?? get(layer, "tenure") ?? info("Tenure")),
    // No date added or price history: the page says only "Added > 14 days" or "Reduced < 7 days".
    ...stated({
      propertyType: propertyTypeOf(get(property, "humanisedPropertyType")),
      councilTaxBand: councilTaxBandOf(info("Council tax")),
      serviceChargeYearly: yearlyAmountOf(info("Service charge")),
      groundRentYearly: yearlyAmountOf(info("Ground rent")),
      leaseYearsRemaining: leaseYearsOf(info("Tenure")),
      epcRating: epcRatingOf(get(property, "epc", "rating")),
    }),
  };
}
