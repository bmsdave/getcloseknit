import assert from "node:assert/strict";
import test from "node:test";
import type { MultiPolygon, Polygon } from "geojson";
import { addressId } from "../src/lib/contracts";
import { areaGeoJson, getAddressHistory, parentGeographyId, searchFixtures } from "../src/lib/fixtures";

type AreaGeometry = Polygon | MultiPolygon;

function polygonsOf(geometry: AreaGeometry): number[][][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

test("preview analytics geometry cannot resemble placeholder squares", () => {
  for (const feature of areaGeoJson("lsoa").features) {
    for (const polygon of polygonsOf(feature.geometry)) {
      const ring = polygon[0];
      assert.ok(ring.length >= 7, `${feature.properties.name} needs a recognisable area outline`);
      assert.ok(new Set(ring.map(([longitude]) => longitude)).size > 2);
      assert.ok(new Set(ring.map(([, latitude]) => latitude)).size > 2);
    }
  }
});

test("multipart demo areas keep every island", () => {
  const southBank = areaGeoJson("lsoa").features.find(
    (feature) => feature.properties.geography_id === "uk:lsoa:E01000003",
  );
  assert.equal(southBank?.geometry.type, "MultiPolygon");
  assert.equal(polygonsOf(southBank.geometry).length, 2);
});

test("search resolves official codes at every carrier", () => {
  const cases: [string, string][] = [
    ["E01000001", "uk:lsoa:E01000001"],
    ["E02000001", "uk:msoa:E02000001"],
    ["E09000001", "uk:lad:E09000001"],
  ];
  for (const [query, geographyId] of cases) {
    assert.ok(
      searchFixtures(query).some((result) => result.geographyId === geographyId),
      `${query} must resolve to ${geographyId}`,
    );
  }
});

test("search resolves published demo names", () => {
  assert.ok(
    searchFixtures("South Bank preview").some((result) => result.geographyId === "uk:lsoa:E01000003"),
  );
});

test("parent navigation follows the published demo hierarchy", () => {
  assert.equal(parentGeographyId("uk:lsoa:E01000001"), "uk:msoa:E02000001");
  assert.equal(parentGeographyId("uk:msoa:E02000001"), "uk:lad:E09000001");
  assert.equal(parentGeographyId("uk:lad:E09000001"), null);
  assert.equal(parentGeographyId("uk:lsoa:E99999999"), null);
});

test("demo search surfaces a building address with a stable non-UPRN id", () => {
  const found = searchFixtures("SW1A").find((result) => result.addressId !== null);
  assert.ok(found);
  assert.equal(addressId(found?.addressId ?? ""), "uk:addr:a1b2c3d4e5f6");
  assert.equal(found?.geographyId, "uk:lsoa:E01000001");
  const history = getAddressHistory(found?.addressId ?? "");
  assert.equal(history?.transactions.length, 2);
  assert.equal(history?.transactions[0]?.nominalPrice, 280_000);
});
