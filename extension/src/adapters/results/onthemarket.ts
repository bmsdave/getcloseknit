import { bedroomsOrNull, get, numberOrNull, parseJson, parsePrice } from "../parse";
import { listedOnOf, propertyTypeOf, withListedOn } from "./common";
import type { ResultItem, ResultsAdapter } from "./types";

const SEARCH = /^https:\/\/www\.onthemarket\.com\/(for-sale|to-rent)\//;
const LINK = /^(?:https:\/\/www\.onthemarket\.com)?\/details\/(\d+)/;

/** OnTheMarket: `__NEXT_DATA__` › props.pageProps.initialReduxState.results.list (adverts have no details-url). */
export const onthemarket: ResultsAdapter = {
  portal: "onthemarket",
  matches: (url) => SEARCH.test(url),
  linkId: (href) => LINK.exec(href)?.[1] ?? null,
  read(page) {
    const list = get(parseJson(page.nextData), "props", "pageProps", "initialReduxState", "results", "list");
    if (!Array.isArray(list)) return [];
    const market = SEARCH.exec(page.url)?.[1] === "to-rent" ? "rent" : "buy";
    return list.flatMap((result): ResultItem[] => {
      const id = String(get(result, "id") ?? "");
      if (!id || get(result, "details-url") !== `/details/${id}/`) return [];
      return [withListedOn({
        listingId: id,
        url: `https://www.onthemarket.com/details/${id}/`,
        lat: numberOrNull(get(result, "location", "lat")),
        lng: numberOrNull(get(result, "location", "lon")),
        postcode: null,
        market,
        askingPrice: parsePrice(get(result, "price"), market),
        bedrooms: bedroomsOrNull(get(result, "bedrooms")),
        propertyType: propertyTypeOf(get(result, "humanised-property-type")),
        // "Added today", "Added yesterday" or "Added on 18/09/2025"; a reduction or "Added > 14 days" says no day.
      }, listedOnOf(get(result, "days-since-added-reduced"), get(result, "added-or-reduced")))];
    });
  },
  popups: {
    // The map view's info box (?view=map-list): one slide per listing at the pin, each an <li> with its own links.
    card: '.gm-style [data-component="search-result-property-card"] li',
    place: "append",
    /** initialReduxState.maps.list: every pin's id and point. Its price ("£720k") is rounded, so it is left out. */
    pins(page) {
      const list = get(parseJson(page.nextData), "props", "pageProps", "initialReduxState", "maps", "list");
      if (!Array.isArray(list)) return [];
      const market = SEARCH.exec(page.url)?.[1] === "to-rent" ? "rent" : "buy";
      return list.flatMap((pin): ResultItem[] => {
        const id = String(get(pin, "id") ?? "");
        if (!/^\d+$/.test(id)) return [];
        return [{
          listingId: id, url: `https://www.onthemarket.com/details/${id}/`,
          lat: numberOrNull(get(pin, "location", "lat")), lng: numberOrNull(get(pin, "location", "lon")),
          postcode: null, market, askingPrice: null, bedrooms: null, propertyType: "unknown",
        }];
      });
    },
  },
};
