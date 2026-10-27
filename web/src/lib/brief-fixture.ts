import type { AreaBrief } from "@/lib/brief-model";
import { areaGeoJson } from "@/lib/fixtures";

/**
 * Demo-mode answer for /api/v1/brief (no evidence service): the preview areas only, with
 * illustrative numbers that are not for decisions — the same rule as every other preview fixture.
 * The ballpark is the preview scorer's price in lib/matching.ts (£600k, £440k, £510k) at every
 * bedroom count, and £/m² follows from it, so the result row, its budget chip, the map pin, the
 * area card, compare and the decision brief all show one figure.
 */
const DEMO_AREAS: Record<string, { name: string; borough: string; center: [number, number]; outcodes: string[]; price: number }> = {
  "uk:lsoa:E01000001": { name: "Westminster preview LSOA", borough: "Westminster", center: [-0.1416, 51.501], outcodes: ["SW1A"], price: 600_000 },
  "uk:lsoa:E01000002": { name: "North London preview LSOA", borough: "Islington", center: [-0.094, 51.545], outcodes: ["N1"], price: 440_000 },
  "uk:lsoa:E01000003": { name: "South Bank preview LSOA", borough: "Southwark", center: [-0.089, 51.503], outcodes: ["SE1"], price: 510_000 },
};

export function previewBrief(areaIds: string[], budget: [number | null, number | null], bedrooms: number): AreaBrief | null {
  if (areaIds.length === 0 || !areaIds.every((id) => id in DEMO_AREAS)) return null;
  const size = [38, 50, 70, 90, 115, 140][Math.min(bedrooms, 5)];
  const fit = (estimate: number) => {
    const max = budget[1];
    if (!max) return "unknown" as const;
    return estimate <= max ? "within" as const : estimate <= max * 1.15 ? "stretch" as const : "over" as const;
  };
  const place = (id: string) => {
    const demo = DEMO_AREAS[id];
    const estimate = demo.price;
    const ppm = Math.round(estimate / size);
    const outline = areaGeoJson("lsoa").features.find((feature) => feature.properties.geography_id === id)?.geometry ?? null;
    return { geographyId: id, geometry: outline, name: demo.name, borough: demo.borough, parentId: null, center: demo.center,
      outcodes: demo.outcodes, pricePerSquareMetre: ppm, estimatedPrice: estimate, assumedFloorArea: size, budgetFit: fit(estimate) };
  };
  const others = (id: string) => Object.keys(DEMO_AREAS).filter((other) => other !== id && !areaIds.includes(other));
  return {
    schemaVersion: "area-brief.v1",
    productReleaseId: "preview",
    request: { budget, bedrooms, market: "buy", propertyType: "any" },
    areas: areaIds.map((id, index) => ({
      ...place(id), rank: index + 1, ring: others(id),
      station: { stationId: "osm:preview", name: "Preview station", modes: ["underground"], walkMinutes: 6, center: [DEMO_AREAS[id].center[0] + 0.003, DEMO_AREAS[id].center[1] + 0.002], zone: "1" },
      priceContext: {
        available: true, sales: 24, windowMonths: 36, minimumSample: 10, matched: "size-and-type", floorBand: [80, 110], above: 0,
        median: 760000, p25: 680000, p75: 840000,
        bins: [{ from: 600000, to: 700000, count: 5 }, { from: 700000, to: 800000, count: 9 },
          { from: 800000, to: 900000, count: 7 }, { from: 900000, to: 1000000, count: 3 }],
        budgetMinPercentile: budget[0] ? 58 : null, budgetMaxPercentile: budget[1] ? 88 : null,
      },
    })),
    ring: [...new Set(areaIds.flatMap(others))].map((id) => ({ ...place(id), ringOf: areaIds.filter((a) => others(a).includes(id)) })),
    schools: [
      { urn: "100002", name: "Preview Academy", phase: "Secondary", latitude: 51.502, longitude: -0.14, distanceMetres: 900,
        grade: { tier: "outstanding", label: "Ofsted: Outstanding", year: "2023/24" }, attainment8: 55.1, selectivity: "Non-selective", nearAreas: [areaIds[0]] },
      { urn: "100001", name: "Preview Primary School", phase: "Primary", latitude: 51.5, longitude: -0.143, distanceMetres: 350,
        grade: { tier: "good", label: "Ofsted: Good", year: "2023/24" }, attainment8: null, selectivity: null, nearAreas: [areaIds[0]] },
    ],
    sources: [{ id: "preview", licence: "Illustrative", attribution: "Preview fixture — not for decisions" }],
    caveats: ["Preview data: illustrative numbers, not for decisions."],
  };
}
