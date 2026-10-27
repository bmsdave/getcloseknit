import type { ListingFacts, PageSnapshot } from "../types";
import { bedroomsOrNull, numberOrNull, parsePrice, propertyTypeOf, stated } from "./parse";

const LISTING = /^https:\/\/www\.openrent\.co\.uk\/(?:property-to-rent\/[^/?#]+\/[^/?#]+\/)?(\d+)(?:[/?#]|$)/;
// "London - 1 Bed Flat, Example Road, SE1 - To Rent Now for £2,750.00 p/m"
const TITLE = /^.+? - (.+?) - To Rent Now for (.+)$/;

/** OpenRent: the point (its postcode's) on the page's #map element, the kind, address and rent in its title. */
export function openrent(page: PageSnapshot): ListingFacts | null {
  const id = LISTING.exec(page.url)?.[1];
  if (!id) return null;
  const map = page.mapData;
  // The map loads its own listing's street view: only trust a point that belongs to this one.
  if (!map || !map.mapLoadLocation?.endsWith(`/${id}`)) return null;
  const title = TITLE.exec(page.title.trim());
  const [kind = "", ...address] = title?.[1].split(", ") ?? [];
  // A room's rent says nothing against the borough's average rent for a home, so none is sent.
  const room = /^room\b/i.test(kind);
  return {
    portal: "openrent",
    listingId: id,
    url: page.url.split(/[?#]/)[0],
    address: address.join(", ") || null,
    lat: numberOrNull(map.lat),
    lng: numberOrNull(map.lng),
    postcode: null,
    market: "rent",
    askingPrice: room ? null : parsePrice(title?.[2], "rent"),
    bedrooms: room ? null : /^studio\b/i.test(kind) ? 0 : bedroomsOrNull(/^(\d+) bed\b/i.exec(kind)?.[1]),
    floorAreaSqm: null,
    tenure: "unknown",
    // "3 Bed Terraced House", "Room in a Shared Flat": the kind is all the page's data states of the new facts.
    ...stated({ propertyType: propertyTypeOf(kind) }),
  };
}
