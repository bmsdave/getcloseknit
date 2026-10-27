import { bedroomsOrNull, get, numberOrNull, parseJson, parsePrice } from "../parse";
import { listedOnOf, propertyTypeOf, withListedOn } from "./common";
import type { ResultItem, ResultsAdapter } from "./types";

const SEARCH = /^https:\/\/www\.rightmove\.co\.uk\/(?:property-for-sale|property-to-rent|new-homes-for-sale)\//;
const LINK = /^(?:https:\/\/www\.rightmove\.co\.uk)?\/properties\/(\d+)/;

/** Rightmove: `__NEXT_DATA__` › props.pageProps.searchResults.properties. */
export const rightmove: ResultsAdapter = {
  portal: "rightmove",
  matches: (url) => SEARCH.test(url),
  linkId: (href) => LINK.exec(href)?.[1] ?? null,
  read(page) {
    const properties = get(parseJson(page.nextData), "props", "pageProps", "searchResults", "properties");
    return Array.isArray(properties) ? properties.flatMap(itemOf) : [];
  },
  popups: {
    // The map view's pin card (map.html): a fixed 280 px card inside the pin's dialog, so the line hangs under it.
    card: '[role="dialog"] [class*="singlePinCardContainer"]',
    place: "below",
    /** map.html: `__NEXT_DATA__` › searchResults.geoJsonProperties.features[].properties, the same shape as a result. */
    pins(page) {
      const features = get(parseJson(page.nextData), "props", "pageProps", "searchResults", "geoJsonProperties", "features");
      return Array.isArray(features) ? features.flatMap((feature) => itemOf(get(feature, "properties"))) : [];
    },
  },
};

function itemOf(property: unknown): ResultItem[] {
  const id = numberOrNull(get(property, "id"));
  if (id === null) return [];
  // A result says transactionType; a map pin says channel.
  const market = get(property, "transactionType") === "RENT" || get(property, "channel") === "RENT" ? "rent" : "buy";
  const amount = numberOrNull(get(property, "price", "amount"));
  const frequency = String(get(property, "price", "frequency") ?? "");
  return [withListedOn({
    listingId: String(id),
    url: `https://www.rightmove.co.uk/properties/${id}`,
    lat: numberOrNull(get(property, "location", "latitude")),
    lng: numberOrNull(get(property, "location", "longitude")),
    postcode: null,
    market,
    askingPrice: amount === null ? null : market === "rent" ? rentPerMonth(amount, frequency) : parsePrice(amount, market),
    bedrooms: bedroomsOrNull(get(property, "bedrooms")),
    propertyType: propertyTypeOf(get(property, "propertySubType")),
    // firstVisibleDate: when the listing first went up; else "Added on 18/09/2025" (not "Reduced on …").
  }, listedOnOf(get(property, "firstVisibleDate"), get(property, "addedOrReduced")))];
}

/** Rightmove gives rents with their period ("monthly", "weekly", …). */
function rentPerMonth(amount: number, frequency: string): number | null {
  const perYear = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1, daily: 365 }[frequency.toLowerCase()];
  if (!perYear || amount <= 0) return null;
  return Math.round((amount * perYear) / 12);
}
