import assert from "node:assert/strict";
import test from "node:test";

import {
  civicBreadcrumb, civicCodes, civicPath, formatCivicDate, formatCouncilTax, formatShare, otherWards, readCivic,
  type CivicResponse,
} from "../src/lib/civic";
import { fixtureAreaCivic, fixturePostcodeCivic } from "../src/lib/civic-fixture";

function lsoa(): CivicResponse {
  const civic = fixtureAreaCivic("uk:lsoa:E01000001");
  assert.ok(civic);
  return civic;
}

test("demo civic exists for every preview area and postcode, and nothing else", () => {
  for (const kind of ["lsoa", "msoa", "lad"] as const) {
    const prefix = { lsoa: "E01", msoa: "E02", lad: "E09" }[kind];
    for (const index of [1, 2, 3]) assert.ok(fixtureAreaCivic(`uk:${kind}:${prefix}00000${index}`), `${kind} ${index}`);
  }
  assert.equal(fixtureAreaCivic("uk:lsoa:E01000004"), null);
  assert.equal(fixturePostcodeCivic("sw1a1aa")?.subject.postcode, "SW1A 1AA");
  assert.equal(fixturePostcodeCivic("E1 6AN"), null);
});

test("council tax bands follow the band D ratios", () => {
  const bands = lsoa().councilTax?.bands ?? [];
  assert.deepEqual(bands.map((band) => band.band), ["A", "B", "C", "D", "E", "F", "G", "H"]);
  const d = bands[3].amount ?? 0;
  assert.equal(bands[0].amount, Math.round(d * 6 / 9 * 100) / 100);
  assert.equal(bands[7].amount, d * 2);
});

test("real mode rejects demo data; malformed and empty payloads are unavailable", () => {
  assert.equal(readCivic(lsoa(), "demo").status, "available");
  assert.equal(readCivic(lsoa(), "real").status, "unavailable");
  assert.equal(readCivic({ schemaVersion: "area-profile.v1" }, "demo").status, "unavailable");
  assert.deepEqual(readCivic({ ...lsoa(), available: false }, "demo"), { status: "unavailable", reason: "no-civic-data" });
});

test("breadcrumb runs England › London › borough › ward › area", () => {
  assert.deepEqual(civicBreadcrumb(lsoa()).map((crumb) => crumb.label),
    ["England", "London", "Westminster preview borough", "Westminster preview central ward", "Westminster preview"]);
  const postcode = fixturePostcodeCivic("WC1A 1AA");
  assert.ok(postcode);
  assert.equal(civicBreadcrumb(postcode).at(-1)?.label, "WC1A 1AA");
  const borough = fixtureAreaCivic("uk:lad:E09000002");
  assert.ok(borough);
  assert.equal(civicBreadcrumb(borough).length, 3);
});

test("an unknown ward reads as unknown, never as a blank", () => {
  const civic = { ...lsoa(), place: { ...lsoa().place, ward: null } };
  assert.equal(civicBreadcrumb(civic)[3].label, "Ward unknown");
  assert.equal(civicCodes(civic).find((row) => row.label === "Ward")?.code, null);
  assert.equal(formatCouncilTax(null), "unknown");
  assert.equal(formatCivicDate(null), "unknown");
});

test("codes list fits the subject and names a parish only when there is one", () => {
  const labels = (civic: CivicResponse) => civicCodes(civic).map((row) => row.label);
  assert.ok(labels(lsoa()).includes("Lower layer area (LSOA)"));
  assert.ok(!labels(lsoa()).includes("Parish"));
  const parished = { ...lsoa(), place: { ...lsoa().place, parish: { code: "E04013089", name: "Queen's Park" } } };
  assert.ok(labels(parished).includes("Parish"));
  const borough = fixtureAreaCivic("uk:lad:E09000001");
  assert.ok(borough);
  assert.deepEqual(labels(borough), ["Region", "Borough (council)", "Parliamentary constituency", "Police force"]);
});

test("other wards list the rest of a split area with their shares", () => {
  const split = { ...lsoa(), wards: [
    { code: "E05000001", name: "Main", share: 0.8 }, { code: "E05000002", name: "Edge", share: 0.2 },
  ] };
  assert.deepEqual(otherWards(split).map((ward) => ward.name), ["Edge"]);
  assert.equal(formatShare(0.2), "20%");
  assert.equal(formatShare(0.004), "under 1%");
});

test("paths and dates", () => {
  assert.equal(civicPath({ geographyId: "uk:lsoa:E01000001" }), "/api/v1/areas/uk%3Alsoa%3AE01000001/civic");
  assert.equal(civicPath({ postcode: "SW1A 1AA" }), "/api/v1/postcodes/SW1A1AA/civic");
  assert.equal(formatCivicDate("2026-10-05"), "5 October 2026");
  assert.equal(formatCivicDate("1980-01"), "January 1980");
  assert.equal(formatCouncilTax(1049.5), "£1,049.50");
});
