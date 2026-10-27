// "Save to Close Knit" from the browser extension's card (api/area_api/listing_card.py save_href):
// the listing's public facts arrive in a `#listing=v1.` fragment, so they never reach a server log,
// and become an AE-29 user candidate whose every field stays unverified.
import type { GeographyId } from "./contracts";
import { buildUserCandidate, type BuildCandidateResult, type UserCandidate } from "./user-candidates";

export const LISTING_FRAGMENT_PREFIX = "#listing=v1.";
const PORTALS = ["rightmove", "zoopla", "onthemarket", "spareroom", "openrent"] as const;
const PORTAL_URL = /^https:\/\/www\.(rightmove\.co\.uk|zoopla\.co\.uk|onthemarket\.com|spareroom\.co\.uk|openrent\.co\.uk)\//;

export interface SharedListing {
  url: string;
  address: string | null;
  market: "buy" | "rent";
  askingPrice: number | null;
  bedrooms: number | null;
  floorAreaSqm: number | null;
  geographyId: GeographyId | null;
  portal: (typeof PORTALS)[number];
}

export function decodeListingFragment(hash: string): SharedListing | null {
  if (!hash.startsWith(LISTING_FRAGMENT_PREFIX)) return null;
  try {
    const body = hash.slice(LISTING_FRAGMENT_PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(body + "=".repeat((4 - (body.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (typeof raw.url !== "string" || !PORTAL_URL.test(raw.url)) return null;
    if (!PORTALS.includes(raw.portal as SharedListing["portal"])) return null;
    return {
      url: raw.url,
      address: typeof raw.address === "string" && raw.address.trim() ? raw.address.trim().slice(0, 200) : null,
      market: raw.market === "rent" ? "rent" : "buy",
      askingPrice: positive(raw.askingPrice),
      bedrooms: Number.isInteger(raw.bedrooms) && (raw.bedrooms as number) >= 0 ? raw.bedrooms as number : null,
      floorAreaSqm: positive(raw.floorAreaSqm),
      geographyId: typeof raw.geographyId === "string" && raw.geographyId.startsWith("uk:lsoa:") ? raw.geographyId as GeographyId : null,
      portal: raw.portal as SharedListing["portal"],
    };
  } catch {
    return null;
  }
}

/** The listing as a candidate; the extension already placed it in an area, so that is kept. */
export function candidateFromListing(listing: SharedListing, existing: UserCandidate[], now?: string): BuildCandidateResult {
  const built = buildUserCandidate({
    addressText: listing.address ?? listing.url,
    referenceUrl: listing.url,
    askingKind: listing.market === "rent" ? "rent" : "sale",
    askingAmount: listing.askingPrice,
    priceUnit: listing.market === "rent" ? "gbp-per-month" : "gbp-total",
    bedrooms: listing.bedrooms,
    floorAreaSqm: listing.floorAreaSqm,
  }, [], existing, now);
  if (!built.ok) return built;
  return { ok: true, candidate: { ...built.candidate, geographyId: built.candidate.geographyId ?? listing.geographyId } };
}

export function areaPath(geographyId: GeographyId): string {
  const [, carrier, code] = geographyId.split(":");
  return `/area/${carrier}/${code}`;
}

/** The area-summary read behind the saved confirmation's name: it must name a metric and a month
 * (without them the API answers 422). The month is left out only when unknown (demo). */
export function areaSummaryPath(geographyId: GeographyId, period: string | null): string {
  const query = new URLSearchParams({ metric: "price-per-square-metre" });
  if (period && /^\d{4}-\d{2}$/.test(period)) query.set("period", period);
  return `/api/v1/areas/${encodeURIComponent(geographyId)}?${query.toString()}`;
}

/** A postcode's outward code in an address ("…, London SW1A 1AA" → "SW1A"), or null. */
function outcodeOf(address: string | null): string | null {
  return address?.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/)?.[1] ?? null;
}

/**
 * The area's name for a listing: "Strand, St James & Mayfair · W1D" drops its district when the listing's own
 * postcode is in another one (SW1A 1AA), so the page never gives the home the wrong district.
 */
export function nameForListing(area: string | null, address: string | null): string | null {
  const own = outcodeOf(address);
  const [name, district] = area?.split(" · ") ?? [];
  if (!area || !own || !district || district.toUpperCase() === own) return area;
  return name;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
