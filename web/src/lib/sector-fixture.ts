/**
 * Demo fixture for the postcode sector contract (GET /api/v1/sectors/{slug},
 * docs/housemetric-gap-2026-10/sector-spec.md): W5 1 as an evidence envelope.
 * Illustrative numbers only (dataMode "demo"); the page labels it as a preview.
 * Unit tests read it as the contract's reference shape.
 */
import type { SectorIndexPoint, SectorListItem, SectorResponse } from "./contracts";

/** [year, nominal, real, sales] rows, as the API sends them one object each. */
function points(rows: readonly (readonly [number, number | null, number | null, number])[]): SectorIndexPoint[] {
  return rows.map(([year, nominal, real, sales]) => ({ year, nominal, real, sales }));
}

function buckets(rows: readonly (readonly [number, number, number])[]) {
  return rows.map(([from, to, count]) => ({ from, to, count }));
}

export const DEMO_SECTOR: SectorResponse = {
  schemaVersion: "sector.v1",
  productReleaseId: "demo",
  dataMode: "demo",
  confidence: "medium",
  value: {
    sector: {
      code: "W5 1", slug: "W5-1", name: "Ealing Broadway", district: "W5",
      borough: { id: "uk:lad:E09000009", name: "Ealing" },
      postcodeCount: 412,
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-0.3112, 51.5163], [-0.3051, 51.5191], [-0.2987, 51.5184], [-0.2949, 51.5152], [-0.2962, 51.5112],
          [-0.3018, 51.5089], [-0.3079, 51.5097], [-0.3121, 51.5128], [-0.3112, 51.5163],
        ]],
      },
    },
    distribution: {
      periodEnd: "2026-07-01",
      sector: {
        sales: 130, p09: 6420, p25: 7310, p50: 8240, p75: 9180, p91: 10350,
        buckets: buckets([
          [5200, 5560, 1], [5560, 5920, 1], [5920, 6280, 1], [6280, 6640, 3], [6640, 7000, 6], [7000, 7360, 10],
          [7360, 7720, 15], [7720, 8080, 19], [8080, 8440, 20], [8440, 8800, 18], [8800, 9160, 14], [9160, 9520, 9],
          [9520, 9880, 5], [9880, 10240, 2], [10240, 10600, 1], [10600, 10960, 1], [10960, 11320, 1], [11320, 11680, 1],
          [11680, 12040, 1], [12040, 12400, 1],
        ]),
      },
      district: {
        sales: 772, p09: 6050, p25: 6980, p50: 7890, p75: 8920, p91: 10120,
        buckets: buckets([
          [4900, 5285, 1], [5285, 5670, 4], [5670, 6055, 10], [6055, 6440, 23], [6440, 6825, 45], [6825, 7210, 74],
          [7210, 7595, 104], [7595, 7980, 123], [7980, 8365, 123], [8365, 8750, 104], [8750, 9135, 74], [9135, 9520, 45],
          [9520, 9905, 23], [9905, 10290, 10], [10290, 10675, 4], [10675, 11060, 1], [11060, 11445, 1], [11445, 11830, 1],
          [11830, 12215, 1], [12215, 12600, 1],
        ]),
      },
    },
    index: {
      base: 2004,
      series: [
        { zone: "sector", points: points([
          [2004, 100.0, 100.0, 40], [2005, 108.1, 105.2, 47], [2006, 115.4, 109.4, 54], [2007, null, null, 8], [2008, 122.0, 109.7, 45],
          [2009, 129.2, 113.1, 52], [2010, 139.8, 119.1, 59], [2011, 148.4, 123.1, 43], [2012, 152.4, 123.1, 50], [2013, 156.8, 123.4, 57],
          [2014, 167.0, 127.9, 41], [2015, 180.6, 134.7, 48], [2016, 190.6, 138.4, 55], [2017, 195.2, 138.0, 62], [2018, 201.8, 139.0, 46],
          [2019, 215.9, 144.8, 53], [2020, 233.2, 152.2, 60], [2021, 244.5, 155.5, 44], [2022, 250.0, 154.8, 51], [2023, 259.9, 156.6, 58],
          [2024, 279.3, 163.9, 42], [2025, 300.8, 171.9, 49],
        ]) },
        { zone: "district", points: points([
          [2004, 100.0, 100.0, 40], [2005, 107.5, 104.7, 47], [2006, 114.2, 108.3, 54], [2007, 117.5, 108.5, 61], [2008, 120.2, 108.1, 45],
          [2009, 126.7, 110.9, 52], [2010, 136.3, 116.2, 59], [2011, 144.1, 119.6, 43], [2012, 147.7, 119.3, 50], [2013, 151.6, 119.3, 57],
          [2014, 160.7, 123.1, 41], [2015, 172.8, 128.9, 48], [2016, 181.7, 131.9, 55], [2017, 185.6, 131.3, 62], [2018, 191.4, 131.8, 46],
          [2019, 203.8, 136.7, 53], [2020, 218.9, 143.0, 60], [2021, 228.8, 145.5, 44], [2022, 233.4, 144.5, 51], [2023, 241.9, 145.8, 58],
          [2024, 258.7, 151.8, 42], [2025, 277.1, 158.4, 49],
        ]) },
        { zone: "borough-house", points: points([
          [2004, 100.0, 100.0, 40], [2005, 107.4, 104.6, 47], [2006, 114.2, 108.2, 54], [2007, 117.9, 108.9, 61], [2008, 121.2, 108.9, 45],
          [2009, 127.9, 112.0, 52], [2010, 137.5, 117.2, 59], [2011, 145.5, 120.7, 43], [2012, 149.7, 121.0, 50], [2013, 154.4, 121.5, 57],
          [2014, 163.7, 125.4, 41], [2015, 175.9, 131.2, 48], [2016, 185.2, 134.5, 55], [2017, 190.2, 134.5, 62], [2018, 196.8, 135.5, 46],
          [2019, 209.6, 140.6, 53], [2020, 225.0, 146.9, 60], [2021, 235.6, 149.8, 44], [2022, 241.6, 149.5, 51], [2023, 251.1, 151.4, 58],
          [2024, 268.5, 157.6, 42], [2025, 287.4, 164.3, 49],
        ]) },
        { zone: "borough-flat", points: points([
          [2004, 100.0, 100.0, 40], [2005, 107.0, 104.2, 47], [2006, 113.0, 107.2, 54], [2007, 115.3, 106.5, 61], [2008, 117.0, 105.2, 45],
          [2009, 122.6, 107.3, 52], [2010, 131.3, 111.9, 59], [2011, 137.9, 114.4, 43], [2012, 140.1, 113.2, 50], [2013, 142.7, 112.2, 57],
          [2014, 150.3, 115.2, 41], [2015, 160.9, 120.0, 48], [2016, 168.0, 122.1, 55], [2017, 170.2, 120.4, 62], [2018, 174.1, 119.9, 46],
          [2019, 184.4, 123.7, 53], [2020, 197.1, 128.7, 60], [2021, 204.6, 130.1, 44], [2022, 206.9, 128.1, 51], [2023, 212.8, 128.3, 58],
          [2024, 226.4, 132.9, 42], [2025, 241.3, 137.9, 49],
        ]) },
      ],
    },
    returns: [
      { years: 1, zone: "sector", nominalPa: 0.077, realPa: 0.0488, nominalTotal: 0.077, realTotal: 0.0488 },
      { years: 5, zone: "sector", nominalPa: 0.0522, realPa: 0.0246, nominalTotal: 0.2899, realTotal: 0.1294 },
      { years: 10, zone: "sector", nominalPa: 0.0523, realPa: 0.0247, nominalTotal: 0.6656, realTotal: 0.2762 },
      { years: 20, zone: "sector", nominalPa: 0.0525, realPa: 0.0249, nominalTotal: 1.7826, realTotal: 0.634 },
      { years: 1, zone: "district", nominalPa: 0.0711, realPa: 0.0435, nominalTotal: 0.0711, realTotal: 0.0435 },
      { years: 5, zone: "district", nominalPa: 0.0483, realPa: 0.0207, nominalTotal: 0.2659, realTotal: 0.1077 },
      { years: 10, zone: "district", nominalPa: 0.0484, realPa: 0.0208, nominalTotal: 0.6036, realTotal: 0.2289 },
      { years: 20, zone: "district", nominalPa: 0.0485, realPa: 0.0209, nominalTotal: 1.5777, realTotal: 0.5129 },
    ],
    nearby: [
      { code: "W5 2", slug: "W5-2", name: "Ealing Common", p25: 7620, p50: 8590, p75: 9710, sales: 164, isSelf: false },
      { code: "W5 1", slug: "W5-1", name: "Ealing Broadway", p25: 7310, p50: 8240, p75: 9180, sales: 130, isSelf: true },
      { code: "W5 3", slug: "W5-3", name: "Hanger Hill", p25: 6890, p50: 7960, p75: 8840, sales: 118, isSelf: false },
      { code: "W5 4", slug: "W5-4", name: "South Ealing", p25: 6750, p50: 7720, p75: 8610, sales: 141, isSelf: false },
      { code: "W13 9", slug: "W13-9", name: "West Ealing", p25: 6120, p50: 7010, p75: 7830, sales: 97, isSelf: false },
      { code: "W5 9", slug: "W5-9", name: null, p25: null, p50: null, p75: null, sales: 12, isSelf: false },
    ],
    streets: [
      { name: "Meadvale Road", sales: 14, medianFloorArea: 118, medianPpm: 8710 },
      { name: "The Mall", sales: 11, medianFloorArea: 64, medianPpm: 8120 },
      { name: "Haven Lane", sales: 9, medianFloorArea: 71, medianPpm: 8390 },
      { name: "Castlebar Road", sales: 8, medianFloorArea: 96, medianPpm: 8560 },
      { name: "Grange Road", sales: 6, medianFloorArea: null, medianPpm: null },
      { name: "Mattock Lane", sales: 5, medianFloorArea: 88, medianPpm: 9020 },
    ],
  },
  evidence: [],
  sources: [
    { sourceId: "hmlr-price-paid", sourceName: "HM Land Registry Price Paid", licence: "OGL-UK-3.0" },
    { sourceId: "epc", sourceName: "EPC floor area", licence: "OGL-UK-3.0" },
    { sourceId: "ons-cpih", sourceName: "ONS CPIH (L522)", licence: "OGL-UK-3.0" },
    { sourceId: "onspd", sourceName: "ONS Postcode Directory", licence: "OGL-UK-3.0" },
  ],
  caveats: ["£/m² uses EPC floor area; sector names are informal"],
};

const DEMO_SECTOR_LIST: SectorListItem[] = DEMO_SECTOR.value.nearby.map(({ code, slug, name }) => ({ code, slug, name }));

/** GET /api/v1/sectors?q= over the demo sectors: code prefix, case- and separator-insensitive, at most 20. */
export function demoSectorList(query: string): SectorListItem[] {
  const needle = query.trim().toUpperCase().replace(/[-\s]+/g, " ");
  if (!needle) return [];
  return DEMO_SECTOR_LIST.filter((item) => item.code.startsWith(needle)).slice(0, 20);
}

/** The demo sector by slug; only W5 1 has a full fixture. */
export function demoSector(slug: string): SectorResponse | null {
  return slug.toUpperCase() === DEMO_SECTOR.value.sector.slug ? DEMO_SECTOR : null;
}
