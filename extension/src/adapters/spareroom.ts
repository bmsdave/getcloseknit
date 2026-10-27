import type { ListingFacts, PageSnapshot } from "../types";
import { blockAfter, numberOrNull, propertyTypeOf, stated } from "./parse";

const LISTING = /^https:\/\/www\.spareroom\.co\.uk\/flatshare\/(?:flatshare_detail\.pl\?(?:[^#]*&)?flatshare_id=(\d+)|[a-z0-9_/-]+\/(\d+)(?:[?#]|$))/;
const MARKER = "advert:";

/**
 * SpareRoom keeps the ad in `_sr.page = { advert: {…} }`, a JavaScript (not JSON) object. The page shows
 * only the outcode and the nearest station, and the map point is the advertiser's, not always the home's
 * postcode, so the card is about the area around it.
 */
export function spareroom(page: PageSnapshot): ListingFacts | null {
  const match = LISTING.exec(page.url);
  const id = match?.[1] ?? match?.[2];
  if (!id) return null;
  const advert = page.scripts.map((text) => (text.includes("_sr.page") ? blockAfter(text, MARKER) : null)).find(Boolean);
  // A room-wanted ad is a person, not a place; an ad for another listing is never shown here.
  if (!advert || field(advert, "id") !== id || field(advert, "type") !== "offered") return null;
  const point = /location:\s*\{\s*latitude:\s*"([^"]*)",\s*longitude:\s*"([^"]*)"/.exec(advert);
  const place = /\bin (.+) \(([A-Z]{1,2}\d[A-Z\d]?)\)$/i.exec(field(advert, "share_title") ?? "");
  return {
    portal: "spareroom",
    listingId: id,
    url: match?.[1] ? `https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=${id}` : page.url.split(/[?#]/)[0],
    address: place ? `${place[1]}, ${place[2].toUpperCase()}` : null,
    lat: numberOrNull(point?.[1]),
    lng: numberOrNull(point?.[2]),
    postcode: null,
    market: "rent",
    // A room's rent says nothing against the borough's average rent for a home, so none is sent.
    askingPrice: null,
    bedrooms: null,
    floorAreaSqm: null,
    tenure: "unknown",
    locationApproximate: true,
    // The ad's page says nothing else of the new facts: no EPC, council tax band, lease or listing dates.
    ...stated({ propertyType: propertyTypeOf(adKind(page.scripts)) }),
  };
}

/** The page's tracking script spells the home out: `var propertyType ='4 bed ' + '' + 'flat';` → "4 bed flat". */
function adKind(scripts: string[]): string | null {
  for (const text of scripts) {
    const parts = /var propertyType\s*=\s*((?:'[^']*'\s*\+?\s*)+);/.exec(text)?.[1];
    if (parts) return [...parts.matchAll(/'([^']*)'/g)].map((m) => m[1]).join("");
  }
  return null;
}

/** A top-level string field of the advert object: `name: "value"`. */
function field(advert: string, name: string): string | null {
  return new RegExp(`[{,]\\s*${name}:\\s*"([^"]*)"`).exec(advert)?.[1] ?? null;
}
