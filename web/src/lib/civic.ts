/**
 * Civic context for an area or a postcode (track J): where it sits (England ›
 * London › borough › ward), its official codes, the borough's council tax
 * bands and its elected representatives. Contract `civic.v1`, served by
 * GET /api/v1/areas/{id}/civic and /api/v1/postcodes/{postcode}/civic.
 * Missing data is null and reads as "unknown", never as zero.
 */
import type { GeographyId } from "./contracts";
import { isFixtureSourceVersion } from "./fixtures";
import type { DataMode } from "./map-state";
import type { Withheld } from "./property-profile";

export interface CivicPlaceRef { code: string; name: string | null }
export interface CivicShare extends CivicPlaceRef { share: number }

export interface CivicSubject {
  kind: "lsoa" | "msoa" | "borough" | "postcode";
  geographyId: GeographyId | null;
  postcode: string | null;
  /** YYYY-MM, postcodes only. */
  introduced: string | null;
  terminated: string | null;
}

export interface CivicPerson {
  role: "councillor" | "mp";
  areaCode: string;
  areaName: string | null;
  name: string;
  party: string | null;
  electedOn: string | null;
  profileUrl: string | null;
}

export interface CouncilTaxBand { band: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"; amount: number | null }

export type CouncilTaxPrecept = "gla" | "county" | "police" | "fire" | "combined-authority" | "parish";

export const PRECEPT_LABELS: Record<CouncilTaxPrecept, string> = {
  gla: "GLA", county: "County", police: "Police", fire: "Fire", "combined-authority": "Combined authority",
  parish: "Parish",
};

export interface CouncilTax {
  financialYear: string;
  boroughCode: string | null;
  boroughName: string | null;
  bandDBorough: number | null;
  bandDGla: number | null;
  /** Who else the Band D goes to, in bill order: the GLA (London), else the county, police, fire,
   * combined authority and the average parish precept, each only where levied. */
  precepts?: { kind: CouncilTaxPrecept; amount: number }[];
  bands: CouncilTaxBand[];
  sourceVersion: string;
}

export interface CivicSource { id: string; licence: string; attribution: string; caveats: string[]; releaseDate: string }

export interface CivicResponse {
  schemaVersion: "civic.v1";
  productReleaseId: string;
  subject: CivicSubject;
  available: boolean;
  place: {
    country: CivicPlaceRef | null;
    region: CivicPlaceRef | null;
    borough: CivicPlaceRef | null;
    ward: CivicPlaceRef | null;
    parish: CivicPlaceRef | null;
    constituency: CivicPlaceRef | null;
    policeForce: CivicPlaceRef | null;
    msoa: CivicPlaceRef | null;
    lsoa: CivicPlaceRef | null;
  };
  wards: CivicShare[];
  constituencies: CivicShare[];
  livePostcodes: number | null;
  councilTax: CouncilTax | null;
  /** The subject home's band, "A"–"H"; absent or null until a licensed per-home source is loaded. */
  councilTaxBand?: string | null;
  withheld?: Withheld[];
  representedWards: CivicPlaceRef[];
  representedConstituencies: CivicPlaceRef[];
  councillors: CivicPerson[];
  mps: CivicPerson[];
  fetchedOn: { councillors: string | null; mps: string | null };
  sources: CivicSource[];
}

export type CivicTarget = { geographyId: GeographyId } | { postcode: string };

export type CivicState =
  | { status: "loading" }
  | { status: "available"; civic: CivicResponse }
  | { status: "unavailable"; reason: string };

export function civicPath(target: CivicTarget): string {
  return "geographyId" in target
    ? `/api/v1/areas/${encodeURIComponent(target.geographyId)}/civic`
    : `/api/v1/postcodes/${encodeURIComponent(target.postcode.replace(/\s+/g, ""))}/civic`;
}

/** Parse a civic payload; real mode never accepts preview (fixture) sources. */
export function readCivic(payload: unknown, mode: DataMode): CivicState {
  const civic = payload as Partial<CivicResponse> | null;
  if (!civic || civic.schemaVersion !== "civic.v1" || !civic.place || !Array.isArray(civic.sources)) {
    return { status: "unavailable", reason: "invalid-civic-response" };
  }
  if (mode === "real" && civic.sources.some((source) => isFixtureSourceVersion(source.id))) {
    return { status: "unavailable", reason: "fixture-civic-in-real-mode" };
  }
  if (!civic.available) return { status: "unavailable", reason: "no-civic-data" };
  return { status: "available", civic: civic as CivicResponse };
}

export interface Crumb { label: string; code: string | null }

const label = (ref: CivicPlaceRef | null, fallback: string) => ref?.name ?? (ref ? ref.code : fallback);

/** England › London › borough › ward › area; an unknown step says "unknown". */
export function civicBreadcrumb(civic: CivicResponse): Crumb[] {
  const { place, subject } = civic;
  const crumbs: Crumb[] = [
    { label: label(place.country, "England"), code: place.country?.code ?? null },
    { label: label(place.region, "London"), code: place.region?.code ?? null },
    { label: label(place.borough, "Borough unknown"), code: place.borough?.code ?? null },
  ];
  if (subject.kind === "borough") return crumbs;
  crumbs.push({ label: place.ward ? `${label(place.ward, "")} ward` : "Ward unknown", code: place.ward?.code ?? null });
  if (subject.kind === "postcode" && subject.postcode) crumbs.push({ label: subject.postcode, code: null });
  else if (subject.kind === "lsoa") crumbs.push({ label: label(place.lsoa, "This area"), code: place.lsoa?.code ?? null });
  else if (subject.kind === "msoa") crumbs.push({ label: label(place.msoa, "This area"), code: place.msoa?.code ?? null });
  return crumbs;
}

export interface CodeRow { label: string; name: string | null; code: string | null }

/** The official codes list, in the order a newcomer reads a place: biggest first. */
export function civicCodes(civic: CivicResponse): CodeRow[] {
  const { place } = civic;
  const row = (rowLabel: string, ref: CivicPlaceRef | null): CodeRow =>
    ({ label: rowLabel, name: ref?.name ?? null, code: ref?.code ?? null });
  const rows = [
    row("Region", place.region),
    row("Borough (council)", place.borough),
    row("Ward", place.ward),
    row("Parliamentary constituency", place.constituency),
    row("Police force", place.policeForce),
    row("Middle layer area (MSOA)", place.msoa),
    row("Lower layer area (LSOA)", place.lsoa),
  ];
  if (place.parish) rows.splice(3, 0, row("Parish", place.parish));
  const kind = civic.subject.kind;
  return rows.filter((item) => {
    if (kind === "borough") return !["Ward", "Middle layer area (MSOA)", "Lower layer area (LSOA)"].includes(item.label);
    if (kind === "msoa") return item.label !== "Lower layer area (LSOA)";
    return true;
  });
}

/** Other wards the area spills into, with their share of its postcodes. */
export function otherWards(civic: CivicResponse): CivicShare[] {
  return civic.subject.kind === "borough" ? [] : civic.wards.slice(1);
}

export function formatCouncilTax(amount: number | null): string {
  return amount === null ? "unknown" : `£${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatShare(share: number): string {
  return share < 0.01 ? "under 1%" : `${Math.round(share * 100)}%`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-05" → "5 October 2026"; "1980-01" → "January 1980"; null → "unknown". */
export function formatCivicDate(value: string | null): string {
  if (!value) return "unknown";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month) return "unknown";
  const name = MONTHS[month - 1] ?? "";
  return day ? `${day} ${name} ${year}` : `${name} ${year}`;
}
