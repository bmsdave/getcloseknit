import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import {
  circleRing, encodePolyline, filterWords, goDrawHref, goListingsHref, portalFilter, previewGoTarget, previewPortalLinks,
  searchId, titleDistrict, withSearchId,
} from "../src/lib/portal-zones";

// api/area_api/portal_zones.py and usage.go_target read the same fixture (api/tests/test_portal_zones.py).
const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/portal-zones.json", import.meta.url), "utf8")) as {
  polygon: { points: [number, number][]; polyline: string };
  goDraw: { portal: "zoopla"; filter: { market: "buy"; maxPrice: number; minBedrooms: number }; params: Record<string, string> };
  cases: { name: string; portal: string; params: Record<string, string>; target: string | null }[];
};

const params = (href: string) => Object.fromEntries(new URL(href, "https://example.invalid").searchParams);

test("the D1 box encodes to the checked polyline", () => {
  assert.equal(encodePolyline(fixture.polygon.points), fixture.polygon.polyline);
  assert.equal(encodePolyline([...fixture.polygon.points, fixture.polygon.points[0]]), fixture.polygon.polyline);
});

test("a draw link carries what the API's go_zone_url carries", () => {
  assert.deepEqual(params(goDrawHref(fixture.goDraw.portal, fixture.polygon.polyline, fixture.goDraw.filter)), fixture.goDraw.params);
});

for (const item of fixture.cases) {
  test(`/go target ${item.name} matches the shared fixture`, () => {
    assert.equal(previewGoTarget(item.portal, new URLSearchParams(item.params)), item.target);
  });
}

test("district links go through /go with the search's ceiling and bedrooms", () => {
  const filter = { market: "buy" as const, maxPrice: 650_000, minBedrooms: 2 };
  assert.equal(goListingsHref("zoopla", "e8", filter), "/go/zoopla?kind=listings&outcode=E8&market=buy&max_price=650000&beds=2&from=web");
  assert.equal(goListingsHref("zoopla", "not a code", filter), null);
  assert.equal(filterWords(filter), "Up to £650k · 2+ beds");
  assert.equal(filterWords({ market: "rent", maxPrice: 2500, minBedrooms: 0 }), "Up to £2,500 a month");
});

test("the search id is stable, short and only added to /go links", () => {
  const id = searchId(DEFAULT_PROFILE);
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(searchId(structuredClone(DEFAULT_PROFILE)), id);
  assert.notEqual(searchId({ ...DEFAULT_PROFILE, maximumBudget: DEFAULT_PROFILE.maximumBudget + 1 }), id);
  assert.equal(withSearchId("/go/rightmove?kind=zone", id), `/go/rightmove?kind=zone&sid=${id}`);
  assert.equal(withSearchId("https://www.rightmove.co.uk/", id), "https://www.rightmove.co.uk/");
  assert.equal(withSearchId("/go/rightmove?kind=zone", null), "/go/rightmove?kind=zone");
});

test("the preview answer draws polygons and preview stations; OnTheMarket gets districts", () => {
  const filter = portalFilter(DEFAULT_PROFILE);
  const answer = previewPortalLinks([
    { kind: "polygon", points: fixture.polygon.points, label: "Area I drew" },
    { kind: "station", stationId: "osm:n9000001", maxWalkMinutes: 10 },
    { kind: "borough", id: "uk:lad:E09000022" },
  ], filter);
  const [polygon, station, borough] = answer.zones;
  assert.equal(polygon.label, "Area I drew");
  assert.equal(params(polygon.portals[0].href!).poly, fixture.polygon.polyline);
  assert.equal(polygon.portals[2].href, null);
  assert.equal(params(station.portals[1].href!).shape, "draw");
  assert.deepEqual(borough.portals.map((entry) => entry.href), [null, null, null]);
});

test("a station's walk becomes a circle of 24 corners", () => {
  const ring = circleRing(51.5, -0.1, 800);
  assert.equal(ring.length, 24);
  assert.ok(Math.abs(Math.max(...ring.map(([lat]) => lat)) - 51.5 - 800 / 111_320) < 1e-4);
});

test("the district in a friendly title", () => {
  assert.equal(titleDistrict("Gillespie Road · N5"), "N5");
  assert.equal(titleDistrict("Haringey 019A"), null);
  assert.equal(titleDistrict(null), null);
});
