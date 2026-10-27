import assert from "node:assert/strict";
import test from "node:test";

import { PERSONAL_MATCH_DEFINITION } from "../src/lib/fixtures";
import { weightedProfile } from "./weighted-profile";
import {
  applyRelaxation,
  budgetTier,
  buildMatchPack,
  describeUnmetLimits,
  overBudget,
  rankPack,
  scoreMatchPack,
  telemetryProfile,
} from "../src/lib/matching";
import type { GeographyId, PreferenceProfile } from "../src/lib/contracts";
import type { RawMatchArea } from "../src/lib/matching";
import { decodeSharedProfile, encodeSharedProfile } from "../src/lib/profile-state";

test("personal matches are ranked and every score is explained", () => {
  const profile = weightedProfile();
  profile.factors.find((factor) => factor.factorId === "commute")!.weight = 0;

  const pack = buildMatchPack(profile);

  assert.equal(pack.schemaVersion, "match-pack.v2");
  assert.deepEqual(pack.values.map((value) => value.rank), [1, 2, 3]);
  assert.deepEqual(pack.values.map((value) => value.percentile), [100, 50, 0]);
  assert.ok(pack.values.every((value) => value.components.length > 0));
  // v4 Task 21: the weighted geometric mean of the ranked fits; weights from the order (budget, crime, schools: ties keep
  // the factor order) sum to 1; a criterion with no evidence counts as half a fit.
  assert.deepEqual(pack.criteria!.map((criterion) => criterion.id), ["affordability", "crime", "schools"]);
  for (const result of pack.values) {
    const ranked = result.components.filter((component) => component.weight > 0);
    const explained = 100 * ranked.reduce((product, component) => product * component.fit! ** component.weight, 1) * 0.5 ** (result.missingWeight ?? 0);
    assert.ok(ranked.every((component) => component.fit! >= 0 && component.fit! <= 1 && component.fitKind));
    assert.equal(Math.round(explained), result.score);
    assert.ok((result.reasons ?? []).length <= 2);
  }
});

test("a commute weight with nowhere to go is not a criterion", () => {
  const pack = buildMatchPack(weightedProfile());

  assert.ok(pack.values.every((value) => !value.components.some((part) => part.factorId === "commute")));
  assert.ok(!pack.criteria!.some((criterion) => criterion.id === "commute"));
});

test("analytics storage is opt-in and removes exact destinations", () => {
  const profile = weightedProfile();
  profile.commuteDestinations = [{
    id: "work", label: "Secret employer", latitude: 51.501234, longitude: -0.123456,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 40, weight: 3,
  }];

  assert.equal(telemetryProfile(profile), null);
  profile.analyticsConsent = true;
  const event = telemetryProfile(profile);
  const encoded = JSON.stringify(event);

  assert.doesNotMatch(encoded, /Secret employer|51\.501234|-0\.123456/);
  assert.match(encoded, /transit/);
  assert.equal(event?.destinationCount, 1);
});

test("a profile enters a URL only through explicit fragment encoding", () => {
  const profile = weightedProfile();
  profile.commuteDestinations = [{
    id: "work", label: "King's Cross", latitude: 51.5308, longitude: -0.1238,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 35, weight: 4,
  }];

  const fragment = encodeSharedProfile(profile);

  assert.match(fragment, /^#profile=v1\./);
  assert.ok(fragment.length < JSON.stringify(profile).length);
  assert.deepEqual(decodeSharedProfile(fragment), profile);
});

test("affordability rewards an area inside the maximum budget", () => {
  const profile = weightedProfile();
  profile.factors.forEach((factor) => { factor.weight = factor.factorId === "affordability" ? 5 : 0; });

  const pack = buildMatchPack(profile);

  assert.equal(pack.values[0].name, "North London preview");
  assert.equal(pack.values[0].score, 100);
});

test("direction changes reverse empirical crime preference", () => {
  const profile = weightedProfile();
  profile.factors.forEach((factor) => { factor.weight = factor.factorId === "crime" ? 5 : 0; });
  profile.factors.find((factor) => factor.factorId === "crime")!.direction = "lower";
  const lowerCrime = buildMatchPack(profile).values[0].name;
  profile.factors.find((factor) => factor.factorId === "crime")!.direction = "higher";

  assert.equal(lowerCrime, "Westminster preview");
  assert.equal(buildMatchPack(profile).values[0].name, "North London preview");
});

test("station access is the tenth factor and fewer minutes rank first by default", () => {
  const profile = weightedProfile();
  profile.factors.forEach((factor) => { factor.weight = factor.factorId === "station-access" ? 5 : 0; });
  const station = profile.factors.find((factor) => factor.factorId === "station-access")!;
  assert.equal(station.direction, "lower");

  const pack = buildMatchPack(profile);
  assert.equal(pack.values[0].name, "Westminster preview");
  assert.equal(pack.values.at(-1)!.name, "North London preview");
  const component = pack.values[0].components.find((entry) => entry.factorId === "station-access")!;
  assert.equal(component.rawValue, 4.2);
  assert.equal(component.unit, "minutes");

  station.direction = "higher";
  assert.equal(buildMatchPack(profile).values[0].name, "North London preview");
});

test("target-range prefers evidence near the middle of London", () => {
  const profile = weightedProfile();
  profile.factors.forEach((factor) => { factor.weight = factor.factorId === "market-level" ? 5 : 0; });
  profile.factors.find((factor) => factor.factorId === "market-level")!.direction = "target-range";

  assert.equal(buildMatchPack(profile).values[0].name, "South Bank preview");
});

function rentProfile(bedrooms = 2, targetBudget = 1500, maximumBudget = 2000) {
  const profile = weightedProfile();
  profile.market = "rent";
  profile.bedrooms = bedrooms;
  profile.targetBudget = targetBudget;
  profile.maximumBudget = maximumBudget;
  profile.factors.forEach((factor) => { factor.weight = factor.factorId === "affordability" ? 5 : 0; });
  return profile;
}

function rentArea(geographyId: RawMatchArea["geographyId"], monthlyRent: number): RawMatchArea {
  return { geographyId, name: geographyId, price: 500_000, monthlyRent, journeys: {}, factors: {} };
}

const RENT_BOROUGH: GeographyId = "uk:lad:E09000001";
const RENT_LOOKUPS: Record<string, GeographyId> = {
  "uk:lsoa:E01000001": RENT_BOROUGH,
  "uk:lsoa:E01000002": RENT_BOROUGH,
};

function rentContext(bedrooms: string, rent: number, lookups: Record<string, GeographyId> = { ...RENT_LOOKUPS }) {
  return {
    observed: [{
      carrierGeographyId: RENT_BOROUGH,
      bedrooms,
      medianMonthlyRent: rent,
      period: "2023-10 to 2024-09",
      sourceVersion: "ons-prms-2024-09",
    }],
    lsoaToBorough: lookups,
  };
}

test("rent scores observed monthly borough medians for the requested bedroom cell", () => {
  const areas = [rentArea("uk:lsoa:E01000001", 999_999), rentArea("uk:lsoa:E01000002", 1)];
  const pack = scoreMatchPack(rentProfile(), areas, rentContext("2 bedrooms", 1800));

  for (const result of pack.values) {
    const component = result.components.find((part) => part.factorId === "affordability")!;
    assert.equal(component.rawValue, 1800);
    assert.equal(component.unit, "£/month");
    assert.equal(component.carrierGeographyId, RENT_BOROUGH);
    assert.equal(component.quality, "fallback");
    assert.equal(component.sourceVersion, "ons-prms-2024-09");
    assert.equal(component.utility, 40);
  }
});

test("identical borough evidence does not masquerade as independent estimates", () => {
  const areas = [rentArea("uk:lsoa:E01000001", 2100), rentArea("uk:lsoa:E01000002", 1800)];
  const pack = scoreMatchPack(rentProfile(), areas, rentContext("2 bedrooms", 1800));

  const carriers = pack.values.flatMap((result) =>
    result.components.filter((part) => part.factorId === "affordability")
      .map((part) => [part.carrierGeographyId, part.rawValue] as const));
  assert.deepEqual(carriers, [[RENT_BOROUGH, 1800], [RENT_BOROUGH, 1800]]);
  for (const result of pack.values) {
    assert.notEqual(result.components[0].carrierGeographyId, result.geographyId);
  }
});

test("a missing bedroom cell suppresses rent affordability instead of substituting", () => {
  const areas = [rentArea("uk:lsoa:E01000001", 1800)];
  const pack = scoreMatchPack(rentProfile(3), areas, rentContext("1 bedroom", 1400));

  assert.equal(pack.values[0].components.length, 0);
  assert.equal(pack.values[0].score, null); // no evidence for any ranked criterion: unknown, not the middle
  assert.equal(pack.values[0].evidenceCompleteness, 0);
});

test("real-mode rent never reads the preview monthly-rent scalar", () => {
  const cheapScalar = [rentArea("uk:lsoa:E01000001", 1)];
  const dearScalar = [rentArea("uk:lsoa:E01000001", 999_999)];
  const context = rentContext("2 bedrooms", 1800);

  assert.deepEqual(scoreMatchPack(rentProfile(), cheapScalar, context),
    scoreMatchPack(rentProfile(), dearScalar, context));
  assert.equal(scoreMatchPack(rentProfile(), cheapScalar).values[0].components.length, 0);
});

test("annual-scale budgets suppress rent affordability instead of scoring 100", () => {
  const areas = [rentArea("uk:lsoa:E01000001", 1800)];
  const pack = scoreMatchPack(rentProfile(2, 500_000, 650_000), areas, rentContext("2 bedrooms", 1800));

  assert.equal(pack.values[0].components.length, 0);
  assert.equal(pack.values[0].score, null); // no evidence for any ranked criterion: unknown, not the middle
});

test("an invalid parent geography in the rent lookup is rejected", () => {
  const areas = [rentArea("uk:lsoa:E01000001", 1800)];
  assert.throws(() => scoreMatchPack(rentProfile(), areas,
    rentContext("2 bedrooms", 1800, { "uk:lsoa:E01000001": "uk:lsoa:E01000001" })), /borough/);
  assert.throws(() => scoreMatchPack(rentProfile(), areas,
    rentContext("2 bedrooms", 1800, { "uk:lsoa:E01000001": "uk:lad:XYZ" })), /borough/);
});

test("an LSOA missing from the rent lookup gets no rent evidence", () => {
  const areas = [rentArea("uk:lsoa:E01000999", 1800)];
  const pack = scoreMatchPack(rentProfile(), areas, rentContext("2 bedrooms", 1800));

  assert.equal(pack.values[0].components.length, 0);
  assert.equal(pack.values[0].score, null); // no evidence for any ranked criterion: unknown, not the middle
});

test("missing rent never inherits a purchase-price score", () => {
  const areas = [{ ...rentArea("uk:lsoa:E01000001", 1800), price: 100 }];
  const pack = scoreMatchPack(rentProfile(), areas);

  assert.equal(pack.values[0].components.length, 0);
  assert.equal(pack.values[0].score, null); // no evidence for any ranked criterion: unknown, not the middle
});

test("preview rent mode carries an explicit borough carrier for the 2-bedroom cell", () => {
  const pack = buildMatchPack(rentProfile());

  const component = pack.values[0].components.find((part) => part.factorId === "affordability")!;
  assert.equal(component.unit, "£/month");
  assert.match(component.carrierGeographyId, /^uk:lad:E\d{8}$/);
  assert.equal(component.quality, "fallback");
});

function tradeoffProfile(crimeWeight = 5, crimeMin: number | null = 80, affordMin: number | null = 80): PreferenceProfile {
  const profile = weightedProfile();
  profile.targetBudget = 300_000;
  profile.maximumBudget = 500_000;
  profile.factors.forEach((factor) => {
    if (factor.factorId === "crime") {
      factor.weight = crimeWeight;
      factor.direction = "lower";
      factor.minimumUtility = crimeMin;
      factor.maximumUtility = null;
    } else if (factor.factorId === "affordability") {
      factor.weight = 5;
      factor.minimumUtility = affordMin;
      factor.maximumUtility = null;
    } else {
      factor.weight = 0;
      factor.minimumUtility = null;
      factor.maximumUtility = null;
    }
  });
  return profile;
}

function tradeoffAreas(): RawMatchArea[] {
  return [
    {
      geographyId: "uk:lsoa:E01000001", name: "Northend", price: 400_000,
      monthlyRent: 1800, journeys: {},
      factors: { crime: { rawValue: 60, percentile: 20, carrierGeographyId: "uk:lsoa:E01000001", quality: "observed", sourceVersion: "police-2026-06" } },
    },
    {
      geographyId: "uk:lsoa:E01000002", name: "Southend", price: 600_000,
      monthlyRent: 1800, journeys: {},
      factors: { crime: { rawValue: 130, percentile: 90, carrierGeographyId: "uk:lsoa:E01000002", quality: "observed", sourceVersion: "police-2026-06" } },
    },
  ];
}

test("Musts are filters with no weight (mirrors test_matching.py)", () => {
  // Crime Must (a minimum fit of 80 = London's safest 20%) and budget Must (within £500k).
  const pack = scoreMatchPack(tradeoffProfile(), tradeoffAreas());
  const [north, south] = [...pack.values].sort((a, b) => a.geographyId.localeCompare(b.geographyId));

  assert.ok(!north.excluded);
  assert.equal(north.score, 100); // every criterion is a Must: nothing left to rank on
  assert.deepEqual(north.components.map((component) => component.weight), [0, 0]);
  assert.deepEqual(south.unmetLimits, ["affordability:outside", "crime:outside"]);
  assert.deepEqual(describeUnmetLimits(south, tradeoffProfile()), [
    "Ballpark £600k is over your £500k",
    "Crime 130 per 1,000 is outside your lowest 20% of London",
  ]);
});

test("a zero-weight must-have still excludes instead of silently passing", () => {
  const pack = scoreMatchPack(tradeoffProfile(0, 80, null), tradeoffAreas());

  assert.ok(!pack.values[0].excluded);
  assert.ok(pack.values[1].excluded);
  assert.deepEqual(pack.values[1].unmetLimits, ["crime:outside"]);
  assert.equal(pack.values[1].score, null);
});

test("unknown constrained evidence excludes with a missing-evidence reason", () => {
  const areas = tradeoffAreas().map((area) => ({ ...area, factors: {} }));
  const pack = scoreMatchPack(tradeoffProfile(), areas);

  assert.ok(pack.values.every((result) => result.excluded));
  const north = pack.values.find((result) => result.name === "Northend")!;
  assert.deepEqual(north.unmetLimits, ["crime:missing"]);
  assert.deepEqual(describeUnmetLimits(north, tradeoffProfile()), ["No crime evidence to check your lowest 20% of London"]);
});

test("relaxing exactly one limit includes only the areas it was blocking", () => {
  const profile = tradeoffProfile();
  const relaxed = scoreMatchPack(profile, tradeoffAreas(), { observed: [], lsoaToBorough: {} }, ["affordability"]);
  const byName = new Map(relaxed.values.map((result) => [result.name, result]));

  assert.ok(!byName.get("Northend")!.excluded);
  assert.ok(byName.get("Southend")!.excluded);
  assert.deepEqual(byName.get("Southend")!.unmetLimits, ["crime:outside"]);
});

test("relaxation reverses and keeps the original evidence visible", () => {
  const profile = tradeoffProfile();
  const original = scoreMatchPack(profile, tradeoffAreas());
  const south = (pack: typeof original) => pack.values.find((result) => result.name === "Southend")!;
  const reopened = applyRelaxation(original, ["affordability", "crime"], profile);

  assert.ok(!south(reopened).excluded);
  assert.deepEqual(south(reopened).components, south(original).components);
  assert.deepEqual(applyRelaxation(original, [], profile), original);
});

test("a rent must-have excludes an over-budget borough until relaxed", () => {
  const profile = rentProfile(2, 1500, 2000);
  profile.factors[0].minimumUtility = 50;
  const areas = [rentArea("uk:lsoa:E01000001", 999_999)];
  const context = rentContext("2 bedrooms", 2100);

  const excluded = scoreMatchPack(profile, areas, context);
  assert.ok(excluded.values[0].excluded);
  assert.deepEqual(excluded.values[0].unmetLimits, ["affordability:outside"]);
  assert.deepEqual(describeUnmetLimits(excluded.values[0], profile), ["Rent £2,100 a month is over your £2,000"]);
  const reopened = scoreMatchPack(profile, areas, context, ["affordability"]);
  assert.ok(!reopened.values[0].excluded);
  assert.equal(reopened.values[0].score, 100); // a Must has no weight
});

test("two households with different needs get different reasonable shortlists", () => {
  const buyer = tradeoffProfile(0, null, null);
  buyer.factors.find((factor) => factor.factorId === "affordability")!.weight = 5;
  const commuter = weightedProfile();
  commuter.targetBudget = 300_000;
  commuter.maximumBudget = 500_000;
  commuter.factors.forEach((factor) => { factor.weight = 0; factor.minimumUtility = null; factor.maximumUtility = null; });
  commuter.factors.find((factor) => factor.factorId === "commute")!.weight = 5;
  commuter.commuteDestinations = [{
    id: "central", label: "Central", latitude: 51.5, longitude: -0.12,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 30, weight: 5,
  }];
  const areas = tradeoffAreas().map((area, index) => ({
    ...area,
    journeys: { central: index === 0 ? 45 : 15 },
  }));

  const buyerPack = scoreMatchPack(buyer, areas);
  const commuterPack = scoreMatchPack(commuter, areas);
  assert.equal(buyerPack.values[0].name, "Northend");
  assert.equal(commuterPack.values[0].name, "Southend");
});

test("personal match is described as personal fit, never an objective best", () => {
  assert.match(PERSONAL_MATCH_DEFINITION.description, /your priorities/i);
  assert.doesNotMatch(PERSONAL_MATCH_DEFINITION.description, /best neighbourhood/i);
  assert.doesNotMatch(PERSONAL_MATCH_DEFINITION.description, /objective best/i);
});

test("multiple commute destinations combine their own travel scores by weight", () => {
  const profile = weightedProfile();
  profile.factors.forEach((factor) => { factor.weight = factor.factorId === "commute" ? 5 : 0; });
  profile.commuteDestinations = [
    { id: "west", label: "West", latitude: 51.501, longitude: -0.142, mode: "transit", arrivalTime: "09:00", targetMinutes: 20, weight: 5 },
    { id: "north", label: "North", latitude: 51.545, longitude: -0.094, mode: "transit", arrivalTime: "09:00", targetMinutes: 20, weight: 0 },
  ];
  const westWeighted = buildMatchPack(profile).values[0].name;
  profile.commuteDestinations[0].weight = 0;
  profile.commuteDestinations[1].weight = 5;

  assert.equal(westWeighted, "Westminster preview");
  assert.equal(buildMatchPack(profile).values[0].name, "North London preview");
});

test("a soft budget scores over-budget areas low, never out (mirrors test_matching.py)", () => {
  const profile: PreferenceProfile = {
    ...tradeoffProfile(), targetBudget: 500_000, maximumBudget: 600_000,
    factors: [
      { factorId: "affordability", weight: 1, direction: "target-range", minimumUtility: null, maximumUtility: null },
      { factorId: "crime", weight: 5, direction: "lower", minimumUtility: null, maximumUtility: null },
    ],
  };
  const crime = (id: GeographyId, percentile: number) => ({ crime: { rawValue: percentile, percentile, carrierGeographyId: id, quality: "observed" as const, sourceVersion: "police-2026-06" } });
  const within = "uk:lsoa:E01000001" as GeographyId;
  const over = "uk:lsoa:E01000003" as GeographyId;
  const pack = scoreMatchPack(profile, [
    { geographyId: within, name: "Within", price: 590_000, monthlyRent: 0, journeys: {}, factors: crime(within, 70) },
    { geographyId: over, name: "Over", price: 686_000, monthlyRent: 0, journeys: {}, factors: crime(over, 5) },
  ]);

  // Crime first (0.75): the 70th percentile fits 0.2; budget (0.25): £590k fits 0.1 → 0.2^0.75 · 0.1^0.25 = 0.168.
  // Over the maximum the budget fit is 0: score 0, ranked last, still scored.
  assert.deepEqual(pack.values.map((result) => [result.geographyId, result.score, result.excluded]), [[within, 17, false], [over, 0, false]]);
  assert.deepEqual(pack.values.map((result) => overBudget(result, profile)), [false, true]);
  assert.deepEqual(rankPack(pack, profile).values.map((result) => result.geographyId), [within, over]);
});

test("the budget tier: at the maximum is within, no price evidence sits between within and over", () => {
  const priced = (rawValue: number) => ({ components: [{ factorId: "affordability", rawValue }] }) as unknown as Parameters<typeof budgetTier>[0];
  const profile = { maximumBudget: 600_000 } as PreferenceProfile;
  assert.equal(budgetTier(priced(600_000), profile), 0);
  assert.equal(budgetTier(priced(600_001), profile), 2);
  assert.equal(budgetTier({ components: [] } as unknown as Parameters<typeof budgetTier>[0], profile), 1);
  assert.equal(overBudget({ components: [] } as unknown as Parameters<typeof overBudget>[0], profile), null);
});

test("limit reasons name the value and the range (mirrors matching.py)", () => {
  const profile = tradeoffProfile();
  profile.factors.push({ factorId: "station-access", weight: 3, direction: "lower", minimumUtility: 50, maximumUtility: null });
  const result = { geographyId: "uk:lsoa:E01000001", name: "x", score: null, rank: null, evidenceCompleteness: 100, excluded: true,
    unmetLimits: ["station-access:outside", "crime:outside"], sourceReleaseSet: "s",
    components: [
      { factorId: "crime", rawValue: 130, unit: "per 1,000", utility: 0, fit: 0, weight: 0, contribution: 0, carrierGeographyId: "uk:lsoa:E01000001", quality: "observed", sourceVersion: "s" },
      { factorId: "station-access", rawValue: 18.5, unit: "minutes", utility: 0, fit: 0, weight: 0, contribution: 0, carrierGeographyId: "uk:lsoa:E01000001", quality: "observed", sourceVersion: "s" },
    ],
  } as unknown as Parameters<typeof describeUnmetLimits>[0];
  assert.deepEqual(describeUnmetLimits(result, profile), [
    "Station access 18.5 minutes is outside your lowest 50% of London",
    "Crime 130 per 1,000 is outside your lowest 20% of London",
  ]);
});
