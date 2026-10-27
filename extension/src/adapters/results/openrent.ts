import { bedroomsOrNull } from "../parse";
import { numberArray } from "./common";
import type { ResultItem, ResultsAdapter } from "./types";

const SEARCH = /^https:\/\/www\.openrent\.co\.uk\/properties-to-rent\b/;
const LINK = /^(?:https:\/\/www\.openrent\.co\.uk)?\/(?:property-to-rent\/[^/?#]+\/[^/?#]+\/)?(\d+)(?:[/?#]|$)/;

/**
 * OpenRent keeps every result of a search in parallel arrays (`var PROPERTYIDS = [...]`, latitudes,
 * longitudes, monthly rents, bedrooms); the page draws cards from them as it scrolls.
 */
export const openrent: ResultsAdapter = {
  portal: "openrent",
  matches: (url) => SEARCH.test(url),
  linkId: (href) => LINK.exec(href)?.[1] ?? null,
  read(page) {
    const script = page.scripts.find((text) => text.includes("var PROPERTYIDS"));
    if (!script) return [];
    const ids = numberArray(script, "PROPERTYIDS") ?? [];
    const column = (name: string) => {
      const values = numberArray(script, name);
      return values && values.length === ids.length ? values : null;
    };
    const [lats, lngs, prices, beds, studio, shared] = ["PROPERTYLISTLATITUDES", "PROPERTYLISTLONGITUDES", "prices",
      "bedrooms", "isstudio", "isshared"].map(column);
    if (!lats || !lngs) return [];
    return ids.flatMap((id, i): ResultItem[] => {
      if (!Number.isInteger(id)) return [];
      // A room's rent says nothing against the borough's average rent for a home, so none is sent.
      const room = shared?.[i] === 1;
      return [{
        listingId: String(id),
        url: `https://www.openrent.co.uk/${id}`,
        lat: Number.isFinite(lats[i]) ? lats[i] : null,
        lng: Number.isFinite(lngs[i]) ? lngs[i] : null,
        postcode: null,
        market: "rent",
        askingPrice: !room && prices && prices[i] > 0 ? Math.round(prices[i]) : null,
        bedrooms: room ? null : studio?.[i] === 1 ? 0 : bedroomsOrNull(beds?.[i]),
        propertyType: "unknown",
      }];
    });
  },
};
