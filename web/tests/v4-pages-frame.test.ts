import assert from "node:assert/strict";
import test from "node:test";

import { buildIndex } from "../src/lib/area-pages";
import { demoAreaPagesData } from "../src/lib/area-pages-data";
import { boroughAreaRows, boroughAreaSortParam, sortBoroughAreas, type BoroughAreaRow } from "../src/lib/borough-areas";
import { canonicalPath } from "../src/lib/canonical-path";
import { addressJsonLd, areaCard, NOT_FOUND_METADATA, robotsRules, searchIndexable, SITE_CARD, siteRobots } from "../src/lib/seo";
import { fixtureStandouts } from "../src/lib/standouts-fixture";
import { readStandouts, STANDOUT_TILE_IDS } from "../src/lib/standouts";

// v4 Task 40: one address per page.
test("an area code or postcode in another case has one canonical path; canonical paths stay", () => {
  assert.equal(canonicalPath("/area/lsoa/e01003998"), "/area/lsoa/E01003998");
  assert.equal(canonicalPath("/area/LSOA/E01003998/places"), "/area/lsoa/E01003998/places");
  assert.equal(canonicalPath("/area/lad/e09000009/pack"), "/area/lad/E09000009/pack");
  assert.equal(canonicalPath("/area/lsoa/E01003998"), null);
  assert.equal(canonicalPath("/area/london"), null);
  assert.equal(canonicalPath("/area/street/e01003998"), null, "not an area kind: left to the 404");
  assert.equal(canonicalPath("/postcode/sw1a1aa"), "/postcode/SW1A-1AA");
  assert.equal(canonicalPath("/postcode/sw1a-1aa/homes"), "/postcode/SW1A-1AA/homes");
  assert.equal(canonicalPath("/postcode/SW1A%201AA"), "/postcode/SW1A-1AA");
  assert.equal(canonicalPath("/postcode/SW1A-1AA"), null);
  assert.equal(canonicalPath("/postcode/not-a-postcode"), null);
  assert.equal(canonicalPath("/postcode/sitemap"), null);
});

test("a 404 has its own title; previews use the neighbourhood's card; homes and postcodes are places, never priced", () => {
  assert.equal(NOT_FOUND_METADATA.title, "Page not found");
  assert.doesNotMatch(String(NOT_FOUND_METADATA.description), /sold for/);
  assert.equal(areaCard("uk:lsoa:E01000001"), "/area/lsoa/E01000001/opengraph-image");
  assert.equal(areaCard("uk:lad:E09000001"), SITE_CARD);
  assert.equal(areaCard(null), SITE_CARD);
  const home = JSON.parse(addressJsonLd("https://example.test", {
    type: "Residence", name: "1 Example Street", path: "/property/1", postcode: "SW1A 1AA", latitude: 51.5, longitude: -0.14,
    area: { name: "St James's · SW1A", path: "/area/lsoa/E01000001" },
  }));
  assert.equal(home["@type"], "Residence");
  assert.equal(home.url, "https://example.test/property/1");
  assert.equal(home.address.postalCode, "SW1A 1AA");
  assert.deepEqual(home.geo, { "@type": "GeoCoordinates", latitude: 51.5, longitude: -0.14 });
  assert.equal(home.containedInPlace.url, "https://example.test/area/lsoa/E01000001");
  assert.doesNotMatch(JSON.stringify(home), /price|offers|aggregateRating/i);
  const postcode = JSON.parse(addressJsonLd("https://example.test", {
    type: "Place", name: "SW1A 1AA", path: "/postcode/SW1A-1AA", postcode: "SW1A 1AA", latitude: null, longitude: null, area: null,
  }));
  assert.equal(postcode.geo, undefined);
  assert.equal(postcode.containedInPlace.name, "London");
});

test("search stays shut until CLOSE_KNIT_ACCESS=public, then robots.txt names the sitemap index", () => {
  assert.equal(searchIndexable(undefined), false);
  assert.equal(searchIndexable("private"), false);
  assert.equal(searchIndexable("public"), true);
  assert.deepEqual(siteRobots(false), { index: false, follow: false });
  assert.equal(siteRobots(true), undefined);
  assert.equal(robotsRules("https://example.test", false).sitemap, undefined);
  assert.equal(robotsRules("https://example.test", true).sitemap, "https://example.test/sitemap-index.xml");
});

// v4 Task 17: the borough page's tiles and Areas list.
test("a demo borough has the 12 tiles, tags among boroughs and its neighbourhood's strips", () => {
  const standouts = readStandouts(fixtureStandouts("uk:lad:E09000001"), "demo");
  assert.ok(standouts);
  assert.equal(standouts.carrier, "lad");
  assert.deepEqual(standouts.tiles.map((tile) => tile.id), [...STANDOUT_TILE_IDS]);
  assert.ok(standouts.tags.every((tag) => !/ of London$/.test(tag.text)));
  assert.equal(standouts.neighbourhoods?.[0].geographyId, "uk:lsoa:E01000001");
  assert.equal(fixtureStandouts("uk:lad:E09999999"), null);
});

const row = (name: string, price: number | null, safety: number | null, schools: number | null): BoroughAreaRow => ({
  id: `uk:lsoa:E0100${name.length}` as BoroughAreaRow["id"], name, note: null, href: "/", price, priceDisplay: "", pricePosition: null, safety, schools,
});

test("the Areas list sorts dearest, safest, best schools or A to Z, an unknown figure last", () => {
  const rows = [row("Acton", 5000, 40, null), row("Brentham", 7000, 80, 60), row("Cuckoo", null, 90, 95)];
  assert.deepEqual(sortBoroughAreas(rows, "price").map((entry) => entry.name), ["Brentham", "Acton", "Cuckoo"]);
  assert.deepEqual(sortBoroughAreas(rows, "crime").map((entry) => entry.name), ["Cuckoo", "Brentham", "Acton"]);
  assert.deepEqual(sortBoroughAreas(rows, "schools").map((entry) => entry.name), ["Cuckoo", "Brentham", "Acton"]);
  assert.deepEqual(sortBoroughAreas(rows, "name").map((entry) => entry.name), ["Acton", "Brentham", "Cuckoo"]);
  assert.equal(boroughAreaSortParam("schools"), "schools");
  assert.equal(boroughAreaSortParam("income"), "price", "income never sorts the list");
  assert.equal(boroughAreaSortParam(undefined), "price");
});

// v4.5 (round-2 findings 8 and 16): one distinct name per row, never "Ealing 034A/B/C".
test("neighbourhoods sharing their wider neighbourhood's name are one row for it, with no code", () => {
  const data = demoAreaPagesData();
  const msoa = "uk:msoa:E02000001" as BoroughAreaRow["id"];
  const extra = ["uk:lsoa:E01000091", "uk:lsoa:E01000092"] as BoroughAreaRow["id"][];
  const price = (id: BoroughAreaRow["id"], value: number, regionPercentile: number) =>
    ({ geographyId: id, value, regionPercentile, period: "2026-06" }) as never;
  const areas = [...data.areas, ...extra.map((id, n) => ({
    geographyId: id, name: `Westminster preview 00${n + 1}B`, carrier: "lsoa" as const, parentId: msoa, schools: null,
    friendlyName: "St James's", postcodeDistrict: "SW1A",
  }))];
  const values = { ...data.values, "price-per-square-metre": [
    ...(data.values["price-per-square-metre"] ?? []).filter((entry) => !extra.includes(entry.geographyId as BoroughAreaRow["id"])),
    price(extra[0], 9_000, 90), price(extra[1], 11_000, 98),
  ] };
  const rows = boroughAreaRows(buildIndex({ ...data, areas, values }), "uk:lad:E09000001");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].href, "/area/msoa/E02000001");
  assert.equal(rows[0].name, "St James's · SW1A");
  assert.equal(rows[0].note, "3 neighbourhoods");
  assert.ok(rows[0].price !== null && rows[0].priceDisplay.startsWith("£"));
  for (const row of rows) assert.doesNotMatch(`${row.name} ${row.note ?? ""}`, /\d{3}[A-Z]\b/);
});

test("each neighbourhood row carries its price and London strips from the area figures", () => {
  const index = buildIndex(demoAreaPagesData());
  const strips = fixtureStandouts("uk:lad:E09000001")?.neighbourhoods ?? [];
  const [first, ...rest] = boroughAreaRows(index, "uk:lad:E09000001", strips);
  assert.equal(rest.length, 0);
  assert.equal(first.href, "/area/lsoa/E01000001");
  assert.ok(first.price !== null && first.priceDisplay.startsWith("£"));
  assert.equal(first.schools, strips[0].schoolStanding);
});
