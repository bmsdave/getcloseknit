import { bedroomsOrNull, get, numberOrNull, parsePrice } from "../parse";
import { flightText, listedOnOf, objectsWithKey, propertyTypeOf, withListedOn } from "./common";
import type { ResultItem, ResultsAdapter } from "./types";

const SEARCH = /^https:\/\/www\.zoopla\.co\.uk\/(for-sale|to-rent|new-homes)\/(?!details\/)/;
const LINK = /^(?:https:\/\/www\.zoopla\.co\.uk)?\/(?:for-sale|to-rent|new-homes)\/details\/(\d+)/;

/**
 * Zoopla streams its results into the page's Next.js data: each result is an object with listingId,
 * listingUris.detail, its point (`pos`, or `location.coordinates` for featured ones), price and features.
 * A result may be streamed twice; the copy with its link is the one read.
 */
export const zoopla: ResultsAdapter = {
  portal: "zoopla",
  matches: (url) => SEARCH.test(url),
  linkId: (href) => LINK.exec(href)?.[1] ?? null,
  read(page) {
    const seen = new Set<string>();
    return objectsWithKey(flightText(page.scripts), "listingId").flatMap((listing): ResultItem[] => {
      const id = String(get(listing, "listingId") ?? "");
      const detail = get(listing, "listingUris", "detail");
      const section = typeof detail === "string" ? /^\/(for-sale|to-rent|new-homes)\/details\/(\d+)/.exec(detail) : null;
      if (!section || section[2] !== id || seen.has(id)) return [];
      seen.add(id);
      const market = section[1] === "to-rent" ? "rent" : "buy";
      const features = get(listing, "features");
      const beds = Array.isArray(features) ? get(features.find((f) => get(f, "iconId") === "bed"), "content") : null;
      // "publishedOn": "18th Sep 2025" under "publishedOnLabel": "Listed on" (a reduction's label says so).
      const label = String(get(listing, "publishedOnLabel") ?? "");
      const listedOn = /reduc/i.test(label) ? null : listedOnOf(get(listing, "publishedOn"), get(listing, "datePosted"));
      return [withListedOn({
        listingId: id,
        url: `https://www.zoopla.co.uk${detail}`,
        lat: numberOrNull(get(listing, "pos", "lat") ?? get(listing, "location", "coordinates", "latitude")),
        lng: numberOrNull(get(listing, "pos", "lng") ?? get(listing, "location", "coordinates", "longitude")),
        postcode: null,
        market,
        // A rent's text says its period ("£2,000 pcm", "£450 pw"); a sale's figure is plain.
        askingPrice: market === "rent" ? parsePrice(get(listing, "price"), "rent")
          : parsePrice(get(listing, "priceUnformatted"), "buy"),
        bedrooms: bedroomsOrNull(beds),
        propertyType: propertyTypeOf(get(listing, "propertyType")),
      }, listedOn)];
    });
  },
  popups: {
    // The map view's Google info window holds a mini card; its pins come from an API, not the page, so the
    // facts come from the results list when it has the listing, else from the listing's page.
    card: '.gm-style [data-name="card"][data-testid^="minicard-"]',
    place: "append",
  },
};
