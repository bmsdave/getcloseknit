/**
 * Private rents for an area's borough (area-rents.v1, ONS Price Index of
 * Private Rents). Borough-wide by bedroom count, next to London's: a ballpark
 * for the area, never the rent of a particular home.
 */
import type { GeographyId } from "./contracts";

export type RentBedrooms = "oneBedroom" | "twoBedrooms" | "threeBedrooms" | "fourOrMoreBedrooms" | "all";

export const RENT_BEDROOM_LABELS: Record<RentBedrooms, string> = {
  oneBedroom: "1 bedroom", twoBedrooms: "2 bedrooms", threeBedrooms: "3 bedrooms",
  fourOrMoreBedrooms: "4 or more bedrooms", all: "All homes",
};

export interface AreaRent {
  bedrooms: RentBedrooms;
  monthlyRent: number;
  annualChangePct: number | null;
  regionMonthlyRent: number | null;
}

export interface AreaRentsResponse {
  schemaVersion: "area-rents.v1";
  productReleaseId?: string;
  geographyId: GeographyId;
  available: boolean;
  borough: { id: GeographyId; name: string } | null;
  /** YYYY-MM */
  period: string | null;
  rents: AreaRent[];
  sourceVersion: string | null;
  attribution: string | null;
  caveats: string[];
}

export function rentsPath(id: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/rents`;
}

/** The payload when it is area-rents.v1; real mode never takes the demo's. */
export function readAreaRents(payload: unknown, mode: "real" | "demo"): AreaRentsResponse | null {
  const value = payload as Partial<AreaRentsResponse> | null;
  if (!value || value.schemaVersion !== "area-rents.v1" || !Array.isArray(value.rents)) return null;
  if (mode === "real" && value.sourceVersion?.startsWith("preview-")) return null;
  return value as AreaRentsResponse;
}

/** Demo rents shaped like area-rents.v1 (made up). */
export function fixtureAreaRents(id: GeographyId): AreaRentsResponse {
  const rents: [RentBedrooms, number, number][] = [
    ["oneBedroom", 1850, 1650], ["twoBedrooms", 2400, 2100], ["threeBedrooms", 3100, 2700],
    ["fourOrMoreBedrooms", 4300, 3800], ["all", 2350, 2150],
  ];
  return {
    schemaVersion: "area-rents.v1",
    geographyId: id,
    available: true,
    borough: { id: "uk:lad:E09000019" as GeographyId, name: "Islington" },
    period: "2026-08",
    rents: rents.map(([bedrooms, monthlyRent, regionMonthlyRent]) => ({
      bedrooms, monthlyRent, annualChangePct: 3.5, regionMonthlyRent,
    })),
    sourceVersion: "preview-ons-pipr",
    attribution: "Demo numbers shaped like the ONS Price Index of Private Rents.",
    caveats: ["Demo data: not real rents."],
  };
}
