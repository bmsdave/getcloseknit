import { NATURE_METRIC_IDS } from "../src/lib/nature-layers";
import assert from "node:assert/strict";
import test from "node:test";

import { CENSUS_METRIC_IDS } from "../src/lib/census-layers";
import {
  addressId,
  assertAreaSummary,
  assertMetricDefinition,
  assertPreferenceProfile,
  fromAddressHistory,
  fromProfile,
  geographyId,
  schoolId,
  type PreferenceProfile,
} from "../src/lib/contracts";
import { DEFAULT_PROFILE, FACTORS, METRICS } from "../src/lib/fixtures";
import { demoPropertyProfile } from "../src/lib/property-profile-fixture";

test("geography IDs preserve the official code and carrier", () => {
  assert.equal(geographyId("lsoa", "E01000001"), "uk:lsoa:E01000001");
});

test("school IDs preserve the official URN", () => {
  assert.equal(schoolId("100001"), "uk:school:100001");
  assert.throws(() => schoolId("not-a-urn"), /invalid school URN/);
});

test("address IDs are stable hashes, never UPRNs", () => {
  assert.equal(addressId("uk:addr:a1b2c3d4e5f6"), "uk:addr:a1b2c3d4e5f6");
  assert.throws(() => addressId("100000000001"), /invalid address id/);
  assert.throws(() => addressId("uk:lsoa:E01000001"), /invalid address id/);
});

test("every metric and the Census layers satisfy the public metric contract", () => {
  assert.deepEqual(
    METRICS.map((metric) => assertMetricDefinition(metric).id),
    ["price-per-square-metre", "stock-value-per-square-metre", "crime", "deprivation", "income", "social-renting", "station-access",
      "food-hygiene", "noise", "road-collisions", "air-no2", "rent-change-1y", "rent-change-5y", "typical-price", "typical-price-flat", "typical-price-terraced", "typical-price-semi", "typical-price-detached",
      ...CENSUS_METRIC_IDS, ...NATURE_METRIC_IDS, "hpi-change-5y", "hpi-change-10y", "council-tax-band-mean", "ownership-company-share", "ownership-overseas-share", "short-lets-per-1000", "pipeline-homes-per-1000", "mobile-4g-indoor", "mobile-5g-outdoor", "future-station-distance", "hmo-per-1000",
      "typical-rent", "typical-rent-1-bed", "typical-rent-3-bed", "flood-risk", "good-schools-nearby", "good-schools-nearby-secondary", "student-share",
      "supermarket-walk", "gp-walk", "broadband-gigabit"],
  );
  for (const metric of METRICS) {
    assert.match(metric.provenance.checksum, /^[0-9a-f]{64}$/);
    assert.ok(metric.provenance.transformationVersion);
    assert.ok(metric.legend.every((stop) => stop.label.length > 0));
  }
});

test("area summaries expose raw values and both comparison baselines", () => {
  const summary = assertAreaSummary({
    geographyId: "uk:lsoa:E01000001",
    metricId: "crime",
    period: "2026-06",
    value: 42,
    regionPercentile: 60,
    countryPercentile: 45,
    sampleCount: 120,
    quality: "observed",
    sourceVersion: "police-uk-2026-06",
    carrier: "lsoa",
  });

  assert.equal(summary.regionPercentile, 60);
  assert.equal(summary.countryPercentile, 45);
});

test("metric definitions reject incomplete source provenance", () => {
  const invalid = structuredClone(METRICS[0]);
  invalid.provenance.checksum = "not-a-checksum";

  assert.throws(() => assertMetricDefinition(invalid), /provenance/);
});

test("twelve place factors and the local profile satisfy the public contract", () => {
  // Household income and social renting describe people, not places: no longer criteria. The official
  // deprivation decile is one again (user decision 2026-10-11).
  assert.equal(FACTORS.length, 12);
  assert.deepEqual(
    FACTORS.map((factor) => factor.id),
    [
      "affordability", "market-level", "growth-outlook", "crime", "deprivation", "commute", "schools", "station-access",
      "noise", "disorder", "epc-share", "leasehold-share",
    ],
  );
  // Quick criteria and deprivation are offered, not added: new profiles (and their links) keep seven.
  assert.equal(DEFAULT_PROFILE.factors.length, 7);
  // Find my area asks first: every priority starts Off; only the budget counts.
  assert.ok(DEFAULT_PROFILE.factors.every((factor) => factor.weight === (factor.factorId === "affordability" ? 3 : 0) && factor.minimumUtility === null));
  assert.equal(assertPreferenceProfile(DEFAULT_PROFILE).schemaVersion, "preference-profile.v1");
  assert.ok(DEFAULT_PROFILE.school.facetWeights.progress > 0);
  assert.deepEqual(DEFAULT_PROFILE.school.characteristics, []);
  assert.ok(FACTORS.every((factor) => factor.utilityDefinition && factor.periods.length));
});

test("house subtypes are an optional multi-select of terraced, semi and detached", () => {
  const profile = { ...structuredClone(DEFAULT_PROFILE), houseTypes: ["terraced", "detached"] } as PreferenceProfile;
  assert.deepEqual(assertPreferenceProfile(profile).houseTypes, ["terraced", "detached"]);
  for (const houseTypes of [["bungalow"], ["semi", "semi"], "semi"]) {
    assert.throws(() => assertPreferenceProfile({ ...structuredClone(DEFAULT_PROFILE), houseTypes } as unknown as PreferenceProfile), /house types must be/);
  }
});

test("preference-profile v1 migrates school facets without losing choices", () => {
  const legacy = structuredClone(DEFAULT_PROFILE) as PreferenceProfileWithoutFacets;
  delete legacy.school.characteristics;
  delete legacy.school.facetWeights;

  const migrated = assertPreferenceProfile(legacy as typeof DEFAULT_PROFILE);

  assert.deepEqual(migrated.school.characteristics, []);
  assert.equal(migrated.school.facetWeights.progress, 3);
  assert.deepEqual(migrated.school.phases, ["primary"]);
});

type PreferenceProfileWithoutFacets = Omit<typeof DEFAULT_PROFILE, "school"> & {
  school: Omit<typeof DEFAULT_PROFILE.school, "characteristics" | "facetWeights"> & {
    characteristics?: string[];
    facetWeights?: Record<string, number>;
  };
};

test("fromProfile turns a property profile into the sale record the home tools read", () => {
  const profile = demoPropertyProfile("100000000001")!.profile;
  const record = fromProfile(profile);

  assert.equal(record.address, profile.displayAddress);
  assert.equal(record.geographyId, profile.areas.lsoa.id);
  assert.equal(record.sourceVersion, profile.sourceVersion);
  assert.deepEqual(record.transactions, [
    { date: "2006-06-15", nominalPrice: 280_000, floorAreaSquareMetres: null },
    { date: "2022-11-03", nominalPrice: 570_000, floorAreaSquareMetres: 54 },
  ]);
});

test("fromAddressHistory keeps the address history's sales as they are", () => {
  const sale = { date: "2020-01-02", nominalPrice: 400_000, floorAreaSquareMetres: 50 };
  const record = fromAddressHistory({
    addressId: addressId("uk:addr:0123456789ab"), displayAddress: "1 Example Road", postcode: "N1 1AA",
    geographyId: "uk:lsoa:E01000001", saleCount: 1, coordinatesPrecision: "postcode", transactions: [sale],
    estimateDisclaimer: "", sourceVersion: "src-1",
  });

  assert.deepEqual(record, { address: "1 Example Road", geographyId: "uk:lsoa:E01000001", sourceVersion: "src-1", transactions: [sale] });
});
