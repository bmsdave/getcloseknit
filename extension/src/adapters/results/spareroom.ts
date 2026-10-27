import type { ResultItem, ResultsAdapter } from "./types";

const SEARCH = /^https:\/\/www\.spareroom\.co\.uk\/flatshare\//;
const LINK = /^(?:https:\/\/www\.spareroom\.co\.uk)?\/flatshare\/(?:(?:flatshare_detail|fad_click)\.pl\?(?:[^#]*&)?(?:flatshare_id|fad_id)=(\d+)|[a-z0-9_/-]+\/(\d+)(?:[?#]|$))/;

/**
 * SpareRoom marks each result with data-listing-* attributes (id, type, outcode, rent). They give only
 * the outcode, never a point or a full postcode, so a result has no location to look up: the line stays
 * hidden until the request can carry an outcode. Room-wanted ads are people, not places, and are skipped.
 */
export const spareroom: ResultsAdapter = {
  portal: "spareroom",
  matches: (url) => SEARCH.test(url),
  linkId: (href) => {
    const match = LINK.exec(href);
    return match?.[1] ?? match?.[2] ?? null;
  },
  read(page) {
    return page.listingData.flatMap((data): ResultItem[] => {
      const id = data.listingId;
      if (!/^\d+$/.test(id ?? "") || data.listingType !== "offered") return [];
      return [{
        listingId: id,
        url: `https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=${id}`,
        lat: null,
        lng: null,
        postcode: null,
        market: "rent",
        // A room's rent says nothing against the borough's average rent for a home, so none is sent.
        askingPrice: null,
        bedrooms: null,
        propertyType: "unknown",
      }];
    });
  },
};
