import type { GeographyId } from "./contracts";
import { regionShare } from "./evidence-format";
import type { RankScope } from "./scope-name";

/** Mirrors api/area_api/council_tax.py (area-council-tax.v1): homes by council tax band, VOA CTSOP. */
export const COUNCIL_TAX_BANDS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type CouncilTaxBand = (typeof COUNCIL_TAX_BANDS)[number];

export interface CouncilTaxBands {
  geographyId: GeographyId;
  period: string;
  bands: { band: CouncilTaxBand; homes: number; share: number }[];
  homes: number;
  mostCommon: CouncilTaxBand;
  medianBand: CouncilTaxBand;
  /** A = 1 ... H = 8; null under 50 homes. */
  meanBand: number | null;
  regionPercentile: number | null;
  borough: { id: GeographyId; name: string } | null;
  /** The middle home's band at the borough's average Band D. */
  typicalBill: { band: CouncilTaxBand; amount: number; bandD: number; financialYear: string } | null;
  sourceVersions: string[];
}

export interface AreaCouncilTaxResponse {
  schemaVersion: "area-council-tax.v1";
  productReleaseId: string;
  dataMode: "release" | "demo";
  /** The region regionPercentile is within (API rankScope); absent = London. */
  rankScope?: RankScope | null;
  value: CouncilTaxBands | null;
  confidence: "high" | "medium" | "low" | "none";
  evidence: Record<string, unknown>[];
  sources: { release: string; sourceUrl: string; licence: string; attribution: string }[];
  caveats: string[];
}

export function councilTaxPath(geographyId: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(geographyId)}/council-tax`;
}

/** The payload when it is an area-council-tax.v1 envelope, else null. */
export function readCouncilTax(payload: unknown): AreaCouncilTaxResponse | null {
  const body = payload as AreaCouncilTaxResponse | null;
  return body?.schemaVersion === "area-council-tax.v1" && Array.isArray(body.caveats) ? body : null;
}

/** Demo mode has no bands: an honest empty envelope shaped like the real thing. */
export function demoCouncilTax(): AreaCouncilTaxResponse {
  return {
    schemaVersion: "area-council-tax.v1", productReleaseId: "preview-release", dataMode: "demo", value: null,
    confidence: "none", evidence: [], sources: [], caveats: ["Council tax bands are loaded in real mode only."],
  };
}

/** "£2,208 a year · Band D" for the typical bill, or null when Band D is unknown. */
export function typicalBillWords(value: CouncilTaxBands): string | null {
  const bill = value.typicalBill;
  return bill ? `£${bill.amount.toLocaleString("en-GB")} a year · Band ${bill.band}` : null;
}

/** "Higher bands than 81% of London areas" (lower below the middle; `scope` is the area's region); null when not ranked. */
export function bandsVersusLondon(percentile: number | null, scope = "London"): string | null {
  if (percentile === null) return null;
  return percentile >= 50 ? `Higher bands than ${regionShare(percentile)}% of ${scope} areas` : `Lower bands than ${regionShare(100 - percentile)}% of ${scope} areas`;
}
