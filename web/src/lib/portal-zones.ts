/**
 * A search opened on the portals. The API (api/area_api/portal_zones.py, POST /api/v1/portal-links)
 * turns each My match zone into what each portal takes (a drawn area, a borough search, or up to 3 postcode
 * districts); every link goes through /go, which rebuilds the portal URL from its parameters. This file
 * builds the same /go links for an area's postcode districts, the preview answer without the API, and the
 * search id the Close Knit extension reads. Formats pinned with the API by contracts/fixtures/portal-zones.json.
 */
import type { MatchZone, PreferenceProfile } from "./contracts";
import { PREVIEW_STATIONS } from "./zones";

export type ZonePortal = "rightmove" | "zoopla" | "onthemarket";
export const ZONE_PORTALS: ZonePortal[] = ["rightmove", "zoopla", "onthemarket"];
export const ZONE_PORTAL_LABELS: Record<ZonePortal, string> = { rightmove: "Rightmove", zoopla: "Zoopla", onthemarket: "OnTheMarket" };

export interface ZonePortalLink { portal: ZonePortal; label: string; href: string | null }
export interface ZoneDistrict { outcode: string; links: Record<ZonePortal, string> }
export interface ZonePortalLinks {
  kind: MatchZone["kind"];
  label: string;
  /** One link per portal that takes the zone's shape; null: that portal gets the districts. */
  portals: ZonePortalLink[];
  /** Up to 3 postcode districts covering the zone, busiest first (none in the preview). */
  districts: ZoneDistrict[];
}
export interface PortalLinksResponse {
  schemaVersion: "portal-links.v1";
  market: "buy" | "rent";
  maxPrice: number;
  minBedrooms: number;
  zones: ZonePortalLinks[];
}

/** What every portal link carries from the search: the market, the ceiling and the bedrooms (D1: always). */
export interface PortalFilter { market: "buy" | "rent"; maxPrice: number; minBedrooms: number }

const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const WALK_METRES_PER_MINUTE = 80;
const CIRCLE_CORNERS = 24;

export function portalFilter(profile: PreferenceProfile): PortalFilter {
  return { market: profile.market, maxPrice: Math.round(profile.maximumBudget), minBedrooms: Math.max(0, Math.min(10, profile.bedrooms)) };
}

/** "Up to £800k · 2+ beds" for the line under the links. */
export function filterWords(filter: PortalFilter): string {
  const price = filter.market === "rent" ? `£${filter.maxPrice.toLocaleString("en-GB")} a month`
    : filter.maxPrice >= 1_000_000 ? `£${+(filter.maxPrice / 1_000_000).toFixed(2)}m` : `£${Math.round(filter.maxPrice / 1000)}k`;
  return `Up to ${price}${filter.minBedrooms > 0 ? ` · ${filter.minBedrooms}+ beds` : ""}`;
}

function goQuery(portal: string, params: Record<string, string | number>): string {
  return `/go/${portal}?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()}`;
}

/** A postcode district's homes for sale (or to rent) on one portal, through /go (usage.go_url's format). */
export function goListingsHref(portal: ZonePortal, rawOutcode: string, filter: PortalFilter): string | null {
  const outcode = rawOutcode.trim().toUpperCase();
  if (!OUTCODE.test(outcode)) return null;
  return goQuery(portal, { kind: "listings", outcode, market: filter.market, max_price: filter.maxPrice, beds: filter.minBedrooms, from: "web" });
}

/** A drawn area on Rightmove or Zoopla, through /go (portal_zones.go_zone_url's format). */
export function goDrawHref(portal: ZonePortal, polyline: string, filter: PortalFilter): string {
  return goQuery(portal, { kind: "zone", market: filter.market, max_price: filter.maxPrice, beds: filter.minBedrooms, from: "web", shape: "draw", poly: polyline });
}

/** The link with the My match search id, for the Close Knit extension (the API puts it in a fragment). */
export function withSearchId(href: string, searchId: string | null): string {
  return searchId && href.startsWith("/go/") ? `${href}&sid=${searchId}` : href;
}

/** The extension marks the site's page when it is installed (extension/src/content/closeknit.ts). */
export function extensionInstalled(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-close-knit-extension");
}

/**
 * The My match search id: a short hash of what the portals see (market, ceiling, bedrooms, zones), so the
 * extension can tell which of its saved searches a portal page came from. Nothing in it can be read back.
 */
export function searchId(profile: PreferenceProfile): string {
  const text = JSON.stringify([profile.market, profile.maximumBudget, profile.bedrooms, profile.zones ?? []]);
  // cyrb53 (a public-domain 53-bit string hash), as 12 hex digits.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return hash.toString(16).padStart(14, "0").slice(0, 12);
}

function encodeValue(value: number): string {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (shifted >= 0x20) {
    out += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  return out + String.fromCharCode(shifted + 63);
}

/** [latitude, longitude] corners as Google's encoded polyline (precision 5), the ring closed: portal_zones.encode_polyline. */
export function encodePolyline(points: [number, number][]): string {
  const ring = points.length && (points[0][0] !== points.at(-1)![0] || points[0][1] !== points.at(-1)![1]) ? [...points, points[0]] : points;
  let lastLat = 0;
  let lastLon = 0;
  let out = "";
  for (const [lat, lon] of ring) {
    const latE5 = Math.round(lat * 1e5);
    const lonE5 = Math.round(lon * 1e5);
    out += encodeValue(latE5 - lastLat) + encodeValue(lonE5 - lastLon);
    lastLat = latE5;
    lastLon = lonE5;
  }
  return out;
}

/** A circle of `metres` around a point (24 corners): a station zone's walk as a drawn area. */
export function circleRing(latitude: number, longitude: number, metres: number): [number, number][] {
  const dLat = metres / 111_320;
  const dLon = metres / (111_320 * Math.cos((latitude * Math.PI) / 180));
  return Array.from({ length: CIRCLE_CORNERS }, (_, index) => {
    const angle = (2 * Math.PI * index) / CIRCLE_CORNERS;
    return [+(latitude + dLat * Math.sin(angle)).toFixed(5), +(longitude + dLon * Math.cos(angle)).toFixed(5)] as [number, number];
  });
}

function zoneLabel(zone: MatchZone): string {
  if (zone.label) return zone.label;
  return zone.kind === "station" ? "Near a station" : zone.kind === "borough" ? "A borough" : zone.kind === "polygon" ? "An area you drew" : "Chosen areas";
}

/** Without the API (preview data): drawn areas and preview stations as draw searches; no districts are known. */
export function previewPortalLinks(zones: MatchZone[], filter: PortalFilter): PortalLinksResponse {
  return {
    schemaVersion: "portal-links.v1", ...filter,
    zones: zones.map((zone) => {
      let polyline: string | null = null;
      if (zone.kind === "polygon") polyline = encodePolyline(zone.points);
      if (zone.kind === "station") {
        const station = PREVIEW_STATIONS.find((entry) => entry.stationId === zone.stationId);
        if (station) polyline = encodePolyline(circleRing(station.center[1], station.center[0], zone.maxWalkMinutes * WALK_METRES_PER_MINUTE));
      }
      return {
        kind: zone.kind, label: zoneLabel(zone), districts: [],
        portals: ZONE_PORTALS.map((portal) => ({
          portal, label: ZONE_PORTAL_LABELS[portal],
          href: polyline && portal !== "onthemarket" ? goDrawHref(portal, polyline, filter) : null,
        })),
      };
    }),
  };
}

/** The postcode district in a friendly title ("Gillespie Road · N5" → "N5"); null without one. */
export function titleDistrict(title: string | null | undefined): string | null {
  const tail = title?.split(" · ").at(-1)?.trim().toUpperCase() ?? "";
  return OUTCODE.test(tail) ? tail : null;
}

/**
 * The portal URL a /go link opens, for the site's own /go route when no API is configured (preview and
 * development). Production routes /go to the API (deploy/Caddyfile), which builds the same.
 */
export function previewGoTarget(portal: string, params: URLSearchParams): string | null {
  const market = params.get("market") ?? "buy";
  const maxPrice = Number(params.get("max_price"));
  const beds = Number(params.get("beds"));
  if (!["rightmove", "zoopla", "onthemarket", "openrent"].includes(portal) || !["buy", "rent"].includes(market)) return null;
  if (!Number.isInteger(maxPrice) || maxPrice < 100 || maxPrice > 100_000_000 || !Number.isInteger(beds) || beds < 0 || beds > 10) return null;
  const sid = params.get("sid");
  const fragment = sid && /^[a-z0-9]{6,32}$/.test(sid) ? `#closeknit=${sid}` : "";
  if (params.get("kind") === "zone") {
    const poly = params.get("poly") ?? "";
    if (params.get("shape") !== "draw" || !/^[\x3f-\x7e]{6,1200}$/.test(poly)) return null;
    if (portal === "rightmove") {
      const identifier = encodeURIComponent(`USERDEFINEDAREA^{"polylines":"${poly}"}`);
      const page = market === "buy" ? "property-for-sale" : "property-to-rent";
      return `https://www.rightmove.co.uk/${page}/map.html?locationIdentifier=${identifier}&maxPrice=${maxPrice}&minBedrooms=${beds}${fragment}`;
    }
    if (portal === "zoopla") {
      const encoded = encodeURIComponent(poly);
      return market === "buy"
        ? `https://www.zoopla.co.uk/for-sale/property/london/?polyenc=${encoded}&price_max=${maxPrice}&beds_min=${beds}&q=London&search_source=for-sale${fragment}`
        : `https://www.zoopla.co.uk/to-rent/property/london/?polyenc=${encoded}&price_frequency=per_month&price_max=${maxPrice}&beds_min=${beds}&q=London&search_source=to-rent${fragment}`;
    }
    return null;
  }
  const outcode = (params.get("outcode") ?? "").toUpperCase();
  if (!OUTCODE.test(outcode) || params.get("kind") !== "listings") return null;
  const lower = outcode.toLowerCase();
  const urls: Record<string, string> = market === "buy" ? {
    rightmove: `https://www.rightmove.co.uk/property-for-sale/${outcode}.html?maxPrice=${maxPrice}&minBedrooms=${beds}`,
    zoopla: `https://www.zoopla.co.uk/for-sale/property/${lower}/?price_max=${maxPrice}&beds_min=${beds}&q=${outcode}`,
    onthemarket: `https://www.onthemarket.com/for-sale/property/${lower}/?max-price=${maxPrice}&min-bedrooms=${beds}`,
  } : {
    rightmove: `https://www.rightmove.co.uk/property-to-rent/${outcode}.html?maxPrice=${maxPrice}&minBedrooms=${beds}`,
    zoopla: `https://www.zoopla.co.uk/to-rent/property/${lower}/?price_frequency=per_month&price_max=${maxPrice}&beds_min=${beds}&q=${outcode}`,
    onthemarket: `https://www.onthemarket.com/to-rent/property/${lower}/?max-price=${maxPrice}&min-bedrooms=${beds}`,
    openrent: `https://www.openrent.co.uk/properties-to-rent/${lower}?prices_max=${maxPrice}&bedrooms_min=${beds}`,
  };
  return urls[portal] ? `${urls[portal]}${fragment}` : null;
}
