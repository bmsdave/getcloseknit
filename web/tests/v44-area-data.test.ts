// v4.4 area-data fixes from the final prod check: My location allowed for the site itself, never an
// empty ?period=, London shares capped at 99%, borough "with a price" counted over its neighbourhoods,
// one naming source for the map panel's crumbs, and each place listed once on /places.
import assert from "node:assert/strict";
import test from "node:test";

import config from "../next.config";
import { widerCrumbs } from "../src/lib/area-labels";
import { neighbourhoodsWithPrice, type AreaIndex, type HierarchyArea } from "../src/lib/area-pages";
import { regionShare } from "../src/lib/evidence-format";
import { areaCrumbs } from "../src/lib/entity-nav";
import { planEvidenceRequest } from "../src/lib/map-state";
import { versusLondon } from "../src/lib/overview-text";
import { natureValueText } from "../src/lib/nature-layers";
import { groupPlaces, type AmenityGroupSummary } from "../src/lib/places";
import { ratingModel } from "../src/lib/rating";

test("the site may ask for the visitor's location (Permissions-Policy geolocation=(self))", async () => {
  const env = process.env as Record<string, string | undefined>;
  const before = env.NODE_ENV;
  env.NODE_ENV = "production"; // the security headers are production's
  let rules: Awaited<ReturnType<NonNullable<typeof config.headers>>>;
  try {
    rules = await config.headers!();
  } finally {
    env.NODE_ENV = before;
  }
  const policy = rules.flatMap((rule) => rule.headers).find((header) => header.key === "Permissions-Policy")?.value ?? "";
  assert.match(policy, /geolocation=\(self\)/);
  assert.match(policy, /camera=\(\)/);
});

test("an area's evidence is never asked with an empty period", () => {
  const ask = (period: string) => planEvidenceRequest({
    selected: "uk:lsoa:E01002776", layer: "price-per-square-metre", layerLabel: "Price per m²",
    metric: "price-per-square-metre", period, mode: "real", release: "r1",
  });
  assert.deepEqual(ask(""), { kind: "idle" });
  const planned = ask("2026-06");
  assert.equal(planned.kind, "fetch");
  assert.match(planned.kind === "fetch" ? planned.path : "", /period=2026-06/);
});

test("a London share reads 1–99%, never 100% or 0%", () => {
  assert.deepEqual([100, 99.6, 0, 0.3, 62].map(regionShare), [99, 99, 1, 1, 62]);
  assert.equal(versusLondon(100, "more crime than", "less crime than"), "more crime than 99% of London areas");
  assert.equal(versusLondon(0, "more crime than", "less crime than"), "less crime than 99% of London areas");
  assert.equal(ratingModel(99.7, null, "pricier").band, "pricier than 99% of London");
  assert.equal(natureValueText("nature-score", 100), "Greener than 99% of London");
});

test("a borough's neighbourhoods with a price are counted over its neighbourhoods", () => {
  const values = new Map([["uk:lsoa:A", { value: 9000 }], ["uk:lsoa:B", { value: null }], ["uk:lsoa:C", { value: 8000 }]]);
  const index = { values: { "price-per-square-metre": values } } as unknown as AreaIndex;
  const lsoas = ["uk:lsoa:A", "uk:lsoa:B", "uk:lsoa:C"].map((geographyId) => ({ geographyId })) as { geographyId: `uk:lsoa:${string}` }[];
  assert.equal(neighbourhoodsWithPrice(index, lsoas), "3 · 2 with a price");
  assert.equal(neighbourhoodsWithPrice(index, [lsoas[0], lsoas[2]]), "2");
});

test("the map panel's crumbs use the area page's names: no district, no generic label, no repeats", () => {
  // Nearest first, as read up the hierarchy.
  const euston = [
    { id: "uk:msoa:E02000170", carrier: "msoa", name: "Euston" },
    { id: "uk:lad:E09000007", carrier: "lad", name: "Camden" },
  ];
  assert.deepEqual(widerCrumbs(euston, "Euston").map((crumb) => crumb.label), ["Camden"]);
  assert.deepEqual(widerCrumbs(euston, "Somers Town").map((crumb) => crumb.label), ["Camden", "Euston"]);
  const city = [
    { id: "uk:msoa:E02000001", carrier: "msoa", name: "City of London" },
    { id: "uk:lad:E09000001", carrier: "lad", name: "City of London" },
  ];
  assert.deepEqual(widerCrumbs(city, "City of London").map((crumb) => crumb.label), ["City of London"]);
  // An official code is never a crumb.
  assert.deepEqual(widerCrumbs([{ id: "m", carrier: "msoa", name: "Camden 012" }, { id: "b", carrier: "lad", name: "Camden" }], "Euston")
    .map((crumb) => crumb.label), ["Camden"]);
});

test("the area page's breadcrumbs never repeat a name", () => {
  const area = (geographyId: string, name: string, carrier: HierarchyArea["carrier"], parentId: string | null, friendlyName?: string) =>
    ({ geographyId, name, carrier, parentId, friendlyName, schools: null }) as HierarchyArea;
  const borough = area("uk:lad:E09000001", "City of London", "lad", null);
  const msoa = area("uk:msoa:E02000001", "City of London 001", "msoa", borough.geographyId, "City of London");
  const lsoa = area("uk:lsoa:E01000001", "City of London 001A", "lsoa", msoa.geographyId, "City of London");
  assert.deepEqual(areaCrumbs([borough, msoa, lsoa], "City of London").map((crumb) => crumb.label), ["London", "City of London"]);
});

test("/places lists each place once (a café is food too, a cocktail bar a pub too)", () => {
  const cafe = { name: "Urban Baristas", kind: "cafe", distanceMetres: 70, bearingDegrees: 10 };
  const bar = { name: "London Cocktail Club", kind: "bar", distanceMetres: 30, bearingDegrees: 200 };
  const food: AmenityGroupSummary = { group: "food", countWithinWalk: 5, nearest: [cafe, { name: "Dishoom", kind: "restaurant", distanceMetres: 90 }] };
  const cafes: AmenityGroupSummary = { group: "cafes", countWithinWalk: 2, nearest: [cafe] };
  const eat = groupPlaces([food, cafes], 12);
  assert.equal(eat.total, 5);
  assert.deepEqual(eat.nearest.map((place) => [place.name, place.group]), [["Urban Baristas", "cafes"], ["Dishoom", "food"]]);
  const pubs: AmenityGroupSummary = { group: "pubs", countWithinWalk: 4, nearest: [bar] };
  const bars: AmenityGroupSummary = { group: "bars", countWithinWalk: 1, nearest: [bar] };
  const out = groupPlaces([pubs, bars], 12);
  assert.equal(out.total, 4);
  assert.equal(out.nearest.length, 1);
});
