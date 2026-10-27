import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertAreaResponse,
  assertPropertyHistoryResponse,
  type AreaResponse,
  type PropertyHistoryResponse,
} from "../src/lib/contracts";
import { formatEvidenceValue } from "../src/lib/evidence-format";
import { DATA_MODE_LABELS } from "../src/lib/map-state";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  "fixtures",
  "golden-v1",
);

function golden<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

test("real area responses decode with identical evidence", () => {
  const response = assertAreaResponse(golden<AreaResponse>("area-real.json"));

  assert.equal(response.summary.value, 48.5);
  assert.equal(response.summary.quality, "observed");
  assert.equal(response.summary.carrier, "lsoa");
  assert.equal(response.summary.breakdown?.burglary, 10.7);
  assert.equal(response.productReleaseId, "official-2026-06");
  assert.equal(response.metricTimeline.length, 2);
});

test("demo fallback carriers stay labelled with their carrier", () => {
  const raw = golden<Record<string, unknown>>("area-demo.json");
  const response = assertAreaResponse(raw as unknown as AreaResponse);

  assert.equal(response.summary.quality, "fallback");
  assert.equal(response.summary.carrier, "msoa");
  assert.equal(response.summary.breakdown?.matchedSales, 18);
  assert.equal(response.productReleaseId, undefined);
  assert.equal("dataMode" in raw, true);
  assert.equal("dataMode" in response.summary, false);
});

test("a missing valuation decodes as unavailable, never as zero", () => {
  const response = assertAreaResponse(golden<AreaResponse>("area-suppressed.json"));

  assert.equal(response.summary.quality, "suppressed");
  assert.equal(response.summary.value ?? null, null);
  assert.notEqual(response.summary.value ?? null, 0);
  assert.equal(formatEvidenceValue(response.summary.value ?? null, "£/year"), "Not published");
});

test("property identity survives the wire as a string", () => {
  const response = assertPropertyHistoryResponse(
    golden<PropertyHistoryResponse>("property-history.json"),
  );

  assert.equal(typeof response.history.uprn, "string");
  assert.equal(response.history.uprn, "100000000001");
  assert.equal(response.history.transactions.length, 2);
  assert.equal(response.history.transactions[1].localMarketAdjustedPrice ?? null, null);
  assert.ok(response.history.transactions.every((sale) => !("pricePerSquareMetre" in sale)), "no per-sale £/m²");
});

test("malformed responses are rejected, not defaulted", () => {
  assert.throws(
    () => assertAreaResponse(golden<AreaResponse>("malformed-area.json")),
    /geography ID|invalid/,
  );
  assert.throws(
    () => assertPropertyHistoryResponse(golden<PropertyHistoryResponse>("malformed-property.json")),
    /uprn/i,
  );
});

test("renamed percentiles carry the deprecated names' values (step R1)", () => {
  for (const name of ["area-real.json", "area-demo.json", "area-suppressed.json"]) {
    const raw = golden<{ summary: Record<string, unknown>; metricTimeline?: Record<string, unknown>[] }>(name);
    for (const row of [raw.summary, ...(raw.metricTimeline ?? [])]) {
      assert.equal(row.regionPercentile, row.londonPercentile, name);
      assert.equal(row.countryPercentile, row.englandPercentile, name);
    }
  }
});

test("existing v1 clients still decode without newer optional fields", () => {
  const response = assertAreaResponse(golden<AreaResponse>("area-old-client.json"));

  assert.equal(response.summary.value, 48.5);
  assert.equal(response.summary.breakdown, undefined);
  assert.equal(response.productReleaseId, undefined);
});

test("mode labels keep real and demo universes apart", () => {
  assert.match(DATA_MODE_LABELS.demo, /demo/i);
  assert.match(DATA_MODE_LABELS.real, /real/i);
});

test("openapi documents one wire shape per payload", () => {
  const spec = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "openapi.yaml"),
    "utf8",
  );

  assert.match(spec, /const: journey-result\.v1/);
  assert.doesNotMatch(spec, /const: journey\.v1/);
  assert.match(spec, /school-summary\.v1/);
  assert.match(spec, /versioning policy/i);
  assert.match(spec, /breakdown/);
});
