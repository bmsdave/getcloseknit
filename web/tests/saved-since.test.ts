import assert from "node:assert/strict";
import test from "node:test";

import { fixtureAreaSince } from "../src/lib/market-fixture";
import { fixtureStandouts } from "../src/lib/standouts-fixture";
import {
  baselineFor, localDay, parseSinceStore, recordVisit, serializeSinceStore, sinceLine, sincePath, sinceQueryDate,
  type AreaSinceResponse, type SinceRecord,
} from "../src/lib/saved-since";

const AREA = "uk:lsoa:E01000001" as const;

function answer(overrides: Partial<AreaSinceResponse> = {}, ppm: number | null = 8_200, windowEnd = "2026-08"): AreaSinceResponse {
  return {
    schemaVersion: "area-since.v1", geographyId: AREA, date: "2026-07-31",
    basis: { geographyId: AREA, name: "Sample", carrier: "lsoa", widened: false, minimumSales: 10 },
    months: 18, newSales: 0, newestSale: "2026-08-20", pricePerSquareMetre: { median: ppm, windowEnd, sales: 40 },
    sourceVersion: "src", attribution: "HM Land Registry", caveats: [], ...overrides,
  };
}

const SEEN = { on: "2026-10-12", newest: "2026-07-31", ppm: 8_000, windowEnd: "2026-07" };

test("the line names new sales and the £/m² move since the last visit, never on a first visit", () => {
  assert.equal(sinceLine(null, answer({ newSales: 4 })), null);
  assert.deepEqual(sinceLine(SEEN, answer({ newSales: 3 })), { text: "Since 12 Oct: 3 new sales · £/m² up 3%", changed: true });
  assert.deepEqual(sinceLine(SEEN, answer({ newSales: 1 }, 7_600)), { text: "Since 12 Oct: 1 new sale · £/m² down 5%", changed: true });
  // The same 12-month window: no move, whatever the rounding.
  assert.deepEqual(sinceLine(SEEN, answer({}, 8_400, "2026-07")), { text: "No change since 12 Oct", changed: false });
  // Under half a percent reads as no change; an unknown median says nothing about price.
  assert.deepEqual(sinceLine(SEEN, answer({}, 8_030)), { text: "No change since 12 Oct", changed: false });
  assert.deepEqual(sinceLine({ ...SEEN, ppm: null }, answer({ newSales: 2 })), { text: "Since 12 Oct: 2 new sales", changed: true });
  assert.deepEqual(sinceLine(SEEN, answer({}, null)), { text: "No change since 12 Oct", changed: false });
});

test("a visit is a day: the same day keeps comparing with the visit before", () => {
  const today = "2026-10-19";
  // First visit: nothing to compare, the record is today's.
  assert.equal(baselineFor(undefined, today), null);
  const first = recordVisit(undefined, answer(), today);
  assert.deepEqual(first, { on: today, newest: "2026-08-20", ppm: 8_200, windowEnd: "2026-08" });
  // A later day compares with the last visit and keeps it as the one before.
  const record: SinceRecord = { ...SEEN };
  assert.deepEqual(baselineFor(record, today), SEEN);
  assert.equal(sinceQueryDate(baselineFor(record, today), today), "2026-07-31");
  const next = recordVisit(record, answer(), today);
  assert.deepEqual(next.previous, SEEN);
  // Again today: still against 12 Oct, and the record keeps it.
  assert.deepEqual(baselineFor(next, today), SEEN);
  assert.deepEqual(recordVisit(next, answer({ newestSale: null }), today).previous, SEEN);
  assert.equal(recordVisit(next, answer({ newestSale: null }), today).newest, "2026-08-20");
  assert.equal(sinceQueryDate({ ...SEEN, newest: null }, today), "2026-10-12");
});

test("the stored document round-trips and drops what it can't read", () => {
  const store = { [AREA]: { ...SEEN, on: "2026-10-19", previous: SEEN } };
  assert.deepEqual(parseSinceStore(serializeSinceStore(store)), store);
  assert.deepEqual(parseSinceStore(null), {});
  assert.deepEqual(parseSinceStore("{not json"), {});
  assert.deepEqual(parseSinceStore(JSON.stringify({ schemaVersion: "other", areas: store })), {});
  const messy = JSON.stringify({ schemaVersion: "saved-since.v1", areas: {
    [AREA]: { on: "2026-10-12", newest: "soon", ppm: -3, windowEnd: 7 },
    "uk:lsoa:nope": SEEN,
    "uk:msoa:E02000001": { on: "yesterday" },
  } });
  assert.deepEqual(parseSinceStore(messy), { [AREA]: { on: "2026-10-12", newest: null, ppm: null, windowEnd: null } });
});

test("the request carries the area and a date only, and the demo answer counts sales after it", () => {
  assert.equal(sincePath(AREA, "2026-07-31"), "/api/v1/areas/uk%3Alsoa%3AE01000001/since?date=2026-07-31");
  assert.match(localDay(new Date(2026, 0, 5)), /^2026-01-05$/);
  const all = fixtureAreaSince(AREA, "2000-01-01")!;
  const later = fixtureAreaSince(AREA, "2026-05-31")!;
  assert.equal(all.schemaVersion, "area-since.v1");
  assert.ok(all.newSales > later.newSales && later.newSales > 0);
  assert.equal(fixtureAreaSince(AREA, all.newestSale!)!.newSales, 0);
  // v4.6: the area's own Price tile (the figure Saved shows on the row), not the widened market median.
  const tile = fixtureStandouts(AREA)!.tiles.find((entry) => entry.id === "price")!;
  assert.deepEqual(all.pricePerSquareMetre, { median: tile.value, windowEnd: tile.period, sales: null });
  assert.ok(typeof tile.value === "number" && tile.period === "2026-06");
  assert.equal(fixtureAreaSince("uk:lsoa:E09999999", "2026-01-01"), null);
});

test("a v1 document's £/m² (the market median, another series) is forgotten; its sales baseline stays", () => {
  const v1 = JSON.stringify({ schemaVersion: "saved-since.v1", areas: { [AREA]: { ...SEEN, on: "2026-10-19", previous: SEEN } } });
  const store = parseSinceStore(v1);
  assert.deepEqual(store[AREA], {
    on: "2026-10-19", newest: "2026-07-31", ppm: null, windowEnd: null,
    previous: { on: "2026-10-12", newest: "2026-07-31", ppm: null, windowEnd: null },
  });
  // So the next line names new sales only, never a move against the old series.
  assert.deepEqual(sinceLine(baselineFor(store[AREA], "2026-10-20"), answer({ newSales: 2 }, 12_000, "2026-09")),
    { text: "Since 19 Oct: 2 new sales", changed: true });
  assert.match(serializeSinceStore(store), /"schemaVersion":"saved-since.v2"/);
});
