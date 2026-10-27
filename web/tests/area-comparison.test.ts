import assert from "node:assert/strict";
import test from "node:test";

import { buildAreaComparison, formatMoneyShort, rowWeightLabel } from "../src/lib/area-comparison";
import { previewBrief } from "../src/lib/brief-fixture";
import type { GeographyId, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { budgetsFor } from "../src/lib/needs-validation";
import { weightedProfile } from "./weighted-profile";
import { buildMatchPack, scoreMatchPack, type RawMatchArea, type RawMatchFactor, type RentContext } from "../src/lib/matching";

const EMPTY_RENT: RentContext = { observed: [], lsoaToBorough: {} };
const SHARED_BOROUGH: GeographyId = "uk:lad:E09000009";

function profileWith(weights: Record<string, number>): PreferenceProfile {
  const profile = weightedProfile();
  profile.commuteDestinations = [];
  for (const factor of profile.factors) {
    factor.weight = weights[factor.factorId] ?? 0;
    factor.minimumUtility = null;
    factor.maximumUtility = null;
  }
  return profile;
}

function factorEvidence(
  rawValue: number,
  percentile: number,
  carrier: GeographyId,
  sourceVersion = "test-release-2026-01",
): RawMatchFactor {
  return {
    rawValue,
    percentile,
    carrierGeographyId: carrier,
    quality: "observed",
    sourceVersion,
  };
}

function area(
  code: string,
  name: string,
  price: number,
  factors: RawMatchArea["factors"],
): RawMatchArea {
  return {
    geographyId: `uk:lsoa:${code}`,
    name,
    price,
    monthlyRent: 1800,
    journeys: {},
    factors,
  };
}

const NORTH = () => area("E01000011", "Northend", 400_000, {
  crime: factorEvidence(60, 20, "uk:lsoa:E01000011"),
  "market-level": factorEvidence(52_000, 62, "uk:msoa:E02000011"),
});
const SOUTH = () => area("E01000012", "Southend", 450_000, {
  crime: factorEvidence(130, 90, "uk:lsoa:E01000012"),
  "market-level": factorEvidence(43_000, 45, "uk:msoa:E02000012"),
});
const EAST = () => area("E01000013", "Eastend", 380_000, {
  crime: factorEvidence(80, 40, "uk:lsoa:E01000013"),
  "market-level": factorEvidence(48_000, 55, "uk:msoa:E02000013"),
});
const WEST = () => area("E01000014", "Westend", 420_000, {
  crime: factorEvidence(100, 60, "uk:lsoa:E01000014"),
  "market-level": factorEvidence(50_000, 58, "uk:msoa:E02000014"),
});

function crimeProfile(): PreferenceProfile {
  const profile = profileWith({ crime: 5 });
  profile.factors.find((factor) => factor.factorId === "crime")!.direction = "lower";
  return profile;
}

test("aligned rows keep raw costs, factors, carrier, and dates per area", () => {
  const profile = profileWith({ affordability: 3, crime: 3 });
  const pack = scoreMatchPack(profile, [NORTH(), SOUTH()], EMPTY_RENT);
  const comparison = buildAreaComparison(
    pack, ["uk:lsoa:E01000011", "uk:lsoa:E01000012"], profile,
  );

  assert.equal(comparison.columns.length, 2);
  assert.deepEqual(comparison.columns.map((column) => column.result.name), ["Northend", "Southend"]);
  const factorIds = comparison.rows.map((row) => row.factorId);
  assert.ok(factorIds.includes("affordability"));
  assert.ok(factorIds.includes("crime"));
  for (const row of comparison.rows) {
    assert.equal(row.cells.length, 2);
    for (const cell of row.cells) {
      if (cell.state === "observed") {
        assert.ok(cell.rawValue !== null && cell.unit !== null);
        assert.ok(cell.carrierGeographyId !== null && cell.sourceVersion !== null);
      } else {
        assert.equal(cell.rawValue, null);
      }
    }
  }
  assert.ok(comparison.conclusions.length > 0);
});

test("mixed carriers stay visible and shared borough evidence counts once", () => {
  const profile = profileWith({ crime: 3, "market-level": 3 });
  const shared = factorEvidence(100, 50, SHARED_BOROUGH, "ons-shared-2026-01");
  const pack = scoreMatchPack(profile, [
    { ...NORTH(), factors: { crime: shared, "market-level": NORTH().factors["market-level"] } },
    { ...SOUTH(), factors: { crime: { ...shared }, "market-level": SOUTH().factors["market-level"] } },
  ], EMPTY_RENT);
  const comparison = buildAreaComparison(
    pack, ["uk:lsoa:E01000011", "uk:lsoa:E01000012"], profile,
  );

  const income = comparison.rows.find((row) => row.factorId === "market-level")!;
  assert.deepEqual(income.cells.map((cell) => cell.carrierGeographyId),
    ["uk:msoa:E02000011", "uk:msoa:E02000012"]);
  const crime = comparison.rows.find((row) => row.factorId === "crime")!;
  assert.equal(crime.sharedEvidence, true);
  assert.equal(crime.materialDifference, null);
  assert.ok(comparison.conclusions.some((line) => line.includes("counted once")));
});

test("a missing factor stays unknown and never outranks an observed negative", () => {
  const profile = crimeProfile();
  const observedBad = area("E01000011", "Northend", 400_000, {
    crime: factorEvidence(190, 95, "uk:lsoa:E01000011"),
  });
  const unknown = area("E01000012", "Southend", 450_000, {});
  const pack = scoreMatchPack(profile, [observedBad, unknown], EMPTY_RENT);
  const comparison = buildAreaComparison(
    pack, ["uk:lsoa:E01000011", "uk:lsoa:E01000012"], profile,
  );

  const crime = comparison.rows.find((row) => row.factorId === "crime")!;
  assert.deepEqual(crime.cells.map((cell) => cell.state), ["observed", "unknown"]);
  assert.deepEqual(crime.cells.map((cell) => cell.leader), [true, false]);
  assert.ok(comparison.conclusions.some((line) =>
    line.includes("Southend") && line.includes("unknown")));
  assert.ok(!comparison.conclusions.some((line) => /^Southend leads/.test(line)));
});

test("tied scores name every tied area instead of crowning one", () => {
  const profile = profileWith({ affordability: 5 });
  const pack = scoreMatchPack(profile, [
    area("E01000011", "Northend", 400_000, {}),
    area("E01000012", "Southend", 400_000, {}),
  ], EMPTY_RENT);
  assert.equal(pack.values[0].score, pack.values[1].score);
  const comparison = buildAreaComparison(
    pack, ["uk:lsoa:E01000011", "uk:lsoa:E01000012"], profile,
  );

  assert.ok(comparison.conclusions.some((line) =>
    line.includes("Northend") && line.includes("Southend") && /tie/i.test(line)));
});

test("excluded areas are shown with reasons and never lead on score", () => {
  const profile = profileWith({ affordability: 5 });
  profile.targetBudget = 300_000;
  profile.maximumBudget = 500_000;
  profile.factors.find((factor) => factor.factorId === "affordability")!.minimumUtility = 80;
  const pack = scoreMatchPack(profile, [
    // A Must budget keeps areas within the maximum (v4 Task 21): Northend's £600k is out.
    area("E01000011", "Northend", 600_000, {}),
    area("E01000012", "Southend", 300_000, {}),
  ], EMPTY_RENT);
  const comparison = buildAreaComparison(
    pack, ["uk:lsoa:E01000011", "uk:lsoa:E01000012"], profile,
  );

  const north = comparison.columns.find((column) => column.result.name === "Northend")!;
  assert.ok(north.result.excluded);
  assert.ok(north.reasons.length > 0);
  assert.ok(comparison.conclusions.some((line) =>
    line.includes("Southend") && line.includes("leads")));
  assert.ok(!comparison.conclusions.some((line) => /^Northend leads/.test(line)));
});

test("a release mismatch across the shortlist is rejected", () => {
  const profile = profileWith({ affordability: 3 });
  const pack = scoreMatchPack(profile, [NORTH(), SOUTH()], EMPTY_RENT);
  const mixed = structuredClone(pack);
  mixed.values[1].sourceReleaseSet = "another-release-2026-01";

  assert.throws(() => buildAreaComparison(
    mixed, ["uk:lsoa:E01000011", "uk:lsoa:E01000012"], profile,
  ), /release-mismatch/);
});

test("comparison needs two to four known areas", () => {
  const profile = profileWith({ affordability: 3 });
  const pack = scoreMatchPack(profile, [NORTH(), SOUTH()], EMPTY_RENT);

  assert.throws(() => buildAreaComparison(pack, ["uk:lsoa:E01000011"], profile), /at least two/);
  assert.throws(() => buildAreaComparison(pack,
    ["uk:lsoa:E01000011", "uk:lsoa:E01000012", "uk:lsoa:E01000013", "uk:lsoa:E01000014", "uk:lsoa:E01000015"],
    profile), /at most four/);
  assert.throws(() => buildAreaComparison(pack, ["uk:lsoa:E01000011", "uk:lsoa:E01000999"], profile), /unknown area/);
  assert.throws(() => buildAreaComparison(pack,
    ["uk:lsoa:E01000011", "uk:lsoa:E01000011"], profile), /duplicate/);
});

test("four areas build four columns with shared-library conclusions", () => {
  const profile = profileWith({ crime: 3, "market-level": 3 });
  const pack = scoreMatchPack(profile, [NORTH(), SOUTH(), EAST(), WEST()], EMPTY_RENT);
  const comparison = buildAreaComparison(pack,
    ["uk:lsoa:E01000011", "uk:lsoa:E01000012", "uk:lsoa:E01000013", "uk:lsoa:E01000014"],
    profile);
  assert.equal(comparison.columns.length, 4);
  assert.deepEqual(
    comparison.columns.map((column) => column.result.name),
    ["Northend", "Southend", "Eastend", "Westend"],
  );
  assert.ok(comparison.rows.every((row) => row.cells.length === 4));
  assert.ok(comparison.conclusions.some((line) => /leads|tie/i.test(line)));
});

test("changing one weight updates the conclusions", () => {
  const light = profileWith({ affordability: 3, crime: 3 });
  const heavy = profileWith({ affordability: 3, crime: 3, "market-level": 5 });
  const pack = scoreMatchPack(light, [NORTH(), SOUTH()], EMPTY_RENT);
  const before = buildAreaComparison(pack, ["uk:lsoa:E01000011", "uk:lsoa:E01000012"], light);
  const after = buildAreaComparison(pack, ["uk:lsoa:E01000011", "uk:lsoa:E01000012"], heavy);

  assert.notDeepEqual(after.conclusions, before.conclusions);
  assert.ok(after.rows.some((row) => row.factorId === "market-level" && row.weight === 5));
});

test("small utility gaps are not presented as material differences", () => {
  const profile = profileWith({ "market-level": 5 });
  const pack = scoreMatchPack(profile, [
    area("E01000011", "Northend", 400_000, { "market-level": factorEvidence(52_000, 62, "uk:msoa:E02000011") }),
    area("E01000012", "Southend", 450_000, { "market-level": factorEvidence(51_000, 60, "uk:msoa:E02000012") }),
  ], EMPTY_RENT);
  const comparison = buildAreaComparison(
    pack, ["uk:lsoa:E01000011", "uk:lsoa:E01000012"], profile,
  );

  assert.equal(comparison.rows.find((row) => row.factorId === "market-level")!.materialDifference, null);
});

test("preview areas compare on the same release with real score leadership", () => {
  const profile = weightedProfile();
  const pack = buildMatchPack(profile);
  const comparison = buildAreaComparison(pack,
    ["uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003"], profile);

  assert.equal(comparison.release, pack.sourceReleaseSet);
  assert.equal(comparison.columns.length, 3);
  assert.ok(comparison.conclusions.some((line) => /leads|tie/i.test(line)));
});

// Review #2: compare shows the result card's figures — the search brief's ballpark price and the
// place minutes — against the household's limit, with carriers and releases kept for "Sources".
test("compare shows the card's price and place minutes against the household's limits", () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  Object.assign(profile, budgetsFor(600_000));
  profile.places = [{
    id: "work", label: "Office", target: { kind: "point", latitude: 51.501, longitude: -0.1416 },
    mode: "transit", targetMinutes: 45, weight: 3, must: false,
  }];
  const ids: GeographyId[] = ["uk:lsoa:E01000002", "uk:lsoa:E01000003"];
  const pack = buildMatchPack(profile);
  const brief = previewBrief(ids, [profile.targetBudget, profile.maximumBudget], profile.bedrooms)!;
  const comparison = buildAreaComparison(pack, ids, profile, { brief });

  const price = comparison.rows.find((row) => row.factorId === "affordability")!;
  assert.equal(price.label, "Price");
  const north = brief.areas.find((entry) => entry.geographyId === ids[0])!;
  assert.equal(price.cells[0].display, `~£${Math.round(north.estimatedPrice! / 1000)}k`);
  assert.match(price.cells[0].note, /^estimate · within your £600k limit/);
  // Over the limit, the note says by how much.
  const tight = { ...profile, maximumBudget: 400_000 };
  const over = buildAreaComparison(buildMatchPack(tight), ids, tight, { brief }).rows.find((row) => row.factorId === "affordability")!;
  assert.match(over.cells[0].note, /^estimate · £40k over your £400k limit/);
  const place = comparison.rows.find((row) => row.factorId === "place:work")!;
  const minutes = pack.values.find((result) => result.geographyId === ids[0])!
    .components.find((component) => component.factorId === "place:work")!.rawValue;
  assert.equal(place.label, "Office");
  assert.equal(place.cells[0].display, `${Math.round(minutes)} min`);
  assert.match(place.cells[0].note, /^(within|over) your 45 min/);

  // Defaults sit outside the score, and no internal id or bare "budget fit" reaches the reader.
  assert.ok(comparison.rows.filter((row) => row.weight === 0).some((row) => row.factorId === "commute"));
  const visible = [...comparison.conclusions, ...comparison.rows.flatMap((row) => row.cells.flatMap((cell) => [cell.display, cell.note]))].join("\n");
  assert.doesNotMatch(visible, /uk:lsoa|preview-|budget fit/);
  assert.match(price.cells[0].source ?? "", /LSOA E01000002/);

  // The decision brief keeps the place's label private unless destinations are included.
  const redacted = buildAreaComparison(pack, ids, profile, { brief, redactPlaces: true });
  assert.equal(redacted.rows.find((row) => row.factorId === "place:work")!.label, "Your place 1");
});

test("money reads short: £600k, £1.25m, £950", () => {
  assert.equal(formatMoneyShort(600_000), "£600k");
  assert.equal(formatMoneyShort(686_400), "£686k");
  assert.equal(formatMoneyShort(1_250_000), "£1.25m");
  assert.equal(formatMoneyShort(2_000_000), "£2m");
  assert.equal(formatMoneyShort(950), "£950");
});

test("a weight nobody picked reads as the standard weight", () => {
  // The budget counts at 3 by default; a factor the household turned on reads its own weight.
  assert.equal(rowWeightLabel({ factorId: "affordability", weight: 3 }), "standard weight (you can change it)");
  assert.equal(rowWeightLabel({ factorId: "affordability", weight: 5 }), "matters 5 of 5");
  assert.equal(rowWeightLabel({ factorId: "crime", weight: 3 }), "matters 3 of 5");
  assert.equal(rowWeightLabel({ factorId: "crime", weight: 0 }), "not counted");
  assert.equal(rowWeightLabel({ factorId: "place:kings-cross", weight: 4 }), "matters 4 of 5");
});
