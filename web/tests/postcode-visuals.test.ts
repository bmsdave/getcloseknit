import assert from "node:assert/strict";
import test from "node:test";

import type { AddressHistory } from "../src/lib/contracts";
import { homesAsHistories, homesAsResults } from "../src/lib/deployment";
import type { AreaMarketResponse } from "../src/lib/market";
import { postcodeFromParam } from "../src/lib/postcode-page";
import {
  compareRows, crimeVersusRegion, dominantType, homeKind, homesMix, londonDecile, marketTrend, postcodeSummary, relativeWords, salesChart, salePoints,
  typicalHeadline,
} from "../src/lib/postcode-visuals";
import type { PostcodeHome, PostcodeHomesResponse } from "../src/lib/property-profile";

// The third figure only marks a sale with a floor area; no per-sale £/m² is carried.
const history = (id: string, sales: [string, number, number | null][]): AddressHistory => ({
  addressId: `uk:addr:${id}` as AddressHistory["addressId"], displayAddress: `Flat ${id}, 1 Road, London, N1 0AA`,
  postcode: "N1 0AA", geographyId: "uk:lsoa:E01002715", saleCount: sales.length, coordinatesPrecision: "postcode",
  transactions: sales.map(([date, nominalPrice, withArea]) => ({
    date, nominalPrice, floorAreaSquareMetres: withArea ? 50 : null,
  })),
  estimateDisclaimer: "", sourceVersion: "src",
});

const home = (fields: Partial<PostcodeHome>): PostcodeHome => ({
  addressId: "uk:addr:000000000001" as PostcodeHome["addressId"], uprn: null, displayAddress: "1 Road, N1 0AA",
  propertyType: null, tenure: null, floorAreaSquareMetres: null, energyRating: null, saleCount: 0, lastSale: null,
  ...fields,
});

test("encoded postcode segments resolve (E3%202DA, E3+2DA) and junk stays a 404", () => {
  assert.equal(postcodeFromParam("E3%202DA"), "E3 2DA");
  assert.equal(postcodeFromParam("e3+2da"), "E3 2DA");
  assert.equal(postcodeFromParam("E3-2DA"), "E3 2DA");
  assert.equal(postcodeFromParam("%E0%A4%A"), null);
  assert.equal(postcodeFromParam("not%20a%20postcode"), null);
});

test("typical figures use recent sales, falling back to every sale (and say so)", () => {
  const histories = [
    history("a", [["2001-03-01", 150_000, null], ["2022-06-01", 500_000, 10_000]]),
    history("b", [["2023-01-10", 520_000, 10_400], ["2024-05-02", 560_000, null]]),
  ];
  const summary = postcodeSummary(histories, [home({}), home({}), home({})], "2026-10-08");
  assert.equal(summary.homes, 3);
  assert.equal(summary.sales, 4);
  assert.deepEqual(summary.typicalPrice, { value: 520_000, basis: "recent", count: 3, fromYear: 2022, toYear: 2024 });
  // No postcode £/m²: no per-sale £/m² while the EPC licence is pending.
  assert.equal("typicalPerSquareMetre" in summary, false);
  assert.equal(summary.lastSale?.date, "2024-05-02");
  assert.equal(summary.firstYear, 2001);
  assert.equal(postcodeSummary([], null).typicalPrice, null);
});

test("a postcode of flats and houses gets a typical price for each; one kind alone gets none", () => {
  const id = (n: string) => `uk:addr:${n}` as PostcodeHome["addressId"];
  const histories = [
    history("f1", [["2023-01-01", 400_000, null], ["2025-01-01", 420_000, null]]),
    history("f2", [["2024-01-01", 450_000, null]]),
    history("h1", [["2022-05-01", 1_100_000, null], ["2024-05-01", 1_200_000, null]]),
    history("h2", [["2025-03-01", 1_000_000, null]]),
  ];
  const homes = [
    home({ addressId: id("f1"), propertyType: "Flat or maisonette" }), home({ addressId: id("f2"), propertyType: "Flat or maisonette" }),
    home({ addressId: id("h1"), propertyType: "Semi-detached" }), home({ addressId: id("h2"), propertyType: "Terraced" }),
  ];
  const summary = postcodeSummary(histories, homes, "2026-10-08");
  assert.deepEqual(summary.byKind.map(({ kind, typical }) => [kind, typical.value]), [["flat", 420_000], ["house", 1_100_000]]);
  assert.equal(salePoints(histories, homes).find((point) => point.price === 1_000_000)?.kind, "house");
  assert.equal(salePoints(histories).every((point) => point.kind === null), true);
  assert.equal(homeKind("Other"), null);
  // Flats only: nothing to split.
  assert.deepEqual(postcodeSummary(histories.slice(0, 2), homes, "2026-10-08").byKind, []);
  // The headline splits a blend; flats alone get one honest figure; the long-run middle is kept for the caption.
  const split = typicalHeadline(summary);
  assert.equal(split.kind, "split");
  assert.equal(summary.blended, true);
  assert.equal(summary.longRun?.count, 6);
  const flats = postcodeSummary(histories.slice(0, 2), homes, "2026-10-08");
  assert.deepEqual(typicalHeadline(flats), { kind: "single", typical: flats.typicalPrice });
  // Houses too thin for a recent figure: only the flats are named, never the blend.
  const thin = postcodeSummary([...histories.slice(0, 2), history("h3", [["2025-06-01", 900_000, null]])],
    [...homes, home({ addressId: id("h3"), propertyType: "Detached" })], "2026-10-08");
  assert.deepEqual(typicalHeadline(thin), { kind: "one-kind", part: thin.kindTypicals[0], missing: "house" });
  assert.equal(typicalHeadline(postcodeSummary([history("f1", [["1999-01-01", 90_000, null]])], homes, "2026-10-08")).kind, "too-few");
  assert.equal(crimeVersusRegion(81, "London"), "Higher than most of London");
  assert.equal(crimeVersusRegion(20, "London"), "Lower than most of London");
  assert.equal(crimeVersusRegion(50, "London"), "About average for London");
  assert.equal(crimeVersusRegion(null, "London"), null);
  // A postcode outside London is ranked within its own region, never "most of London".
  assert.equal(crimeVersusRegion(81, "North West"), "Higher than most of North West");
  assert.equal(crimeVersusRegion(20, null), "Lower than most of its region");
});

test("the homes mix counts types, sizes, ratings and tenure, unknowns kept out of the bars", () => {
  const mix = homesMix([
    home({ propertyType: "Flat or maisonette", tenure: "Leasehold", floorAreaSquareMetres: 45, energyRating: "c" }),
    home({ propertyType: "Flat or maisonette", tenure: "Leasehold", floorAreaSquareMetres: 72, energyRating: "D" }),
    home({ propertyType: "Terraced", tenure: "Freehold", floorAreaSquareMetres: 120 }),
    home({}),
  ]);
  assert.deepEqual(mix.types.map((part) => [part.id, part.value]), [["F", 2], ["T", 1]]);
  assert.equal(mix.typesKnown, 3);
  assert.deepEqual(mix.energy.map((part) => [part.id, part.value]), [["C", 1], ["D", 1]]);
  assert.equal(mix.energyKnown, 2);
  // Empty bands past the largest home are left out; the gap between stays.
  assert.deepEqual(mix.sizes.map((row) => [row.id, row.value]), [["under-50", 1], ["50-69", 0], ["70-99", 1], ["100-149", 1]]);
  assert.equal(mix.medianSize, 72);
  assert.deepEqual(mix.tenure.map((part) => [part.id, part.value]), [["Freehold", 1], ["Leasehold", 2]]);
  assert.equal(dominantType([home({ propertyType: "Flat or maisonette" }), home({ propertyType: "Flat or maisonette" }),
    home({ propertyType: "Flat or maisonette" }), home({ propertyType: "Terraced" })]), "F");
  assert.equal(dominantType([home({ propertyType: "Flat or maisonette" }), home({ propertyType: "Terraced" })]), null);
});

test("area trend lines prefer the like-for-like type and sit mid-window", () => {
  const points = (values: (number | null)[]) => values.map((value, index) => ({
    windowEnd: `${2020 + index}-07`, sales: 10, medianPrice: value, medianPricePerSquareMetre: value === null ? null : value / 50,
  }));
  const market = {
    available: true,
    trend: [
      { propertyType: "all", points: points([400_000, 410_000, 420_000]) },
      { propertyType: "F", points: points([300_000, null, 320_000]) },
    ],
  } as unknown as AreaMarketResponse;
  const flats = marketTrend(market, "price", "F", "Islington 019 median", "area");
  assert.equal(flats?.label, "Islington 019 median"); // flats have only two points: falls back to all homes
  assert.equal(flats?.points[0].time, 2020);
  assert.equal(flats?.points[0].value, 400_000);
  assert.equal(marketTrend(market, "per-square-metre", null, "x", "k")?.points[2].value, 8_400);
  assert.equal(marketTrend(null, "price", null, "x", "k"), null);
});

test("the sales chart puts every sale on one time and value axis with the lines", () => {
  const sales = salePoints([history("a", [["2010-01-01", 200_000, null], ["2020-01-01", 400_000, 8_000]])]);
  const box = { width: 300, height: 200, left: 40, right: 10, top: 10, bottom: 20 };
  const chart = salesChart(sales, [{ key: "area", label: "Area", points: [{ time: 2015, value: 300_000 }] }], box)!;
  assert.equal(chart.dots.length, 2);
  assert.equal(chart.dots[0].x, 40);
  assert.equal(chart.dots[1].x, 290);
  assert.ok(chart.dots[0].y > chart.dots[1].y, "the dearer sale sits higher");
  assert.equal(chart.lines[0].path, "M165,95");
  assert.deepEqual(chart.xTicks.map((tick) => tick.year), [2010, 2012, 2014, 2016, 2018, 2020]);
  assert.equal(salesChart([], [], box), null);
});

test("comparison rows drop missing figures; words and deciles stay plain", () => {
  assert.deepEqual(compareRows([
    { id: "a", label: "A", value: 10 }, { id: "b", label: "B", value: null }, { id: "c", label: "C", value: 0 },
  ], String).map((row) => row.id), ["a"]);
  assert.equal(relativeWords(112, 100), "12% above");
  assert.equal(relativeWords(92, 100), "8% below");
  assert.equal(relativeWords(101, 100), "in line with");
  assert.equal(londonDecile(96), 10);
  assert.equal(londonDecile(1), 1);
  assert.equal(londonDecile(null), null);
});

test("real-mode homes list the postcode's sold addresses for the page plan", () => {
  const response = {
    schemaVersion: "postcode-homes.v1", productReleaseId: "rel", postcode: "N1 0AA", geographyId: "uk:lsoa:E01002715",
    homes: [home({ saleCount: 2, displayAddress: "Flat 1, N1 0AA" }), home({ saleCount: 0 })], disclaimer: "",
  } as PostcodeHomesResponse;
  const results = homesAsResults(response);
  assert.equal(results.length, 1);
  assert.equal(results[0].geographyId, "uk:lsoa:E01002715");
  assert.equal(results[0].label, "Flat 1, N1 0AA");
  assert.deepEqual(homesAsResults({ ...response, geographyId: null }), []);
  // One history call per address: at most 25, the homes sold most often, in the listed order.
  const many = Array.from({ length: 30 }, (_, index) => home({ saleCount: index === 29 ? 9 : 1, displayAddress: `${index} Road` }));
  const capped = homesAsResults({ ...response, homes: many });
  assert.equal(capped.length, 25);
  assert.equal(capped.at(-1)?.label, "29 Road");
});

test("homes with their sales become the page's address histories in one call, every sold home kept", () => {
  const sale = { date: "2019-05-06", nominalPrice: 420000, floorAreaSquareMetres: 42, pricePerSquareMetre: 10000 };
  const response = {
    schemaVersion: "postcode-homes.v1", productReleaseId: "rel", postcode: "E3 2DA", geographyId: "uk:lsoa:E01004229",
    disclaimer: "", salesDisclaimer: "Recorded achieved sale prices, not valuations.",
    homes: [
      ...Array.from({ length: 30 }, (_, index) => home({ saleCount: 1, displayAddress: `${index} Road`, sales: [sale] })),
      home({ saleCount: 0, sales: [] }),
    ],
  } as PostcodeHomesResponse;
  const histories = homesAsHistories(response)!;
  assert.equal(histories.length, 30); // no 25-address cap: nothing is fetched per address
  assert.deepEqual(histories[0].transactions, [sale]);
  assert.equal(histories[0].postcode, "E3 2DA");
  assert.equal(histories[0].estimateDisclaimer, "Recorded achieved sale prices, not valuations.");
  // An API that leaves the sales out: fall back to one history call per address.
  assert.equal(homesAsHistories({ ...response, salesDisclaimer: undefined }), null);
  assert.equal(homesAsHistories({ ...response, homes: [home({ saleCount: 2 })] }), null);
});

test("living-here flood tile: rivers and sea headline, surface water as a share, never a bare 'surface water high'", async () => {
  const { livingTiles } = await import("../src/components/postcode-visuals");
  const bands = (medium: number, high: number, highestBand: "very-low" | "high") =>
    ({ shares: { "very-low": 1 - medium - high, low: 0, medium, high }, highestBand });
  const flood = {
    schemaVersion: "area-flood.v1", productReleaseId: "r", geographyId: "uk:lsoa:E01002715", available: true,
    riversSea: bands(0, 0, "very-low"), surfaceWater: bands(0.02, 0.04, "high"), dwelling: null,
    sourceVersion: null, attribution: null, caveats: [],
  };
  const tiles = livingTiles({
    areaHref: "/area/lsoa/E01002715", areaName: "Islington 019E", stationWalk: null, places: null, profile: null,
    flood: flood as never, foodHygiene: null, region: "London",
  });
  const tile = tiles.find((entry) => entry.id === "flood")!;
  assert.equal(tile.label, "Area flood · rivers, sea");
  // The headline is the worse of the two sources (lib/flood-risk floodHeadline).
  assert.equal(tile.value, "Very low, some surface-water risk");
  assert.equal(tile.detail, "Surface water: 6% of land, up to high");
});

test("flood tile leads with the homes' own bands, not the area's floodplain (W5 1LR)", async () => {
  const { livingTiles } = await import("../src/components/postcode-visuals");
  // E01001209 holds Pitshanger Park's floodplain: 17% of its land high from rivers.
  const area = {
    schemaVersion: "area-flood.v1", productReleaseId: "r", geographyId: "uk:lsoa:E01001209", available: true,
    riversSea: { shares: { "very-low": 0.8, low: 0.02, medium: 0.01, high: 0.17 }, highestBand: "high" },
    surfaceWater: { shares: { "very-low": 0.78, low: 0.13, medium: 0.05, high: 0.04 }, highestBand: "high" },
    dwelling: null, sourceVersion: null, attribution: null, caveats: [],
  };
  const veryLow = { riversSea: "very-low", surfaceWater: "very-low" } as const;
  const facts = (homes: PostcodeHome[]) => ({
    areaHref: "/area/lsoa/E01001209", areaName: "Ealing", stationWalk: null, places: null, profile: null,
    flood: area as never, homes, foodHygiene: null, region: "London",
  });
  const flood = (homes: PostcodeHome[]) => livingTiles(facts(homes)).find((entry) => entry.id === "flood")!;
  const tile = flood([home({ flood: veryLow }), home({ flood: veryLow }), home({ flood: veryLow }), home({ flood: veryLow }), home({ flood: null })]);
  assert.deepEqual([tile.label, tile.value, tile.detail], ["Flood risk · rivers, sea", "Very low", "4 of 5 homes · surface water very low"]);
  // The worst home leads; every home banded reads "All".
  const mixed = flood([home({ flood: veryLow }), home({ flood: { riversSea: "medium", surfaceWater: "low" } })]);
  assert.deepEqual([mixed.value, mixed.detail], ["Medium", "All 2 homes · surface water low"]);
  // No home has bands (no UPRNs, an older API): the area's land, labelled as the area.
  const fallback = flood([home({})]);
  assert.deepEqual([fallback.label, fallback.value], ["Area flood · rivers, sea", "High"]);
});

test("a postcode outside London compares with its own region, never with London", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { buildIndex } = await import("../src/lib/area-pages");
  const { regionFacts } = await import("../src/app/postcode/[code]/area-context");
  const { PostcodeComparison } = await import("../src/components/postcode-visuals");
  const area = (geographyId: string, name: string, carrier: "borough" | "lsoa", parentId: string | null) =>
    ({ geographyId, name, carrier, parentId, regionCode: "E12000002", schools: null }) as never;
  // loadAreaPages(id) loads the area's region: a Manchester neighbourhood's index is the North West's.
  const index = buildIndex({
    mode: "real", scope: { code: "E12000002", name: "North West" },
    areas: [area("uk:lad:E08000003", "Manchester", "borough", null), area("uk:lsoa:E01005000", "Manchester 001A", "lsoa", "uk:lad:E08000003")],
    values: {}, crime: { msoa: [], borough: [] }, periods: {},
  } as never);
  assert.equal(regionFacts(index)?.name, "North West");
  assert.equal(regionFacts(null), null);
  const html = renderToStaticMarkup(createElement(PostcodeComparison, { figures: {
    postcode: "M1 1AA", postcodePrice: null, period: null, marketWindow: null,
    area: { name: "Manchester 001A", perSquareMetre: 3000, medianPrice: null, marketName: null },
    borough: { name: "Manchester", perSquareMetre: 2800, medianPrice: null },
    region: { name: "North West", perSquareMetre: 2200 },
  } }));
  assert.match(html, /North West/);
  assert.doesNotMatch(html, /London/);
});
