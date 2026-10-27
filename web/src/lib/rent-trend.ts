/**
 * Rent trend for an area's borough (area-rent-trend.v1, ONS Price Index of
 * Private Rents series): monthly rent since 2015 by bedrooms and type of home,
 * change over 1 and 5 years next to its region's (London for London), and the borough's rank in that region.
 * Borough-wide: a trend for the area, never the rent of a particular home.
 */
import type { GeographyId } from "./contracts";
import type { RankScope } from "./scope-name";

export type RentTrendCategory =
  | "all" | "oneBedroom" | "twoBedrooms" | "threeBedrooms" | "fourOrMoreBedrooms"
  | "flat" | "terraced" | "semiDetached" | "detached";

export const RENT_TREND_LABELS: Record<RentTrendCategory, string> = {
  all: "All homes", oneBedroom: "1 bed", twoBedrooms: "2 bed", threeBedrooms: "3 bed", fourOrMoreBedrooms: "4+ bed",
  flat: "Flats", terraced: "Terraced", semiDetached: "Semi", detached: "Detached",
};

export interface RentTrendCell {
  category: RentTrendCategory;
  rent: number | null;
  change1yPct: number | null;
  change5yPct: number | null;
  regionRent: number | null;
  regionChange1yPct: number | null;
  regionChange5yPct: number | null;
  /** month YYYY-MM, oldest first */
  series: { month: string; rent: number }[];
}

export interface RentTrendValue {
  available: boolean;
  borough: { id: GeographyId; name: string } | null;
  /** YYYY-MM */
  latest: string | null;
  /** The region the "London" figures and rank are of (API rankScope); absent = London. */
  rankScope?: RankScope | null;
  regionPercentile: Partial<Record<"rent-change-1y" | "rent-change-5y", number | null>>;
  categories: RentTrendCell[];
}

export interface RentTrendSource {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  release: string;
  licence: string;
  attribution: string;
}

export interface AreaRentTrendResponse {
  schemaVersion: "area-rent-trend.v1";
  productReleaseId: string;
  dataMode: "release" | "demo";
  value: RentTrendValue;
  confidence: "high" | "medium" | "low" | "none";
  evidence: Record<string, unknown>[];
  sources: RentTrendSource[];
  caveats: string[];
}

export function rentTrendPath(id: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/rent-trend`;
}

/** The payload when it is area-rent-trend.v1; real mode never takes the demo's. */
export function readRentTrend(payload: unknown, mode: "real" | "demo"): AreaRentTrendResponse | null {
  const body = payload as Partial<AreaRentTrendResponse> | null;
  if (!body || body.schemaVersion !== "area-rent-trend.v1" || !body.value || !Array.isArray(body.value.categories)) return null;
  if (mode === "real" && body.dataMode === "demo") return null;
  return body as AreaRentTrendResponse;
}

const BY_BEDROOMS: readonly RentTrendCategory[] = ["oneBedroom", "twoBedrooms", "threeBedrooms", "fourOrMoreBedrooms"];

/** The household's bedroom count's cell when published, else all homes. */
export function rentTrendCell(value: RentTrendValue, bedrooms: number | null | undefined): RentTrendCell | null {
  const wanted = bedrooms && bedrooms > 0 ? BY_BEDROOMS[Math.min(4, bedrooms) - 1] : "all";
  return value.categories.find((cell) => cell.category === wanted && cell.rent !== null)
    ?? value.categories.find((cell) => cell.category === "all") ?? null;
}

/** Demo trend shaped like area-rent-trend.v1 (made up). */
export function fixtureRentTrend(id: GeographyId): AreaRentTrendResponse {
  const months = Array.from({ length: 140 }, (_, index) => {
    const total = 2015 * 12 + index;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  });
  const cell = (category: RentTrendCategory, start: number): RentTrendCell => {
    const series = months.map((month, index) => ({ month, rent: Math.round(start * (1 + 0.003 * index)) }));
    return {
      category, rent: series.at(-1)!.rent, change1yPct: 3.8, change5yPct: 24.6,
      regionRent: Math.round(series.at(-1)!.rent * 0.92), regionChange1yPct: 3.1, regionChange5yPct: 22.9, series,
    };
  };
  return {
    schemaVersion: "area-rent-trend.v1",
    productReleaseId: "preview-ons-pipr-series",
    dataMode: "demo",
    value: {
      available: true,
      borough: { id: "uk:lad:E09000019" as GeographyId, name: "Islington" },
      latest: months.at(-1)!,
      regionPercentile: { "rent-change-1y": 64, "rent-change-5y": 58 },
      categories: [cell("all", 1700), cell("oneBedroom", 1400), cell("twoBedrooms", 1800), cell("threeBedrooms", 2300),
        cell("fourOrMoreBedrooms", 3200)],
    },
    confidence: id.startsWith("uk:lad:") ? "high" : "medium",
    evidence: [],
    sources: [],
    caveats: ["Demo data: not real rents."],
  };
}
