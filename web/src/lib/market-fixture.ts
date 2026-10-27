/**
 * Demo local market for the three preview areas (and their MSOAs and
 * boroughs), and the street-level demo home's area in Ealing. Made-up but plausible numbers: North London preview has too few
 * sales of its own, so it shows the widened (MSOA) case.
 */
import { carrierOfId, type GeographyId } from "./contracts";
import {
  PROPERTY_TYPE_CODES,
  type AreaMarketResponse,
  type MarketBasis,
  type MarketTrendSeries,
  type MarketTypeStats,
  type PropertyTypeCode,
  type RecentSale,
  type RecentSalesResponse,
  type RecentSalesSort,
} from "./market";
import type { AreaSinceResponse } from "./saved-since";
import { fixtureStandouts } from "./standouts-fixture";

const SOURCE = "preview-market-2026-07";
const LATEST = { year: 2026, month: 7 };

interface DemoArea {
  name: string;
  /** Latest-12-month sales and median price per type (absent: no sales). */
  types: Partial<Record<PropertyTypeCode, { sales: number; median: number; ppm: number | null }>>;
  /** Yearly growth used to walk the trend back ten years. */
  growth: number;
}

const AREAS: Record<string, DemoArea> = {
  "uk:lsoa:E01000001": { name: "Westminster preview", growth: 0.035, types: {
    T: { sales: 4, median: 1_450_000, ppm: 13_800 }, F: { sales: 21, median: 780_000, ppm: 12_400 },
  } },
  "uk:lsoa:E01000002": { name: "North London preview", growth: 0.04, types: {
    T: { sales: 3, median: 760_000, ppm: 8_100 }, F: { sales: 3, median: 455_000, ppm: 7_900 },
  } },
  "uk:lsoa:E01000003": { name: "South Bank preview", growth: 0.03, types: {
    T: { sales: 6, median: 1_050_000, ppm: 10_900 }, F: { sales: 26, median: 590_000, ppm: 9_800 }, O: { sales: 1, median: 400_000, ppm: null },
  } },
  "uk:msoa:E02000001": { name: "Westminster preview MSOA", growth: 0.035, types: {
    S: { sales: 6, median: 1_900_000, ppm: 14_000 }, T: { sales: 19, median: 1_500_000, ppm: 13_600 }, F: { sales: 88, median: 760_000, ppm: 12_300 },
  } },
  "uk:msoa:E02000002": { name: "North London preview MSOA", growth: 0.04, types: {
    D: { sales: 2, median: 1_650_000, ppm: null }, S: { sales: 9, median: 1_050_000, ppm: 8_400 },
    T: { sales: 24, median: 790_000, ppm: 8_200 }, F: { sales: 41, median: 470_000, ppm: 7_800 },
  } },
  "uk:msoa:E02000003": { name: "South Bank preview MSOA", growth: 0.03, types: {
    T: { sales: 22, median: 1_020_000, ppm: 10_700 }, F: { sales: 97, median: 600_000, ppm: 9_700 },
  } },
};
for (const index of [1, 2, 3]) {
  const msoa = AREAS[`uk:msoa:E0200000${index}`];
  AREAS[`uk:lad:E0900000${index}`] = {
    name: msoa.name.replace("MSOA", "borough"), growth: msoa.growth,
    types: Object.fromEntries(Object.entries(msoa.types).map(([code, stats]) => [code, { ...stats, sales: stats.sales * 14 }])),
  };
}

const PARENT: Record<string, string> = {
  "uk:lsoa:E01000001": "uk:msoa:E02000001", "uk:lsoa:E01000002": "uk:msoa:E02000002", "uk:lsoa:E01000003": "uk:msoa:E02000003",
  "uk:msoa:E02000001": "uk:lad:E09000001", "uk:msoa:E02000002": "uk:lad:E09000002", "uk:msoa:E02000003": "uk:lad:E09000003",
};
const MINIMUM_SALES = 10;

function totalSales(area: DemoArea): number {
  return Object.values(area.types).reduce((sum, stats) => sum + stats.sales, 0);
}

function basisFor(id: GeographyId): MarketBasis | null {
  let current: string | undefined = id;
  while (current && AREAS[current]) {
    if (totalSales(AREAS[current]) >= MINIMUM_SALES || !PARENT[current]) {
      return { geographyId: current as GeographyId, name: AREAS[current].name, carrier: carrierOfId(current), widened: current !== id, minimumSales: MINIMUM_SALES };
    }
    current = PARENT[current];
  }
  return null;
}

function stats(type: MarketTypeStats["propertyType"], sales: number, median: number | null, ppm: number | null): MarketTypeStats {
  const has = (minimum: number) => median !== null && sales >= minimum;
  const at = (factor: number) => has(5) ? Math.round((median! * factor) / 500) * 500 : null;
  return {
    propertyType: type, sales,
    medianPrice: has(3) ? median : null,
    p5: at(0.55), p25: at(0.8), p75: at(1.3), p95: at(2.1),
    minPrice: has(3) ? Math.round(median! * 0.45) : null, maxPrice: has(3) ? Math.round(median! * 2.6) : null,
    pricePerSquareMetreSales: ppm === null ? 0 : Math.round(sales * 0.7),
    medianPricePerSquareMetre: ppm !== null && sales * 0.7 >= 3 ? ppm : null,
  };
}

function windowEnd(back: number): string {
  return `${LATEST.year - back}-${String(LATEST.month).padStart(2, "0")}`;
}

function allStats(area: DemoArea): MarketTypeStats {
  const entries = Object.values(area.types);
  const sales = totalSales(area);
  const median = entries.reduce((sum, entry) => sum + entry.median * entry.sales, 0) / Math.max(1, sales);
  const withPpm = entries.filter((entry) => entry.ppm !== null);
  const ppm = withPpm.length ? Math.round(withPpm.reduce((sum, entry) => sum + entry.ppm!, 0) / withPpm.length) : null;
  return stats("all", sales, Math.round(median / 500) * 500, ppm);
}

function trend(area: DemoArea): MarketTrendSeries[] {
  const series = (type: MarketTrendSeries["propertyType"], latest: MarketTypeStats): MarketTrendSeries => ({
    propertyType: type,
    points: Array.from({ length: 11 }, (_, offset) => {
      const back = 10 - offset;
      // A small dip four years back keeps the demo line from being a straight ramp.
      const factor = (1 + area.growth) ** -back * (back === 4 ? 1.04 : 1);
      const thin = latest.sales < 3 || (type === "O");
      return {
        windowEnd: windowEnd(back),
        sales: latest.sales,
        medianPrice: latest.medianPrice === null || thin ? null : Math.round((latest.medianPrice * factor) / 500) * 500,
        medianPricePerSquareMetre: latest.medianPricePerSquareMetre === null || thin ? null : Math.round(latest.medianPricePerSquareMetre * factor),
      };
    }),
  });
  return [
    series("all", allStats(area)),
    ...PROPERTY_TYPE_CODES.map((code) => series(code, typeStats(area, code))),
  ];
}

function typeStats(area: DemoArea, code: PropertyTypeCode): MarketTypeStats {
  const entry = area.types[code];
  return entry ? stats(code, entry.sales, entry.median, entry.ppm) : stats(code, 0, null, null);
}

export function fixtureAreaMarket(id: GeographyId): AreaMarketResponse | null {
  const basis = basisFor(id);
  if (!basis) return null;
  const area = AREAS[basis.geographyId];
  return {
    schemaVersion: "area-market-by-type.v1",
    geographyId: id,
    name: AREAS[id]?.name ?? null,
    available: true,
    basis,
    window: { start: `${LATEST.year - 1}-08`, end: windowEnd(0) },
    summary: allStats(area),
    byType: PROPERTY_TYPE_CODES.map((code) => typeStats(area, code)),
    trend: trend(area),
    sourceVersion: SOURCE,
    attribution: "Demo data shaped like HM Land Registry Price Paid. Not real sales.",
    caveats: ["Demo data: made-up sales to show how the section works."],
  };
}

const STREETS = ["Sample Road", "Preview Street", "Demo Gardens", "Example Mews", "Model Avenue"];

function demoSales(basis: MarketBasis): RecentSale[] {
  const area = AREAS[basis.geographyId];
  const types = PROPERTY_TYPE_CODES.filter((code) => area.types[code]);
  const count = Math.min(45, Math.round(totalSales(area) * 1.5));
  return Array.from({ length: count }, (_, index) => {
    const type = types[index % types.length];
    const median = area.types[type]!.median;
    const month = 7 - (index % 18);
    const year = month > 0 ? 2026 : 2025;
    return {
      transactionId: `preview-${basis.geographyId}-${index}`,
      date: `${year}-${String(month > 0 ? month : month + 12).padStart(2, "0")}-${String(1 + ((index * 7) % 27)).padStart(2, "0")}`,
      address: `${type === "F" ? `Flat ${index + 1}, ` : ""}${10 + index} ${STREETS[index % STREETS.length]}, London`,
      postcode: "SW1A 1AA",
      propertyType: type,
      tenure: type === "F" ? "L" : "F",
      newBuild: index % 11 === 0,
      price: Math.round((median * (0.8 + ((index * 37) % 50) / 100)) / 250) * 250,
      distanceMetres: 40 + index * 23,
    };
  });
}

export function fixtureRecentSales(id: GeographyId, page: number, pageSize: number, sort: RecentSalesSort): RecentSalesResponse | null {
  const basis = basisFor(id);
  if (!basis) return null;
  const all = demoSales(basis).sort((a, b) => sort === "newest"
    ? b.date.localeCompare(a.date) || (a.distanceMetres ?? 0) - (b.distanceMetres ?? 0)
    : (a.distanceMetres ?? 0) - (b.distanceMetres ?? 0) || b.date.localeCompare(a.date));
  return {
    schemaVersion: "area-recent-sales.v1",
    geographyId: id,
    basis,
    months: 18,
    since: "2025-02-01",
    until: "2026-07-31",
    sort,
    page,
    pageSize,
    total: all.length,
    sales: all.slice((page - 1) * pageSize, page * pageSize),
    sourceVersion: SOURCE,
  };
}

/** A saved area's "since" answer from the same demo sales and summary as the market section. */
export function fixtureAreaSince(id: GeographyId, date: string): AreaSinceResponse | null {
  const basis = basisFor(id);
  if (!basis) return null;
  const sales = demoSales(basis);
  // The area's own Price tile (what Saved shows beside the line), not the widened market median.
  const tile = fixtureStandouts(id)?.tiles.find((entry) => entry.id === "price" && entry.available) ?? null;
  return {
    schemaVersion: "area-since.v1",
    geographyId: id,
    date,
    basis,
    months: 18,
    newSales: sales.filter((sale) => sale.date > date).length,
    newestSale: sales.reduce<string | null>((newest, sale) => (newest === null || sale.date > newest ? sale.date : newest), null),
    pricePerSquareMetre: { median: tile?.value ?? null, windowEnd: tile?.period ?? null, sales: null },
    sourceVersion: SOURCE,
    attribution: "Demo data shaped like HM Land Registry Price Paid. Not real sales.",
    caveats: ["Demo data: made-up sales to show how the section works."],
  };
}
