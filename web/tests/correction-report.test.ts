import assert from "node:assert/strict";
import test from "node:test";

import {
  correctionRoute,
  prepareCorrectionReport,
} from "../src/lib/correction-report";

const CANARY_LABEL = "Canary Employer AE-32";
const CANARY_BUDGET = 617343;
const CANARY_LAT = 51.501234;

function canaryPayload() {
  return {
    observationId: "uk:lsoa:E01000004:crime:2026-06",
    productReleaseId: "product-2026-07",
    sourceReleaseId: "police-uk-2026-08",
    kind: "publisher-error",
    // Raw search-profile fields must never survive preparation.
    market: "buy",
    maximumBudget: CANARY_BUDGET,
    commuteDestinations: [{
      label: CANARY_LABEL, latitude: CANARY_LAT, longitude: -0.141567,
      mode: "transit",
    }],
    destinationModes: ["transit"],
    factors: [{ factorId: "crime", weight: 3 }],
  } as unknown as Parameters<typeof prepareCorrectionReport>[0];
}

test("correction preparation keeps provenance ids and an optional description", () => {
  const report = prepareCorrectionReport({
    observationId: "uk:lsoa:E01000004:crime:2026-06",
    productReleaseId: "product-2026-07",
    sourceReleaseId: "police-uk-2026-08",
    kind: "publisher-error",
    description: "Force total looks low against the publisher bulletin.",
  });

  assert.equal(report.observationId, "uk:lsoa:E01000004:crime:2026-06");
  assert.equal(report.productReleaseId, "product-2026-07");
  assert.equal(report.sourceReleaseId, "police-uk-2026-08");
  assert.equal(report.kind, "publisher-error");
  assert.match(report.description ?? "", /Force total/);
});

test("publisher and transformation errors route differently", () => {
  const publisher = prepareCorrectionReport({
    sourceReleaseId: "police-uk-2026-08", kind: "publisher-error",
  });
  const transformation = prepareCorrectionReport({
    sourceReleaseId: "police-uk-2026-08", kind: "transformation-error",
  });

  assert.equal(publisher.route, "publisher");
  assert.equal(transformation.route, "transformation");
  assert.equal(correctionRoute("publisher-error"), "publisher");
  assert.equal(correctionRoute("transformation-error"), "transformation");
});

test("a correction needs an observation or release id, and a known kind", () => {
  assert.throws(
    () => prepareCorrectionReport({ kind: "publisher-error" }),
    /observation or release/,
  );
  assert.throws(
    () => prepareCorrectionReport({
      sourceReleaseId: "police-uk-2026-08", kind: "stale-data" as never,
    }),
    /kind/,
  );
});

test("preparation never includes the raw profile or destinations", () => {
  const encoded = JSON.stringify(prepareCorrectionReport(canaryPayload()));

  for (const secret of [CANARY_LABEL, String(CANARY_BUDGET), String(CANARY_LAT)]) {
    assert.ok(!encoded.includes(secret), `correction leaks ${secret}`);
  }
  assert.ok(!encoded.includes("commuteDestinations"));
  assert.ok(!encoded.includes("maximumBudget"));
});
