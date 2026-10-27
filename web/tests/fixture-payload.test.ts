import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId } from "../src/lib/contracts";
import { getAreaSummary } from "../src/lib/fixtures";
import { isFixturePayload, REAL_PILOT_RELEASE } from "../src/lib/map-state";

const CRIME_AREA = "uk:lsoa:E01000001" as GeographyId;

test("a preview summary is a fixture payload", () => {
  const summary = getAreaSummary(CRIME_AREA, "crime", "2026-06");
  assert.ok(summary);
  assert.equal(
    isFixturePayload({ summary, priceTimeline: [], metricTimeline: [] }),
    true,
  );
});

test("a clean summary with one fixture timeline entry is a fixture payload", () => {
  const summary = getAreaSummary(CRIME_AREA, "crime", "2026-06");
  assert.ok(summary);
  assert.equal(
    isFixturePayload({
      summary: { ...summary, sourceVersion: REAL_PILOT_RELEASE },
      priceTimeline: [],
      metricTimeline: [{ ...summary, sourceVersion: "preview-2026-06" }],
    }),
    true,
  );
});

test("an official payload without fixture versions is not a fixture payload", () => {
  const summary = getAreaSummary(CRIME_AREA, "crime", "2026-06");
  assert.ok(summary);
  assert.equal(
    isFixturePayload({
      summary: { ...summary, sourceVersion: REAL_PILOT_RELEASE },
      priceTimeline: [],
      metricTimeline: [{ ...summary, sourceVersion: REAL_PILOT_RELEASE }],
    }),
    false,
  );
});
