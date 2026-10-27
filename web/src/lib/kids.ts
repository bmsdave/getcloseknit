/**
 * Kids (area-kids.v1, api/area_api/kids.py): well-rated nurseries within 1 km,
 * pedestrians and cyclists hurt within 500 m over five years, and km of
 * protected lane and Cycleway within 1 km. Three ratings against London,
 * never one score. Pure, so unit tested without a DOM.
 */
import type { GeographyId } from "./contracts";
import type { RatingTrend } from "./rating";

export interface KidsNursery {
  urn: string;
  name: string;
  /** "Outstanding", "Good" (old framework) or the report card's weakest area, e.g. "Expected standard". */
  grade: string;
  framework: "overall-effectiveness" | "report-card";
  inspected: string | null;
  wellRated: boolean;
  places: number | null;
  distanceMetres: number;
  url: string;
}

export interface KidsSource {
  id: string;
  url: string;
  releaseDate: string;
  licence: string;
  attribution: string;
  caveats: string[];
}

export interface AreaKidsResponse {
  schemaVersion: "area-kids.v1";
  productReleaseId: string;
  geographyId: GeographyId;
  available: boolean;
  nurseries: {
    radiusMetres: number; rated: number; wellRated: number; share: number | null;
    regionPercentile: number | null; nearest: KidsNursery[];
  } | null;
  roadSafety: {
    radiusMetres: number; casualties: number; children: number; seriousOrFatal: number;
    cyclists: number; pedestrians: number; byYear: { year: number; count: number }[];
    regionPercentile: number | null;
  } | null;
  cycling: { radiusMetres: number; protectedKm: number; cyclewayKm: number; regionPercentile: number | null } | null;
  sources: KidsSource[];
}

export const kidsPath = (id: GeographyId) => `/api/v1/areas/${encodeURIComponent(id)}/kids`;

/** The last two years against the first two ("−12% vs 2021–22"); up is bad. Hidden with fewer than 4 years or none at the start. */
export function casualtyTrend(byYear: readonly { year: number; count: number }[]): RatingTrend | undefined {
  if (byYear.length < 4) return undefined;
  const sum = (points: readonly { count: number }[]) => points.reduce((total, point) => total + point.count, 0);
  const before = sum(byYear.slice(0, 2));
  const after = sum(byYear.slice(-2));
  if (before <= 0) return undefined;
  const first = byYear[0].year;
  return { pct: (after / before - 1) * 100, period: `${first}–${String(first + 1).slice(-2)}`, goodWhenUp: false, n: before + after };
}

const km = (value: number) => (value === 0 ? "0" : value >= 10 ? Math.round(value).toString() : value.toFixed(1));

/** Tile facts stay at four words or fewer (the card's no-paragraph rule); the rest is behind Details. */
export function nurseryFact(nurseries: NonNullable<AreaKidsResponse["nurseries"]>): string {
  if (nurseries.rated === 0) return "None rated nearby";
  return `${nurseries.wellRated}/${nurseries.rated} rated well`;
}

export function roadFact(road: NonNullable<AreaKidsResponse["roadSafety"]>): string {
  return `${road.casualties} hurt, ${road.children === 1 ? "1 child" : `${road.children} children`}`;
}

export function cycleFact(cycling: NonNullable<AreaKidsResponse["cycling"]>): string {
  return `${km(cycling.protectedKm)} km protected`;
}

/** "Good · 2024" or "Expected standard (report card) · 2025". */
export function nurseryGrade(nursery: KidsNursery): string {
  const word = nursery.framework === "report-card" ? `${nursery.grade} (report card)` : nursery.grade;
  return nursery.inspected ? `${word} · ${nursery.inspected.slice(0, 4)}` : word;
}

/** Demo numbers for the preview areas (made up, shaped like area-kids.v1). */
export function fixtureAreaKids(id: GeographyId): AreaKidsResponse | null {
  const code = id.split(":").at(-1) ?? "";
  const seed = { E01000001: 0, E01000002: 1, E01000003: 2, E02000001: 0, E02000002: 1, E02000003: 2 }[code];
  if (seed === undefined) return null;
  const years = [[61, 70, 66, 58, 55], [8, 6, 9, 5, 4], [30, 34, 31, 33, 36]][seed];
  return {
    schemaVersion: "area-kids.v1",
    productReleaseId: "preview-release",
    geographyId: id,
    available: true,
    nurseries: {
      radiusMetres: 1000, rated: [9, 6, 12][seed], wellRated: [9, 5, 11][seed], share: [100, 83.3, 91.7][seed],
      regionPercentile: [60, 35, 82][seed],
      nearest: [
        { urn: "EY000001", name: "Preview Nursery", grade: "Good", framework: "overall-effectiveness", inspected: "2024-03-06",
          wellRated: true, places: 40, distanceMetres: 240, url: "https://reports.ofsted.gov.uk/" },
        { urn: "EY000002", name: "Preview Pre-school", grade: "Expected standard", framework: "report-card", inspected: "2026-01-20",
          wellRated: true, places: 24, distanceMetres: 610, url: "https://reports.ofsted.gov.uk/" },
      ],
    },
    roadSafety: {
      radiusMetres: 500, casualties: years.reduce((a, b) => a + b, 0), children: [9, 2, 5][seed],
      seriousOrFatal: [52, 6, 28][seed], cyclists: [140, 12, 70][seed], pedestrians: [170, 20, 94][seed],
      byYear: years.map((count, index) => ({ year: 2021 + index, count })), regionPercentile: [97, 12, 74][seed],
    },
    cycling: { radiusMetres: 1000, protectedKm: [1.4, 0, 0.6][seed], cyclewayKm: [5.4, 0.8, 2.2][seed], regionPercentile: [95, 30, 70][seed] },
    sources: [
      { id: "preview-ofsted", url: "https://www.gov.uk/government/statistical-data-sets/childcare-providers-and-inspections-management-information",
        releaseDate: "2026-06-30", licence: "OGL-UK-3.0", attribution: "Ofsted (preview figures)", caveats: [] },
    ],
  };
}
