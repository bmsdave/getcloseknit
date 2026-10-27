import assert from "node:assert/strict";
import test from "node:test";

import {
  areaFacts,
  areaPath,
  breadcrumb,
  buildFaq,
  buildIndex,
  buildRanking,
  childrenOf,
  descendants,
  faqJsonLd,
  LONDON,
  median,
  pooledCrime,
  rankingBySlug,
  rankingForLayer,
  rankingPreview,
  RANKING_TILES,
  BOROUGH_COLUMNS,
  boroughSortParam,
  boroughTable,
  sortBoroughRows,
  RANKING_GROUPS,
  RANKINGS,
  rankingsByGroup,
  type MetricRanking,
  type LensRanking,
  type CountRanking,
  type SchoolRanking,
  type SchoolRankingResponse,
  availableRankings,
  buildSchoolRanking,
  schoolColumn,
  schoolRankingScope,
  countExplainer,
  lensExplainer,
  lensSources,
  type AreaPagesData,
  type HierarchyArea,
  basisNote,
  countOf,
  rankingScope,
} from "../src/lib/area-pages";
import { cacheTtlMs, demoAreaPagesData, loadRealAreaPages } from "../src/lib/area-pages-data";
import { carrierOfId, type GeographyId, type MetricId, type ValuePackEntry } from "../src/lib/contracts";
import { HELP } from "../src/lib/help-texts";
import { rankingTakeaway } from "../src/app/rankings/[slug]/ranking-view";
import { sitemapPaths } from "../src/lib/seo";

function area(geographyId: GeographyId, name: string, parentId: GeographyId | null, schools: HierarchyArea["schools"] = null): HierarchyArea {
  return { geographyId, name, carrier: carrierOfId(geographyId), parentId, schools };
}

function entry(geographyId: GeographyId, metricId: MetricId, value: number | null, sampleCount: number | null = null): ValuePackEntry {
  return {
    geographyId, name: geographyId, metricId, period: "2026-06", value, regionPercentile: null, countryPercentile: null,
    sampleCount, quality: "observed", sourceVersion: "src-test", carrier: carrierOfId(geographyId),
  };
}

// Two boroughs: A (two MSOAs, three LSOAs) and B (one MSOA, one LSOA, no income).
function sample(): AreaPagesData {
  return {
    mode: "real",
    areas: [
      area("uk:lad:E09000001", "Alpha", null, { primary: 3, secondary: 1 }),
      area("uk:lad:E09000002", "Beta", null, { primary: 1, secondary: 0 }),
      area("uk:msoa:E02000001", "Alpha 001", "uk:lad:E09000001", { primary: 2, secondary: 1 }),
      area("uk:msoa:E02000002", "Alpha 002", "uk:lad:E09000001", { primary: 1, secondary: 0 }),
      area("uk:msoa:E02000003", "Beta 001", "uk:lad:E09000002", { primary: 1, secondary: 0 }),
      area("uk:lsoa:E01000001", "Alpha 001A", "uk:msoa:E02000001"),
      area("uk:lsoa:E01000002", "Alpha 001B", "uk:msoa:E02000001"),
      area("uk:lsoa:E01000003", "Alpha 002A", "uk:msoa:E02000002"),
      area("uk:lsoa:E01000004", "Beta 001A", "uk:msoa:E02000003"),
    ],
    values: {
      "price-per-square-metre": [
        entry("uk:lsoa:E01000001", "price-per-square-metre", 10_000), entry("uk:lsoa:E01000002", "price-per-square-metre", 12_000),
        entry("uk:lsoa:E01000003", "price-per-square-metre", 8_000), entry("uk:lsoa:E01000004", "price-per-square-metre", 5_000),
      ],
      deprivation: [
        entry("uk:lsoa:E01000001", "deprivation", 1), entry("uk:lsoa:E01000002", "deprivation", 9),
        entry("uk:lsoa:E01000003", "deprivation", 5), entry("uk:lsoa:E01000004", "deprivation", 2),
      ],
      income: [entry("uk:msoa:E02000001", "income", 80_000), entry("uk:msoa:E02000002", "income", 40_000)],
      "social-renting": [],
      crime: [entry("uk:lsoa:E01000001", "crime", 90)],
    },
    crime: {
      msoa: [entry("uk:msoa:E02000001", "crime", 70), entry("uk:msoa:E02000002", "crime", 30), entry("uk:msoa:E02000003", "crime", 50)],
      borough: [entry("uk:lad:E09000001", "crime", 100, 1000), entry("uk:lad:E09000002", "crime", 50, 1000)],
    },
    periods: { "price-per-square-metre": "2026-06", crime: "2026-08", deprivation: "2025-01", income: "2023-01" },
  };
}

test("the tree links London → borough → MSOA → LSOA and builds breadcrumbs and paths", () => {
  const index = buildIndex(sample());
  assert.deepEqual(childrenOf(index, LONDON).map((a) => a.name), ["Alpha", "Beta"]);
  assert.deepEqual(childrenOf(index, "uk:lad:E09000001").map((a) => a.name), ["Alpha 001", "Alpha 002"]);
  assert.equal(descendants(index, LONDON, "lsoa").length, 4);
  assert.deepEqual(breadcrumb(index, "uk:lsoa:E01000002").map((a) => a.name), ["Alpha", "Alpha 001", "Alpha 001B"]);
  assert.equal(areaPath(LONDON), "/area/london");
  assert.equal(areaPath({ geographyId: "uk:msoa:E02000003" }), "/area/msoa/E02000003");
});

test("a borough uses its own crime, the middle of its neighbourhoods' prices and its MSOAs' incomes", () => {
  const facts = areaFacts(buildIndex(sample()), "uk:lad:E09000001");
  assert.ok(facts);
  assert.deepEqual(facts.price, { value: 10_000, basis: "middle", count: 3, period: "2026-06" });
  assert.deepEqual(facts.crime, { value: 100, basis: "own", count: 1, period: "2026-06" });
  assert.deepEqual(facts.income, { value: 60_000, basis: "middle", count: 2, period: "2023-01" });
  assert.equal(facts.deprivation?.mostDeprived, 1 / 3);
  assert.equal(facts.deprivation?.leastDeprived, 1 / 3);
  assert.deepEqual(facts.schools, { primary: 3, secondary: 1 });
  assert.equal(facts.neighbourhoods, 3);
});

test("missing data stays unknown, never zero", () => {
  const index = buildIndex(sample());
  const beta = areaFacts(index, "uk:msoa:E02000003");
  assert.equal(beta?.income, null);
  assert.equal(beta?.socialRenting, null);
  assert.equal(beta?.noise, null);
  assert.equal(areaFacts(index, "uk:msoa:E02999999"), null);
  const data = sample();
  data.areas = data.areas.map((candidate) => ({ ...candidate, schools: null }));
  assert.equal(areaFacts(buildIndex(data), LONDON)?.schools, null);
  const faq = buildFaq(beta!, null);
  assert.equal(faq.length, 4);
  assert.match(faq.find((item) => item.id === "safety")!.answer, /50\.0 crimes/);
});

test("the area profile's own figure and noise win over roll-ups", () => {
  const index = buildIndex(sample());
  const facts = areaFacts(index, "uk:msoa:E02000001", {
    schemaVersion: "area-profile.v1", geographyId: "uk:msoa:E02000001", name: "Alpha 001",
    metrics: [entry("uk:msoa:E02000001", "crime", 72.5)], schools: null, noise: { available: true, any55Share: 0.4 },
  });
  assert.equal(facts?.crime?.value, 72.5);
  assert.equal(facts?.noise, 0.4);
});

test("London's crime pools every borough's crimes over its residents", () => {
  const index = buildIndex(sample());
  // 1,000 crimes at 100/1k = 10,000 people; 1,000 at 50/1k = 20,000 people → 2,000 / 30,000.
  assert.equal(Math.round(areaFacts(index, LONDON)!.crime!.value * 10) / 10, 66.7);
  assert.equal(pooledCrime([entry("uk:lad:E09000001", "crime", 100, null)]), null);
  assert.equal(median([3, 1, 2, 10]), 2.5);
  assert.equal(median([]), null);
});

test("the FAQ compares with London, rounds a 70 m² home and serialises safely as JSON-LD", () => {
  const index = buildIndex(sample());
  const london = areaFacts(index, LONDON);
  const faq = buildFaq(areaFacts(index, "uk:lad:E09000001")!, london);
  const price = faq.find((item) => item.id === "price")!.answer;
  assert.match(price, /£10,000 per m²/);
  assert.match(price, /higher than London as a whole \(£9,000 per m²\)/);
  assert.match(price, /roughly £700,000/);
  assert.match(faq.find((item) => item.id === "schools")!.answer, /3 state primary and 1 state secondary/);
  assert.match(faq.find((item) => item.id === "deprivation")!.answer, /33% of Alpha's 3 neighbourhoods/);
  const json = faqJsonLd([{ id: "safety", question: "Is <b> safe?", answer: "</script>" }]);
  assert.ok(!json.includes("<"));
  const parsed = JSON.parse(json);
  assert.equal(parsed["@type"], "FAQPage");
  assert.equal(parsed.mainEntity[0].acceptedAnswer.text, "</script>");
});

/** A metric ranking by slug; fails the test when the slug is unknown or of another kind. */
function lensRanking(slug: string): LensRanking {
  const ranking = rankingBySlug(slug);
  assert.equal(ranking?.kind, "lens", `${slug} is a lens ranking`);
  return ranking as LensRanking;
}

const LENS_SLUGS = ["most-gyms", "most-places-for-families", "most-nightlife",
  "most-late-night-food", "most-cultural-venues", "widest-food-variety", "most-coffee-shops", "closest-to-a-market",
  "most-cycling-facilities", "most-ev-charge-points", "most-dog-friendly-places", "most-coworking-spaces", "most-universities"];

function metricRanking(slug: string): MetricRanking {
  const ranking = rankingBySlug(slug);
  assert.equal(ranking?.kind, "metric", `${slug} is a metric ranking`);
  return ranking as MetricRanking;
}

test("rankings fall into named groups, in order, each slug once", () => {
  assert.deepEqual(RANKING_GROUPS, ["Cost", "Getting around", "Safety", "Schools", "Going out", "Everyday life", "Homes & area"]);
  for (const ranking of RANKINGS) assert.ok(RANKING_GROUPS.includes(ranking.group), `${ranking.slug} has a known group`);
  assert.equal(new Set(RANKINGS.map((ranking) => ranking.slug)).size, RANKINGS.length);
  const grouped = rankingsByGroup();
  // Empty groups are left out; every ranking appears exactly once, under its own group.
  assert.deepEqual(grouped.map((entry) => entry.group), ["Cost", "Getting around", "Safety", "Schools", "Going out", "Everyday life", "Homes & area"]);
  assert.equal(grouped.flatMap((entry) => entry.rankings).length, RANKINGS.length);
  for (const entry of grouped) for (const ranking of entry.rankings) assert.equal(ranking.group, entry.group);
  assert.deepEqual(grouped.find((entry) => entry.group === "Safety")!.rankings.map((ranking) => ranking.slug), ["highest-crime", "lowest-crime"]);
});

// Boroughs side by side are one table on /area/london, not rankings; the Census is never ranked.
test("no ranking is of boroughs or of a Census layer", () => {
  for (const ranking of RANKINGS) {
    if ("level" in ranking) assert.equal(ranking.level, "msoa", ranking.slug);
    if (ranking.kind === "metric") assert.ok(!ranking.metric.startsWith("census-"), ranking.slug);
  }
});

// Owner decision 2026-10-18: household income and social renting rank like any metric, said neutrally.
test("income and social renting rank under Homes & area, highest or most first", () => {
  const pairs = RANKINGS.filter((ranking) => ranking.kind === "metric" && ["income", "social-renting"].includes(ranking.metric));
  assert.deepEqual(pairs.map((ranking) => [ranking.slug, ranking.order, ranking.group]), [
    ["highest-income", "desc", "Homes & area"], ["lowest-income", "asc", "Homes & area"],
    ["most-social-renting", "desc", "Homes & area"], ["least-social-renting", "asc", "Homes & area"]]);
  for (const ranking of pairs) assert.doesNotMatch(`${ranking.title} ${ranking.lead}`, /better|worse|good|bad|poor|rich|deprived/i, ranking.slug);
  assert.equal(rankingForLayer("income"), "/rankings/highest-income");
  assert.equal(rankingForLayer("social-renting"), "/rankings/most-social-renting");
  assert.deepEqual(RANKING_TILES.filter((tile) => ["income", "social-renting"].includes(tile.id)).map((tile) => [tile.group, tile.pair]),
    [["Homes & area", ["Highest", "Lowest"]], ["Homes & area", ["Most", "Least"]]]);

  // Income is each MSOA's own figure; Beta 001 has none, so it is left out, never ranked as zero.
  const data = sample();
  data.values["social-renting"] = [entry("uk:lsoa:E01000001", "social-renting", 10), entry("uk:lsoa:E01000002", "social-renting", 30),
    entry("uk:lsoa:E01000003", "social-renting", 50)];
  const index = buildIndex(data);
  const rows = (slug: string) => buildRanking(index, rankingBySlug(slug) as MetricRanking).rows.map((row) => [row.area.name, row.display]);
  assert.deepEqual(rows("highest-income"), [["Alpha 001", "£80,000 a year"], ["Alpha 002", "£40,000 a year"]]);
  assert.deepEqual(rows("lowest-income").map(([name]) => name), ["Alpha 002", "Alpha 001"]);
  assert.deepEqual(rows("most-social-renting").map(([name]) => name), ["Alpha 002", "Alpha 001"]);
  assert.deepEqual(rows("least-social-renting").map(([name]) => name), ["Alpha 001", "Alpha 002"]);
});

// Owner decision 2026-10-17: deprivation (the official index of the area) ranks like any metric.
test("deprivation ranks under Homes & area, least deprived first, by its neighbourhoods' average decile", () => {
  const deprivation = RANKINGS.filter((ranking) => ranking.kind === "metric" && ranking.metric === "deprivation");
  assert.deepEqual(deprivation.map((ranking) => [ranking.slug, ranking.order, ranking.group]),
    [["least-deprived", "desc", "Homes & area"], ["most-deprived", "asc", "Homes & area"]]);
  assert.equal(rankingForLayer("deprivation"), "/rankings/least-deprived");
  const tile = RANKING_TILES.find((entry) => entry.id === "deprivation");
  assert.deepEqual([tile?.group, tile?.pair, tile?.slugs], ["Homes & area", ["Least", "Most"], [["least-deprived"], ["most-deprived"]]]);

  // Alpha 001 averages deciles 1 and 9; Alpha 002 has one at 5; Beta 001 one at 2. Equal figures share a rank.
  const index = buildIndex(sample());
  const rows = (slug: string) => buildRanking(index, rankingBySlug(slug) as MetricRanking).rows
    .map((row) => [row.rank, row.area.name, row.display, row.detail]);
  assert.deepEqual(rows("least-deprived"), [
    [1, "Alpha 001", "5.0", "average of 2 neighbourhoods"], [1, "Alpha 002", "5.0", "average of 1 neighbourhood"],
    [3, "Beta 001", "2.0", "average of 1 neighbourhood"]]);
  assert.deepEqual(rows("most-deprived").map(([rank, name]) => [rank, name]), [[1, "Beta 001"], [2, "Alpha 001"], [2, "Alpha 002"]]);
});

// v3 Fix 15: mirror pairs and home types merge into one tile; every ranking sits in exactly one tile.
test("the rankings index tiles cover every ranking once, in its own group", () => {
  const slugs = RANKING_TILES.flatMap((tile) => tile.slugs.flat());
  assert.deepEqual([...slugs].sort(), RANKINGS.map((ranking) => ranking.slug).sort());
  assert.equal(new Set(slugs).size, slugs.length);
  for (const tile of RANKING_TILES) {
    assert.equal(tile.slugs.length, tile.pair ? 2 : 1, tile.id);
    for (const row of tile.slugs) assert.equal(row.length, tile.types?.length ?? 1, tile.id);
    // A per-type short name ("Typical flat price") has one per type.
    if (tile.typeLabels) assert.equal(tile.typeLabels.length, tile.types?.length, tile.id);
    for (const slug of tile.slugs.flat()) assert.equal(rankingBySlug(slug)?.group, tile.group, slug);
  }
  // Cost is three rankings' worth of tiles, not eleven (the board's "~3 tiles").
  assert.deepEqual(RANKING_TILES.filter((tile) => tile.group === "Cost").map((tile) => tile.id), ["price", "typical"]);
  const typical = RANKING_TILES.find((tile) => tile.id === "typical")!;
  assert.equal(typical.slugs[1][2], "lowest-semi-detached-prices");
});

test("price rankings say their figure is per square metre", () => {
  for (const slug of ["most-expensive", "least-expensive"]) assert.equal(metricRanking(slug).column, "Typical price per m²");
});

test("rankings order areas, break ties, skip unknowns and list every borough", () => {
  const index = buildIndex(sample());
  const expensive = buildRanking(index, metricRanking("most-expensive"));
  assert.deepEqual(expensive.rows.map((row) => [row.area.name, row.value, row.parentName]),
    [["Alpha 001", 11_000, "Alpha"], ["Alpha 002", 8_000, "Alpha"], ["Beta 001", 5_000, "Beta"]]);
  assert.deepEqual(buildRanking(index, metricRanking("lowest-crime")).rows.map((row) => row.area.name), ["Alpha 002", "Beta 001", "Alpha 001"]);
  assert.equal(rankingBySlug("nope"), null);
  // The rankings index previews the same rows (v3 Fix 15: real figures, never made up).
  assert.deepEqual(rankingPreview(index, metricRanking("most-expensive"), 2).map((row) => [row.name, row.value]),
    [["Alpha 001", 11_000], ["Alpha 002", 8_000]]);
  const tied = sample();
  tied.crime.msoa = tied.crime.msoa.map((value) => ({ ...value, value: value.geographyId.endsWith("3") ? 10 : 40 }));
  assert.deepEqual(buildRanking(buildIndex(tied), metricRanking("highest-crime")).rows.map((row) => row.rank), [1, 1, 3]);
  for (const ranking of RANKINGS) assert.ok(HELP[ranking.help], `${ranking.slug} has help text`);
});

// v3 Fix 17: /area/london's boroughs table, each figure the old "Boroughs by …" ranking's own.
test("the boroughs table: price and income take the middle of the areas inside, unknowns stay unknown", () => {
  const index = buildIndex(sample());
  const rows = boroughTable(index);
  // The most expensive first; price is the middle of the borough's neighbourhoods.
  assert.deepEqual(rows.map((row) => [row.name, row.cells.price.value]), [["Alpha", 10_000], ["Beta", 5_000]]);
  assert.match(rows[0].cells.price.display, /^£10,000/);
  assert.deepEqual(rows.map((row) => row.href), ["/area/lad/E09000001", "/area/lad/E09000002"]);
  // Income is published per MSOA only; Beta's one MSOA has none, so Beta's is unknown, not zero.
  assert.deepEqual(rows.map((row) => [row.cells.income.value, row.cells.income.display]), [[60_000, "£60,000 a year"], [null, "—"]]);
  const published = sample();
  published.values.income = [...published.values.income!, entry("uk:lad:E09000002", "income", 30_000)];
  assert.equal(boroughTable(buildIndex(published)).find((row) => row.name === "Beta")!.cells.income.value, 30_000);
  // Sorting: any figure, income too (owner decision 2026-10-18); an unknown figure sits last either way.
  assert.deepEqual(BOROUGH_COLUMNS.filter((column) => !column.sortable).map((column) => column.id), []);
  assert.deepEqual(boroughSortParam("crime"), { by: "crime", dir: "desc" });
  assert.deepEqual(boroughSortParam("income"), { by: "income", dir: "desc" });
  assert.deepEqual(boroughSortParam("bogus"), { by: "price", dir: "desc" });
  assert.deepEqual(boroughSortParam(undefined), { by: "price", dir: "desc" });
  for (const dir of ["asc", "desc"] as const) assert.deepEqual(sortBoroughRows(rows, { by: "income", dir }).map((row) => row.name), ["Alpha", "Beta"], dir);
  const unknownLast = [{ ...rows[0], name: "A", cells: { ...rows[0].cells, crime: { value: null, display: "—" } } }, rows[1]];
  for (const dir of ["asc", "desc"] as const) assert.equal(sortBoroughRows(unknownLast, { by: "crime", dir }).at(-1)!.name, "A");
  assert.deepEqual(sortBoroughRows(rows, { by: "name", dir: "asc" }).map((row) => row.name), ["Alpha", "Beta"]);
});

test("closest to a station ranks areas by the middle of their neighbourhoods' walk minutes, shortest first", () => {
  const data = sample();
  data.values["station-access"] = [
    entry("uk:lsoa:E01000001", "station-access", 4), entry("uk:lsoa:E01000002", "station-access", 9),
    entry("uk:lsoa:E01000003", "station-access", 12.4), entry("uk:lsoa:E01000004", "station-access", null),
  ];
  const ranking = metricRanking("closest-to-a-station");
  assert.deepEqual([ranking.group, ranking.level, ranking.order, ranking.column, ranking.help], ["Getting around", "msoa", "asc", "Walk to station", "ranking-station"]);
  const { rows, ranked } = buildRanking(buildIndex(data), ranking);
  // Beta 001's one neighbourhood has no figure: unranked, not zero.
  assert.deepEqual(rows.map((row) => [row.area.name, row.value, row.display, row.detail]),
    [["Alpha 001", 6.5, "7 min", "middle of 2 neighbourhoods"], ["Alpha 002", 12.4, "12 min", "middle of 1 neighbourhood"]]);
  assert.equal(ranked, 2);
  assert.equal(rankingTakeaway(ranking, rows), "Alpha 001 comes first, at a 7 min walk to a station; Alpha 002 is 2nd, at a 12 min walk to a station.");
});

test("highest food hygiene ranks areas by the share of nearby food places rated 4 or 5", () => {
  const data = sample();
  data.values["food-hygiene"] = [
    entry("uk:lsoa:E01000001", "food-hygiene", 80), entry("uk:lsoa:E01000002", "food-hygiene", 90),
    entry("uk:lsoa:E01000003", "food-hygiene", 72.4), entry("uk:lsoa:E01000004", "food-hygiene", 95.6),
  ];
  const ranking = metricRanking("highest-food-hygiene");
  assert.deepEqual([ranking.group, ranking.order, ranking.column, ranking.help], ["Everyday life", "desc", "Food places rated 4–5", "ranking-food-hygiene"]);
  const { rows } = buildRanking(buildIndex(data), ranking);
  assert.deepEqual(rows.map((row) => [row.area.name, row.display]), [["Beta 001", "96%"], ["Alpha 001", "85%"], ["Alpha 002", "72%"]]);
  assert.match(rankingTakeaway(ranking, rows)!, /^Beta 001 comes first, at 96% of food places rated 4–5;/);
  assert.match(HELP["ranking-food-hygiene"].short, /not the people who live/);
});

test("typical prices by type of home rank areas both ways, in neutral words, and skip suppressed areas", () => {
  const types = [["flat", "typical-price-flat", "Typical flat price"], ["terraced", "typical-price-terraced", "Typical terraced price"],
    ["semi-detached", "typical-price-semi", "Typical semi-detached price"], ["detached", "typical-price-detached", "Typical detached price"]] as const;
  for (const [words, metric, column] of types) {
    for (const end of ["highest", "lowest"] as const) {
      const ranking = metricRanking(`${end}-${words}-prices`);
      assert.deepEqual([ranking.group, ranking.metric, ranking.order, ranking.column, ranking.help], ["Cost", metric, end === "highest" ? "desc" : "asc", column, "ranking-typical-price"]);
      assert.doesNotMatch(`${ranking.title} ${ranking.lead}`, /cheap|afford|value|best|worth/i);
    }
  }
  const data = sample();
  data.values["typical-price-flat"] = [
    entry("uk:lsoa:E01000001", "typical-price-flat", 600_000, 41), entry("uk:lsoa:E01000002", "typical-price-flat", 700_000, 23),
    entry("uk:lsoa:E01000003", "typical-price-flat", 455_000, 12), entry("uk:lsoa:E01000004", "typical-price-flat", null, 3),
  ];
  const lowest = buildRanking(buildIndex(data), metricRanking("lowest-flat-prices"));
  assert.deepEqual(lowest.rows.map((row) => [row.area.name, row.display, row.detail]),
    [["Alpha 002", "£455k", "middle of 1 neighbourhood"], ["Alpha 001", "£650k", "middle of 2 neighbourhoods"]]);
  assert.equal(lowest.ranked, 2);
  assert.match(rankingTakeaway(metricRanking("lowest-flat-prices"), lowest.rows)!, /at £455k for flats;/);
  assert.match(HELP["ranking-typical-price"].short, /never .*single home/);
});

test("demo data gives every new ranking a figure", () => {
  const index = buildIndex(demoAreaPagesData());
  for (const slug of ["closest-to-a-station", "highest-food-hygiene", "highest-flat-prices", "lowest-terraced-prices", "highest-semi-detached-prices", "lowest-detached-prices"]) {
    assert.ok(buildRanking(index, metricRanking(slug)).rows.length > 0, `${slug} has demo rows`);
  }
});

test("demo data is a small London with values keyed to each metric's own carrier", () => {
  const data = demoAreaPagesData();
  const index = buildIndex(data);
  assert.equal(childrenOf(index, LONDON).length, 3);
  assert.equal(descendants(index, LONDON, "lsoa").length, 3);
  assert.ok(data.values["price-per-square-metre"]?.every((value) => value.geographyId.startsWith("uk:lsoa:")));
  assert.ok(data.values.income?.every((value) => value.geographyId.startsWith("uk:msoa:")));
  assert.equal(data.crime.borough.length, 3);
  const facts = areaFacts(index, "uk:lad:E09000001");
  assert.ok(facts?.price && facts.crime && facts.income && facts.deprivation);
  assert.equal(facts.schools, null);
});

test("counts agree with their nouns at 0, 1 and 2", () => {
  assert.equal(countOf(0, "neighbourhood"), "0 neighbourhoods");
  assert.equal(countOf(1, "neighbourhood"), "1 neighbourhood");
  assert.equal(countOf(2, "neighbourhood"), "2 neighbourhoods");
  assert.equal(countOf(1200, "area"), "1,200 areas");
  assert.deepEqual([0, 1, 2].map((count) => rankingScope("msoa", count, count)),
    ["Top 0 of 0 areas (MSOAs)", "Top 1 of 1 area (MSOA)", "Top 2 of 2 areas (MSOAs)"]);
  assert.deepEqual([0, 1, 2].map((count) => rankingScope("lad", count, count)), ["0 boroughs", "1 borough", "All 2 boroughs"]);
  const middle = (count: number) => basisNote({ value: 1, count, basis: "middle", period: null }, "neighbourhood");
  assert.deepEqual([0, 1, 2].map(middle), ["middle of 0 neighbourhoods", "middle of 1 neighbourhood", "middle of 2 neighbourhoods"]);
  const pooled = (count: number) => basisNote({ value: 1, count, basis: "pooled", period: null });
  assert.deepEqual([1, 2].map(pooled), ["1 borough", "all 2 boroughs together"]);
  // A ranking row resting on one neighbourhood reads in the singular.
  const index = buildIndex(demoAreaPagesData());
  const rows = buildRanking(index, metricRanking("most-expensive")).rows;
  for (const row of rows) assert.doesNotMatch(row.detail, /\b1 neighbourhoods\b/);
});

// A lens pack as the API serves it: already rolled up to the carrier, suppressed areas null.
function lensEntry(geographyId: GeographyId, value: number | null, sampleCount: number) {
  return { ...entry(geographyId, "crime", value, sampleCount), metricId: "lens:family" as MetricId, quality: value === null ? "suppressed" as const : "observed" as const };
}

test("lens rankings read each carrier's own rolled-up figure and skip suppressed areas", () => {
  const data = sample();
  data.lens = {
    family: {
      msoa: [lensEntry("uk:msoa:E02000001", 12.4, 31), lensEntry("uk:msoa:E02000002", 30.2, 40), lensEntry("uk:msoa:E02000003", null, 3)],
      borough: [lensEntry("uk:lad:E09000001", 14, 71), lensEntry("uk:lad:E09000002", 2.5, 3)],
      sources: [],
    },
  };
  const index = buildIndex(data);
  const families = lensRanking("most-places-for-families");
  assert.deepEqual([families.group, families.level, families.preset, families.order, families.column], ["Everyday life", "msoa", "family", "desc", "Places per km²"]);
  const { rows, ranked } = buildRanking(index, families);
  // Not the middle of the neighbourhoods: the MSOA's own figure, and an area under the minimum count is left out.
  assert.deepEqual(rows.map((row) => [row.area.name, row.display, row.detail]), [["Alpha 002", "30.2", "40 places"], ["Alpha 001", "12.4", "31 places"]]);
  assert.equal(ranked, 2);
  assert.match(rankingTakeaway(families, rows)!, /^Alpha 002 comes first, at 30\.2 playgrounds and nurseries per km²;/);
  // The boroughs table (/area/london) reads the borough roll-up the same way.
  assert.deepEqual(boroughTable(index).map((row) => [row.name, row.cells.families.display]), [["Alpha", "14.0"], ["Beta", "2.5"]]);
  // Other lenses have no pack here: nothing ranked, never zero.
  assert.equal(buildRanking(index, lensRanking("most-gyms")).ranked, 0);
});

test("variety and nearest lenses say kinds and minutes; zero-place areas are not ranked", () => {
  const data = sample();
  data.lens = {
    "food-variety": { msoa: [lensEntry("uk:msoa:E02000001", 23, 140), lensEntry("uk:msoa:E02000002", 9, 30)], borough: [], sources: [] },
    markets: { msoa: [lensEntry("uk:msoa:E02000001", 14, 2), lensEntry("uk:msoa:E02000002", 6.5, 1)], borough: [], sources: [] },
    universities: { msoa: [lensEntry("uk:msoa:E02000001", 0, 5), lensEntry("uk:msoa:E02000002", 1.2, 6)], borough: [], sources: [] },
  };
  const index = buildIndex(data);
  const variety = buildRanking(index, lensRanking("widest-food-variety"));
  assert.deepEqual(variety.rows.map((row) => [row.area.name, row.display]), [["Alpha 001", "23"], ["Alpha 002", "9"]]);
  assert.match(rankingTakeaway(lensRanking("widest-food-variety"), variety.rows)!, /at 23 kinds of cuisine;/);
  const market = buildRanking(index, lensRanking("closest-to-a-market"));
  assert.deepEqual(market.rows.map((row) => [row.area.name, row.display, row.detail]),
    [["Alpha 002", "7 min", "middle of 1 neighbourhood"], ["Alpha 001", "14 min", "middle of 2 neighbourhoods"]]);
  assert.match(rankingTakeaway(lensRanking("closest-to-a-market"), market.rows)!, /at a 7 min walk to a market;/);
  assert.deepEqual(buildRanking(index, lensRanking("most-universities")).rows.map((row) => row.area.name), ["Alpha 002"]);
});

test("every lens ranking says in neutral words how its figure is made", () => {
  assert.deepEqual(RANKINGS.filter((ranking) => ranking.kind === "lens").map((ranking) => ranking.slug).sort(), [...LENS_SLUGS].sort());
  for (const slug of LENS_SLUGS) {
    const ranking = lensRanking(slug);
    assert.ok(HELP[ranking.help], `${slug} has help text`);
    // The help bubble is the same whichever places table is loaded: the page names the sources.
    assert.doesNotMatch(HELP[ranking.help].short, /OpenStreetMap/, slug);
    if (ranking.level === "lad") {
      assert.equal(ranking.help, "ranking-lens-borough", slug);
      assert.match(HELP[ranking.help].short, /City of London/, slug);
      assert.doesNotMatch(HELP[ranking.help].short, /under 5|fewer than 5/, slug);
    }
    assert.doesNotMatch(`${ranking.title} ${ranking.lead}`, /best|good|friendly|safe|ideal|score/i, slug);
    const text = lensExplainer(ranking, lensSources(null, ranking.preset)).join(" ");
    assert.match(text, /OpenStreetMap/, slug);
    assert.match(text, /ODbL|Open Database Licence/, slug);
    assert.match(text, /places, not people/i, slug);
    assert.match(text, /inside the (area|borough)'s boundary/, slug);
    if (ranking.column.endsWith("per km²")) {
      assert.match(text, /per km²/, slug);
      assert.match(text, ranking.level === "msoa" ? /fewer than 5/ : /City of London/, slug);
    }
  }
  const explain = (slug: string) => lensExplainer(lensRanking(slug), lensSources(null, lensRanking(slug).preset));
  const families = explain("most-places-for-families").join(" ");
  for (const words of [/playgrounds/, /nurseries/, /nearest playground or nursery/, /each counts once/i, /not a score/i, /12 per km²/]) assert.match(families, words);
  assert.match(explain("most-coworking-spaces").join(" "), /cafés/);
});

const UNIFIED_SOURCES = [
  { name: "OpenStreetMap (Geofabrik Greater London extract)", licence: "ODbL-1.0", attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
  { name: "FSA food hygiene rating data", licence: "OGL-UK-3.0", attribution: "Contains public sector information licensed under the Open Government Licence v3.0 (Food Standards Agency)", url: "https://www.food.gov.uk/uk-food-hygiene-rating-data-api" },
  { name: "Overture Maps places", licence: "CDLA-Permissive-2.0", attribution: "© Overture Maps Foundation", url: "https://docs.overturemaps.org/attribution/" },
  { name: "Foursquare Open Source Places", licence: "Apache-2.0", attribution: "Foursquare Open Source Places, © Foursquare Labs, Inc.", url: "https://opensource.foursquare.com/os-places/" },
];

test("a lens built from merged places credits every source under its own licence", () => {
  const data = sample();
  data.lens = { gyms: { msoa: [lensEntry("uk:msoa:E02000001", 4.1, 9)], borough: [], sources: UNIFIED_SOURCES } };
  const sources = lensSources(buildIndex(data), "gyms");
  assert.deepEqual(sources.map((source) => source.licence), ["ODbL-1.0", "OGL-UK-3.0", "CDLA-Permissive-2.0", "Apache-2.0"]);
  const text = lensExplainer(lensRanking("most-gyms"), sources).join(" ");
  for (const words of [/OpenStreetMap, FSA food hygiene rating data, Overture Maps places and Foursquare Open Source Places/,
    /© OpenStreetMap contributors \(ODbL-1.0\)/, /Open Government Licence v3.0 \(Food Standards Agency\) \(OGL-UK-3.0\)/,
    /© Overture Maps Foundation \(CDLA-Permissive-2.0\)/, /Foursquare Labs, Inc. \(Apache-2.0\)/, /places, not people/]) {
    assert.match(text, words);
  }
  assert.doesNotMatch(text, /mapped on OpenStreetMap|Volunteers keep the map/);
  // OpenStreetMap alone keeps its own words.
  const osm = lensExplainer(lensRanking("most-gyms"), lensSources(null, "gyms")).join(" ");
  assert.match(osm, /mapped on OpenStreetMap/);
  assert.match(osm, /Volunteers keep the map up to date/);
});

test("a lens ranking whose pack is empty is hidden and left out of the sitemap", () => {
  const data = sample();
  data.lens = { gyms: { msoa: [lensEntry("uk:msoa:E02000001", 4.1, 9)], borough: [lensEntry("uk:lad:E09000001", null, 9)], sources: [] } };
  const shown = availableRankings(buildIndex(data)).map((ranking) => ranking.slug);
  assert.ok(shown.includes("most-gyms"));
  assert.ok(shown.includes("most-expensive"));
  for (const slug of LENS_SLUGS.filter((slug) => slug !== "most-gyms")) assert.ok(!shown.includes(slug), `${slug} is hidden`);
  // Unreachable data: only the metric rankings, which say "unknown for now" on their own.
  assert.deepEqual(availableRankings(null).map((ranking) => ranking.slug), RANKINGS.filter((ranking) => ranking.kind === "metric").map((ranking) => ranking.slug));
  const paths = sitemapPaths([], availableRankings(buildIndex(data)));
  assert.ok(paths.includes("/rankings/most-gyms"));
  assert.ok(!paths.includes("/rankings/most-nightlife"));
  assert.ok(!sitemapPaths([]).includes("/rankings/most-gyms"));
});

// The demo has no school counts and too few report-card inspections: those pages hide.
const DEMO_HIDDEN = ["secondary-report-card-exceptional", "most-primary-schools", "most-secondary-schools"];

test("demo data gives every lens ranking a figure", () => {
  const index = buildIndex(demoAreaPagesData());
  assert.deepEqual(availableRankings(index).map((ranking) => ranking.slug), RANKINGS.map((ranking) => ranking.slug).filter((slug) => !DEMO_HIDDEN.includes(slug)));
  for (const slug of LENS_SLUGS) assert.ok(buildRanking(index, lensRanking(slug)).rows.length > 0, `${slug} has demo rows`);
});

test("a load with a lens missing is kept for minutes, not the hour", async () => {
  const original = globalThis.fetch;
  let failing = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/api/v1/metrics")) return json({ metrics: [] });
    if (url.endsWith("/api/v1/hierarchy")) return json({ schemaVersion: "area-hierarchy.v1", areas: sample().areas });
    if (url.includes(`/lens/${failing}?`)) return new Response("timeout", { status: 504 });
    if (url.includes("/area-values/lens/")) {
      return json({ schemaVersion: "area-value-pack.v1", sourceVersion: "src-places-osm-1", sources: [], values: [lensEntry("uk:msoa:E02000001", null, 2)] });
    }
    if (url.includes("/school-rankings/")) return json({ schemaVersion: "school-ranking.v1", rows: [] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    const whole = await loadRealAreaPages("http://api.test");
    assert.ok(whole);
    assert.equal(whole.incomplete, false); // every lens answered, even with no figures
    assert.equal(cacheTtlMs(whole), 60 * 60 * 1000);
    failing = "nightlife";
    const partial = await loadRealAreaPages("http://api.test");
    assert.ok(partial);
    assert.equal(partial.incomplete, true);
    assert.ok(cacheTtlMs(partial) <= 2 * 60 * 1000);
  } finally {
    globalThis.fetch = original;
  }
});

test("the real loader fetches every lens pack per carrier and drops empty or fixture packs", async () => {
  const requested: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/api/v1/metrics")) return json({ metrics: [] });
    if (url.endsWith("/api/v1/hierarchy")) return json({ schemaVersion: "area-hierarchy.v1", areas: sample().areas });
    const match = url.match(/\/area-values\/lens\/([a-z-]+)\?carrier=(msoa|lad)$/);
    if (match?.[1] === "family") {
      return json({ schemaVersion: "area-value-pack.v1", metricId: "lens:family", carrier: match[2], sourceVersion: "src-places-osm-1",
        sources: [{ id: "src-places-osm-1", name: "OpenStreetMap", licence: "ODbL-1.0", attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" }],
        values: [lensEntry(match[2] === "msoa" ? "uk:msoa:E02000001" : "uk:lad:E09000001", 12, 30)] });
    }
    if (match?.[1] === "gyms") return json({ schemaVersion: "area-value-pack.v1", sourceVersion: "preview-v1", values: [lensEntry("uk:msoa:E02000001", 3, 9)] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    const data = await loadRealAreaPages("http://api.test");
    assert.ok(data);
    assert.ok(requested.includes("http://api.test/api/v1/area-values/lens/family?carrier=msoa"));
    assert.ok(requested.includes("http://api.test/api/v1/area-values/lens/universities?carrier=lad"));
    assert.deepEqual(Object.keys(data.lens ?? {}), ["family"]);
    assert.equal(data.lens?.family?.msoa[0].value, 12);
    assert.equal(data.lens?.family?.sources[0].licence, "ODbL-1.0");
  } finally {
    globalThis.fetch = original;
  }
});

function countRanking(slug: string): CountRanking {
  const ranking = rankingBySlug(slug);
  assert.equal(ranking?.kind, "count", `${slug} is a count ranking`);
  return ranking as CountRanking;
}

function schoolRanking(slug: string): SchoolRanking {
  const ranking = rankingBySlug(slug);
  assert.equal(ranking?.kind, "school", `${slug} is a school ranking`);
  return ranking as SchoolRanking;
}

function schoolResponse(axis: SchoolRanking["axis"], rows: SchoolRankingResponse["rows"], extra: Partial<SchoolRankingResponse> = {}): SchoolRankingResponse {
  return {
    schemaVersion: "school-ranking.v1", axis, phase: "secondary", measure: axis, year: "2024/25", minCohort: 30,
    eligibleSchools: rows.length, rows, caveats: ["Provisional 2024/25 figures (DfE)."],
    attribution: "Contains public sector information licensed under the Open Government Licence v3.0.", ...extra,
  };
}

const school = (urn: string, name: string, value: number | string, year = "2024/25", cohort: number | null = 120) =>
  ({ urn, name, borough: "Camden", value, cohort, year });

test("school-count rankings count each area's own state schools and skip areas with none", () => {
  const index = buildIndex(sample());
  const primary = countRanking("most-primary-schools");
  assert.deepEqual([primary.group, primary.level, primary.phase, primary.column], ["Schools", "msoa", "primary", "Primary schools"]);
  const { rows, ranked } = buildRanking(index, primary);
  assert.deepEqual(rows.map((row) => [row.rank, row.area.name, row.display]), [[1, "Alpha 001", "2"], [2, "Alpha 002", "1"], [2, "Beta 001", "1"]]);
  assert.equal(ranked, 3);
  assert.equal(rankingTakeaway(primary, rows), "Alpha 001 comes first, at 2 state primary schools; Beta 001 is 2nd, at 1 state primary school.");
  // A list of "most" schools leaves out areas with none.
  assert.deepEqual(buildRanking(index, countRanking("most-secondary-schools")).rows.map((row) => row.area.name), ["Alpha 001"]);
  assert.ok(availableRankings(index).some((ranking) => ranking.slug === "most-primary-schools"));
  // Schools not loaded (null, never 0): the pages hide and leave the sitemap.
  const unloaded = sample();
  unloaded.areas = unloaded.areas.map((candidate) => ({ ...candidate, schools: null }));
  const shown = availableRankings(buildIndex(unloaded)).map((ranking) => ranking.slug);
  assert.ok(!shown.includes("most-primary-schools") && !shown.includes("most-secondary-schools"));
  const explainer = countExplainer(primary).join(" ");
  assert.match(explainer, /state-funded primary schools/);
  assert.match(explainer, /Open Government Licence/);
  assert.match(explainer, /doesn't guarantee a place/);
});

test("KS4 school rankings rank with shared ties, sign Progress 8 and link to each school's page", () => {
  const grade5 = schoolRanking("top-secondary-grade5-english-maths");
  const table = buildSchoolRanking(grade5, schoolResponse("grade5-english-maths", [school("1", "A", 81.4), school("2", "B", 81.4), school("3", "C", 70.04, "2024/25", 31)]));
  assert.deepEqual(table.map((row) => [row.rank, row.name, row.display, row.detail]),
    [[1, "A", "81%", "120 pupils"], [1, "B", "81%", "120 pupils"], [3, "C", "70%", "31 pupils"]]);
  assert.equal(table[0].href, "/school/1");
  assert.deepEqual([table[0].sourceHref, table[0].sourceLabel], ["https://www.compare-school-performance.service.gov.uk/school/1", "DfE"]);
  assert.equal(table[0].borough, "Camden");
  const attainment = buildSchoolRanking(schoolRanking("top-secondary-attainment-8"), schoolResponse("attainment-8", [school("1", "A", 61.25)]));
  assert.equal(attainment[0].display, "61.3");
  const p8 = schoolRanking("top-secondary-progress-8");
  const progress = schoolResponse("progress-8", [school("1", "A", 0.456, "2023/24"), school("2", "B", -0.1, "2023/24")], { year: "2023/24" });
  assert.deepEqual(buildSchoolRanking(p8, progress).map((row) => row.display), ["+0.46", "−0.10"]);
  assert.equal(schoolColumn(p8, progress), "Progress 8 (2023/24)");
  assert.equal(schoolRankingScope(p8, { ...progress, eligibleSchools: 250 }), "Top 2 of 250 state secondary schools with 30 or more pupils in the year group, 2023/24");
});

test("Outstanding lists are filtered lists without rank numbers; report cards wait for 30 inspections", () => {
  for (const [slug, phase] of [["outstanding-secondary-schools", "secondary"], ["outstanding-primary-schools", "primary"]] as const) {
    const ranking = schoolRanking(slug);
    assert.deepEqual([ranking.axis, ranking.phase], ["legacy-outstanding", phase]);
    const response = schoolResponse("legacy-outstanding", [school("9", "Z", "Outstanding", "2023/24", null), school("8", "Y", "Outstanding", "2012/13", null)], { phase, year: null, minCohort: null, eligibleSchools: 140 });
    const rows = buildSchoolRanking(ranking, response);
    assert.deepEqual(rows.map((row) => [row.rank, row.display, row.detail]), [[null, "2023/24", ""], [null, "2012/13", ""]]);
    assert.equal(rows[0].href, "/school/9");
    assert.deepEqual([rows[0].sourceHref, rows[0].sourceLabel], ["https://reports.ofsted.gov.uk/search?q=9", "Ofsted"]);
    assert.equal(schoolColumn(ranking, response), "Inspected");
    assert.equal(schoolRankingScope(ranking, response), `The 2 most recently inspected of 140 state ${phase} schools rated Outstanding`);
  }
  const exceptional = schoolRanking("secondary-report-card-exceptional");
  const response = (inspected: number) => schoolResponse("report-card-exceptional",
    [school("1", "A", 3, "2025/26", null), school("2", "B", 3, "2025/26", null), school("3", "C", 1, "2025/26", null)], { year: null, minCohort: null, inspectedSchools: inspected });
  assert.deepEqual(buildSchoolRanking(exceptional, response(40)).map((row) => [row.rank, row.display, row.detail]),
    [[1, "3", "inspected 2025/26"], [1, "3", "inspected 2025/26"], [3, "1", "inspected 2025/26"]]);
  const shown = (inspected: number) => {
    const data = sample();
    data.schoolRankings = { "secondary-report-card-exceptional": response(inspected) };
    return availableRankings(buildIndex(data)).map((ranking) => ranking.slug);
  };
  assert.ok(!shown(29).includes("secondary-report-card-exceptional"));
  assert.ok(shown(30).includes("secondary-report-card-exceptional"));
});

test("a school ranking with no rows or no response is hidden; KS2 and EBacc have no page yet", () => {
  const data = sample();
  data.schoolRankings = {
    "top-secondary-attainment-8": schoolResponse("attainment-8", [school("1", "A", 50)]),
    "top-secondary-progress-8": schoolResponse("progress-8", []),
  };
  const shown = availableRankings(buildIndex(data)).map((ranking) => ranking.slug);
  assert.ok(shown.includes("top-secondary-attainment-8"));
  for (const slug of ["top-secondary-progress-8", "top-secondary-grade5-english-maths", "outstanding-primary-schools"]) assert.ok(!shown.includes(slug), `${slug} is hidden`);
  for (const slug of ["top-primary-ks2", "top-secondary-ebacc"]) assert.equal(rankingBySlug(slug), null);
  for (const ranking of RANKINGS.filter((candidate) => candidate.kind === "school" || candidate.kind === "count")) {
    assert.equal(ranking.group, "Schools");
    assert.doesNotMatch(`${ranking.title} ${ranking.lead}`, /\bbest\b|worst|good school/i);
  }
});

test("the real loader asks for each school ranking and keeps only well-formed answers", async () => {
  const requested: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/api/v1/metrics")) return json({ metrics: [] });
    if (url.endsWith("/api/v1/hierarchy")) return json({ schemaVersion: "area-hierarchy.v1", areas: sample().areas });
    if (url.includes("/school-rankings/attainment-8?phase=secondary")) return json(schoolResponse("attainment-8", [school("1", "A", 50)]));
    if (url.includes("/school-rankings/progress-8")) return json({ error: "nope" });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    const data = await loadRealAreaPages("http://api.test");
    assert.ok(requested.includes("http://api.test/api/v1/school-rankings/legacy-outstanding?phase=primary&limit=100"));
    assert.deepEqual(Object.keys(data?.schoolRankings ?? {}), ["top-secondary-attainment-8"]);
  } finally {
    globalThis.fetch = original;
  }
});
