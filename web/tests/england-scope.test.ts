import assert from "node:assert/strict";
import test from "node:test";

import {
  areaFacts, buildFaq, buildIndex, englandRegions, indexScopeName, LONDON, regionPath, type AreaPagesData, type HierarchyArea,
} from "../src/lib/area-pages";
import { areaTrail, findRegionTree, loadRealAreaPages, regionTree, UNKNOWN } from "../src/lib/area-pages-data";
import { areaCrumbs } from "../src/lib/entity-nav";
import { deprivationWords, densityWords, leadLine } from "../src/lib/share-rows";
import { hubBoroughs, hubScope, LONDON_BOROUGHS, readSchoolFilters } from "../src/lib/schools-hub";
import { LONDON_SCOPE, REGIONS, regionScope, regionSlug, scopeName } from "../src/lib/scope-name";
import { areaSitemapIds, areaSitemapPath, areaSitemapPaths, placeJsonLd, SITE_NAME, SITEMAP_LIMIT, sitemapPaths } from "../src/lib/seo";
import { stripWords, type TileView } from "../src/lib/standouts";

const NORTH_WEST = { code: "E12000002", name: "North West" };

const area = (geographyId: string, name: string, carrier: HierarchyArea["carrier"], parentId: string | null, regionCode?: string): HierarchyArea => ({
  geographyId: geographyId as HierarchyArea["geographyId"], name, carrier, parentId: parentId as HierarchyArea["parentId"], regionCode, schools: null,
});

test("scopeName: the area's region from rankScope, London when absent", () => {
  assert.equal(scopeName({ rankScope: NORTH_WEST }), "North West");
  assert.equal(scopeName(NORTH_WEST), "North West");
  assert.equal(scopeName({ rankScope: null }), "London");
  assert.equal(scopeName(null, "unknown", undefined), "London");
  assert.equal(scopeName({ rankScope: null }, NORTH_WEST), "North West", "the first source with a scope wins");
  assert.equal(REGIONS.length, 9);
  assert.equal(regionScope("E12000007"), LONDON_SCOPE);
  assert.equal(regionScope("E99999999"), null);
  assert.equal(regionSlug({ code: "E12000003", name: "Yorkshire and The Humber" }), "yorkshire-and-the-humber");
});

test("comparison copy says the region: strips, deprivation, Census rows", () => {
  const tile = { standing: 80, regionPercentile: null } as unknown as TileView;
  assert.equal(stripWords(tile), "Better than 80% of London");
  assert.equal(stripWords(tile, "North West"), "Better than 80% of North West");
  assert.equal(deprivationWords(55, "South East"), "Deprivation: around South East's middle");
  assert.equal(densityWords({ densityPerKm2: 2000, regionDensityPerKm2: 1000 } as never, "North West"), "2,000 people / km² · twice North West's density");
  assert.equal(leadLine("age", [{ id: "65", label: "65 and over", share: 0.3, regionShare: 0.1 }] as never, "North West"),
    "Aged 65 and over: 30% here, 10% in North West");
});

test("/area/england lists only the regions with boroughs, in ONS order", () => {
  const regions = englandRegions([
    area("uk:lad:E08000003", "Manchester", "lad", null, "E12000002"),
    area("uk:lad:E09000007", "Camden", "lad", null, "E12000007"),
    area("uk:lad:E08000001", "Bolton", "lad", null, "E12000002"),
    area("uk:lad:E09000001", "City of London", "lad", null),
  ]);
  assert.deepEqual(regions.map((entry) => [entry.region.name, entry.slug, entry.boroughs.map((borough) => borough.name)]), [
    ["North West", "north-west", ["Bolton", "Manchester"]],
    ["London", "london", ["Camden", "City of London"]],
  ]);
  assert.equal(regionPath(LONDON_SCOPE), "/area/london");
  assert.equal(regionPath(NORTH_WEST), "/area/england#north-west");
  assert.equal(regionPath(null), "/area/london");
});

test("a region's index names its root and compares with it, never with London", () => {
  const data: AreaPagesData = {
    mode: "real", scope: NORTH_WEST,
    areas: [area("uk:lad:E08000003", "Manchester", "lad", null, "E12000002"), area("uk:lsoa:E01005000", "Manchester 001A", "lsoa", "uk:lad:E08000003", "E12000002")],
    values: {}, crime: { msoa: [], borough: [] }, periods: {},
  };
  const index = buildIndex(data);
  assert.equal(indexScopeName(index), "North West");
  const root = areaFacts(index, LONDON)!;
  assert.equal(root.name, "North West");
  const own = areaFacts(index, "uk:lad:E08000003")!;
  const withPrice = { ...own, price: { value: 3000, period: "2026-06", basis: "own" as const, count: 1 } };
  const faq = buildFaq(withPrice, { ...root, price: { value: 2500, period: "2026-06", basis: "own" as const, count: 1 } });
  assert.match(faq.find((item) => item.id === "price")!.answer, /North West as a whole/);
  assert.doesNotMatch(faq.map((item) => item.answer).join(" "), /London/);
});

test("breadcrumbs start at the area's region", () => {
  const trail = [area("uk:lad:E08000003", "Manchester", "lad", null, "E12000002")];
  assert.deepEqual(areaCrumbs(trail)[0], { label: "North West", href: "/area/england#north-west" });
  assert.deepEqual(areaCrumbs([area("uk:lad:E09000007", "Camden", "lad", null)])[0], { label: "London", href: "/area/london" });
});

test("sitemap: /area/england listed; sectors and each region outside London get their own shard", () => {
  assert.ok(sitemapPaths([]).includes("/area/england"));
  assert.deepEqual(areaSitemapIds([LONDON_SCOPE]), ["sectors"]);
  assert.deepEqual(areaSitemapIds([NORTH_WEST, LONDON_SCOPE]), ["sectors", "north-west"]);
  assert.equal(areaSitemapPath("north-west"), "/area/sitemap/north-west.xml");
  // The largest region (South East, ≈ 5,600 LSOAs, 1,150 MSOAs, 64 LADs) fits one shard with room to spare.
  const lsoas = Array.from({ length: 5600 }, (_, i) => ({ geographyId: `uk:lsoa:E0${String(1000000 + i)}` as `uk:lsoa:${string}` }));
  assert.ok(areaSitemapPaths(lsoas).length < SITEMAP_LIMIT / 2);
});

test("schools hub: London's 33 always, every other local authority the index names", () => {
  assert.equal(hubBoroughs([]).length, LONDON_BOROUGHS.length);
  assert.equal(hubScope(hubBoroughs([])), "London");
  const boroughs = hubBoroughs([{ borough: "Manchester" }, { borough: "Kent" }, { borough: "Camden" }, { borough: null }]);
  assert.equal(boroughs.length, 35);
  assert.equal(hubScope(boroughs), "England");
  assert.equal(readSchoolFilters({ borough: "kent" }, boroughs).borough?.name, "Kent");
  assert.equal(readSchoolFilters({ borough: "kent" }).borough, null, "London only by default");
});

test("site name is Close Knit; schema.org places an area in its region", () => {
  assert.equal(SITE_NAME, "Close Knit");
  const london = JSON.parse(placeJsonLd("https://x.test", { name: "A", path: "/area/lsoa/E01000001", description: "d" }));
  assert.deepEqual(london.containedInPlace, { "@type": "City", name: "London" });
  const north = JSON.parse(placeJsonLd("https://x.test", { name: "B", path: "/area/lad/E08000003", description: "d", region: "North West" }));
  assert.deepEqual(north.containedInPlace, { "@type": "AdministrativeArea", name: "North West" });
});

test("the loader keeps one region at a time: an area id finds its region's tree, every read is cut to it", async () => {
  const requested: string[] = [];
  const original = globalThis.fetch;
  const manchester = area("uk:lad:E08000003", "Manchester", "lad", null, "E12000002");
  const lsoa = area("uk:lsoa:E01005000", "Manchester 001A", "lsoa", "uk:lad:E08000003", "E12000002");
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("/api/v1/hierarchy?region=")) {
      return json({ schemaVersion: "area-hierarchy.v1", region: NORTH_WEST, areas: [manchester, lsoa] });
    }
    if (url.endsWith("/api/v1/metrics")) return json({ metrics: [] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    const tree = await regionTree("http://api.test", "r1", "uk:lsoa:E01005000");
    assert.equal(tree?.region.name, "North West");
    // The same region again, by another of its areas or its code: no second hierarchy read.
    assert.equal((await regionTree("http://api.test", "r1", "uk:lad:E08000003"))?.region.code, "E12000002");
    assert.equal((await regionTree("http://api.test", "r1", "E12000002"))?.areas.length, 2);
    assert.equal(requested.filter((url) => url.includes("/hierarchy")).length, 1);
    const data = await loadRealAreaPages("http://api.test", tree);
    assert.equal(data?.scope?.name, "North West");
    assert.ok(requested.some((url) => url.endsWith("/area-values/lens/family?carrier=msoa&region=E12000002")));
    assert.ok(!requested.some((url) => url.includes("/school-rankings/")), "London's school lists only for London");
  } finally {
    globalThis.fetch = original;
  }
});

test("breadcrumbs (school, area, home pages) never read the region's area list: the trail, or a tree already kept", async () => {
  const requested: string[] = [];
  const original = globalThis.fetch;
  const manchester = area("uk:lad:E08000003", "Manchester", "lad", null, "E12000002");
  const lsoa = area("uk:lsoa:E01005000", "Manchester 001A", "lsoa", "uk:lad:E08000003", "E12000002");
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/api/v1/areas/uk%3Alsoa%3AE01005000/trail")) {
      return json({ schemaVersion: "area-hierarchy.v1", region: NORTH_WEST, areas: [manchester, lsoa] });
    }
    if (url.includes("/api/v1/hierarchy?region=")) return json({ schemaVersion: "area-hierarchy.v1", region: NORTH_WEST, areas: [manchester, lsoa] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    // A cold process (PR #342, 2026-10-25: the first school page after a restart took 1.5-3.2 s for a ~1.5 MB list).
    assert.deepEqual((await areaTrail("http://trail.test", "r1", "uk:lsoa:E01005000")).map((row) => row.name), ["Manchester", "Manchester 001A"]);
    assert.deepEqual(requested, ["http://trail.test/api/v1/areas/uk%3Alsoa%3AE01005000/trail"]);
    assert.deepEqual(await areaTrail("http://trail.test", "r1", "uk:lsoa:E01009999"), [], "unknown area: no crumbs, no list");
    assert.ok(!requested.some((url) => url.includes("/hierarchy")));
    // Once an area page has kept the region's tree, the trail comes from it with no read.
    await regionTree("http://trail.test", "r1", "E12000002");
    const before = requested.length;
    assert.equal((await areaTrail("http://trail.test", "r1", "uk:lsoa:E01005000")).length, 2);
    assert.equal(requested.length, before);
  } finally {
    globalThis.fetch = original;
  }
});

test("a busy API is no answer, never an unknown area: a 429 on the region's tree never falls back to London (the 404 under load)", async () => {
  const original = { fetch: globalThis.fetch, key: process.env.CLOSE_KNIT_INTERNAL_KEY };
  process.env.CLOSE_KNIT_INTERNAL_KEY = "k";
  const requested: { url: string; headers: Record<string, string> }[] = [];
  let status = 429;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requested.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(status === 200 ? JSON.stringify({ schemaVersion: "area-hierarchy.v1", region: NORTH_WEST, areas: [] }) : "busy", { status });
  }) as typeof fetch;
  try {
    // Pages asking at once for one borough share one read; a 429 (or a timeout) is null: "didn't load", not a 404.
    const answers = await Promise.all([1, 2, 3].map(() => findRegionTree("http://busy.test", "r1", "uk:lad:E08000003")));
    assert.deepEqual(answers, [null, null, null]);
    assert.equal(requested.length, 1);
    // Every read of a shared load is tagged as one render, so the API charges it as one page view, not ~35 reads
    // of the web container's own 120 a minute (api/area_api/ratelimit.py).
    assert.equal(requested[0].headers["x-close-knit-internal"], "k");
    assert.ok(requested[0].headers["x-close-knit-render"]);
    status = 404;
    assert.equal(await findRegionTree("http://busy.test", "r1", "uk:lad:E08000099"), UNKNOWN, "only a 404 is an unknown area");
    status = 200;
    assert.equal((await findRegionTree("http://busy.test", "r1", "uk:lad:E08000003")) !== null, true, "the next read after the outage is asked again");
  } finally {
    globalThis.fetch = original.fetch;
    if (original.key === undefined) delete process.env.CLOSE_KNIT_INTERNAL_KEY;
    else process.env.CLOSE_KNIT_INTERNAL_KEY = original.key;
  }
});

test("a region load passes its one set of headers to every read", async () => {
  const seen = new Set<string>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    seen.add((init?.headers as Record<string, string>)["x-close-knit-render"] ?? "none");
    return new Response(JSON.stringify({ metrics: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    const tree = { region: NORTH_WEST, areas: [], byId: new Map() };
    await loadRealAreaPages("http://api.test", tree, { "x-close-knit-render": "load-1" });
    assert.deepEqual([...seen], ["load-1"]);
  } finally {
    globalThis.fetch = original;
  }
});
