import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PreferenceProfile } from "../src/lib/contracts";
import { assertPreferenceProfile } from "../src/lib/contracts";
import {
  assertCustomCriterion, assertCustomPreferences, bivariateAxisText, bivariateCell, bivariateRanges, bivariateStops, customMapDefinition,
  customPercentiles, customTooltip, customValuePack, describeCounts, describeFormula, describeTags, formatCustomValue, lensEnds,
  CUSTOM_FORMULAS, customRollup, evaluateCustomCriterion, isCustomLayerId, previewCustomPack, previewCustomValues, tiedEndWords, withCustom, withoutCustom, type CustomCriterion,
} from "../src/lib/custom-criteria";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Builder } from "../src/components/match/my-criteria";
import { CUSTOM_SEQUENTIAL, YARN_RAMPS } from "../src/lib/palettes";
import { buildCriterion, CUSTOM_PRESETS, PLACE_TYPES, presetBySlug, presetFor } from "../src/lib/custom-presets";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { parseMapState, isLayerAvailableInMode } from "../src/lib/map-state";
import { tradeoffsFor } from "../src/lib/match-brief";
import { buildMatchPack, describeUnmetLimits } from "../src/lib/matching";
import { decodeSharedProfile, encodeSharedProfile } from "../src/lib/profile-state";

// The balance stays a builder option (Layers v5: no ready-made criterion uses it), so these tests keep one.
const kebabCafe = { ...CUSTOM_PRESETS[0].criterion, formula: "balance" as const };

function profile(extra: Partial<PreferenceProfile>): PreferenceProfile {
  return structuredClone({ ...DEFAULT_PROFILE, ...extra });
}

function refuses(definition: unknown, pattern: RegExp) {
  assert.throws(() => assertCustomCriterion(definition), pattern);
}

test("presets are the list the API serves to Claude", () => {
  const api = JSON.parse(readFileSync(new URL("../../api/area_api/fixtures/custom-presets.json", import.meta.url), "utf8")) as {
    presets: unknown[];
  };
  assert.deepEqual(JSON.parse(JSON.stringify(CUSTOM_PRESETS)), api.presets);
  assert.equal(new Set(CUSTOM_PRESETS.map((preset) => preset.criterion.id)).size, CUSTOM_PRESETS.length);
  for (const preset of CUSTOM_PRESETS) assertCustomCriterion(preset.criterion);
});

test("preset names are neutral and descriptive: no brands, no value words", () => {
  const BRANDS = /\b(pret|greggs|costa|starbucks|nero|gail)/i;
  const VALUE_WORDS = /\b(good|bad|cheap|nice|posh|rough|best|worst|friendly|stuff|health check|divide)\b/i;
  for (const preset of CUSTOM_PRESETS) {
    for (const words of [preset.criterion.label, preset.slug]) {
      assert.doesNotMatch(words, BRANDS, `${preset.criterion.id}: ${words}`);
      assert.doesNotMatch(words, VALUE_WORDS, `${preset.criterion.id}: ${words}`);
    }
    assert.doesNotMatch(preset.description, VALUE_WORDS, preset.criterion.id);
    assert.match(preset.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
  assert.deepEqual(["kebab-cafe", "good-coffee-kebab", "pret-greggs", "family"].map((id) => CUSTOM_PRESETS.find((preset) => preset.criterion.id === id)!.criterion.label),
    ["Kebab shops vs cafés", "Specialty coffee vs kebab shops", "Sandwich chains vs bakery chains", "Nearest playground or nursery"]);
  assert.equal(new Set(CUSTOM_PRESETS.map((preset) => preset.slug)).size, CUSTOM_PRESETS.length);
});

test("a preset opens by its slug or its old id, which stays the map layer's key", () => {
  assert.equal(presetBySlug("kebab-shops-vs-cafes")?.criterion.id, "kebab-cafe");
  assert.equal(presetBySlug("kebab-cafe")?.slug, "kebab-shops-vs-cafes", "the old id is an alias");
  assert.equal(presetBySlug("pret-greggs")?.slug, "sandwich-chains-vs-bakery-chains");
  assert.equal(presetBySlug("no-such"), null);
  // Layers v5: its link opens Cafés › Coffee vs kebab, the comparison it inverted (MERGED_LAYERS).
  assert.equal(parseMapState(new URLSearchParams("layer=custom:kebab-cafe")).layer, "custom:good-coffee-kebab");
  assert.equal(parseMapState(new URLSearchParams("layer=custom:gyms")).layer, "custom:gyms");
  assert.equal(presetFor(CUSTOM_PRESETS[0].criterion)?.slug, "kebab-shops-vs-cafes");
  assert.equal(presetFor(kebabCafe), null, "one saved with the measure its preset had (balance) is the household's own");
  assert.equal(presetFor({ ...kebabCafe, sets: { a: kebabCafe.sets.a } }), null, "a home-made criterion reusing an id is not the preset");
});

test("a card's first line names the OpenStreetMap tags it counts", () => {
  assert.equal(describeTags(kebabCafe), "Kebabs & Turkish grills: cuisine=kebab or cuisine=turkish · Cafés: amenity=cafe");
  const indie = CUSTOM_PRESETS.find((preset) => preset.criterion.id === "indie-cafes")!.criterion;
  assert.equal(describeTags(indie), "Independent cafés: amenity=cafe + no brand · Chain cafés: amenity=cafe + any brand");
  const nightlife = CUSTOM_PRESETS.find((preset) => preset.criterion.id === "nightlife")!.criterion;
  assert.equal(describeTags(nightlife), "Bars, pubs and clubs: amenity=bar/nightclub/pub");
});

test("a lens's two ends read in plain words, proper nouns kept", () => {
  assert.deepEqual(lensEnds(kebabCafe), ["Most kebabs & Turkish grills", "Most cafés"]);
  const chains = CUSTOM_PRESETS.find((preset) => preset.criterion.id === "pret-greggs")!.criterion;
  assert.deepEqual(lensEnds(chains), ["Highest share of Pret", "Lowest share of Pret"]); // a share since Layers v5
  const market = CUSTOM_PRESETS.find((preset) => preset.criterion.id === "markets")!.criterion;
  assert.deepEqual(lensEnds(market), ["Closest", "Furthest"]);
});

test("every friendly place type builds a valid criterion with every formula", () => {
  assert.ok(PLACE_TYPES.length >= 40);
  for (const type of PLACE_TYPES) {
    for (const formula of ["balance", "share", "count", "density", "variety", "nearest"] as const) {
      assertCustomCriterion(buildCriterion(type, PLACE_TYPES[0].id === type.id ? PLACE_TYPES[1] : PLACE_TYPES[0], formula, 800));
    }
  }
  const pair = buildCriterion(PLACE_TYPES[5], PLACE_TYPES[0], "balance", 800);
  assert.equal(pair.label, "Kebab shops vs cafés");
  assert.deepEqual(Object.keys(pair.sets), ["a", "b"]);
  assert.deepEqual(Object.keys(buildCriterion(PLACE_TYPES[5], PLACE_TYPES[0], "count", 800).sets), ["a"]);
  // Another formula, radius or pair is another criterion: its own id, so it never replaces one in the match.
  const ids = new Set<string>();
  for (const type of PLACE_TYPES) {
    for (const other of PLACE_TYPES) {
      if (other.id !== type.id) ids.add(buildCriterion(type, other, "balance", 800).id);
    }
    for (const formula of ["count", "density", "variety", "nearest"] as const) {
      for (const radius of [400, 800]) ids.add(buildCriterion(type, null, formula, radius).id);
    }
  }
  assert.equal(ids.size, PLACE_TYPES.length * (PLACE_TYPES.length - 1) + PLACE_TYPES.length * 8);
});

test("places, not people: religion and unknown keys are refused, limits hold", () => {
  const one = (any: unknown[]) => ({ ...kebabCafe, formula: "count", sets: { a: { label: "X", any } } });
  refuses(one([{ religion: "muslim" }]), /never who lives/);
  refuses(one([{ denomination: "*" }]), /never who lives/);
  refuses(one([{ name: "Tesco" }]), /not one of/);
  // Places of worship only as the household's own "nearest X" place, never counted (custom_criteria.PEOPLE_VALUES).
  refuses(one([{ amenity: "place_of_worship" }]), /never who lives/);
  refuses(one([{ amenity: ["cafe", "Place_of_worship"] }]), /never who lives/);
  refuses(one([{ shop: "religion" }]), /never who lives/);
  refuses(one([{ brand: "Masjid" }]), /never who lives/);
  refuses(one([{ amenity: "*", brand: "St Mary's Church" }]), /never who lives/);
  refuses({ ...kebabCafe, radiusMetres: 100 }, /radius/);
  refuses({ ...kebabCafe, radiusMetres: 2001 }, /radius/);
  refuses({ ...kebabCafe, id: "Bad id" }, /criterion id/);
  refuses({ ...kebabCafe, sets: { a: kebabCafe.sets.a } }, /exactly two sets/);
  refuses(one(Array(7).fill({ amenity: "cafe" })), /1-6 matchers/);
  refuses(one([{ amenity: ["cafe", "*"] }]), /invalid value/);
  refuses(one([{ brand: null }]), /at least one tag/);
  refuses({ ...kebabCafe, colour: "red" }, /unknown criterion field/);
  assertCustomCriterion(one([{ amenity: "cafe", brand: null }, { shop: "*" }, { cuisine: ["kebab", "pizza"] }]));
  const entry = { criterion: kebabCafe, weight: 3, direction: "lower" as const };
  assertCustomPreferences([entry]);
  assert.throws(() => assertCustomPreferences([entry, entry]), /duplicate/);
  assert.throws(() => assertCustomPreferences([{ ...entry, weight: 0 }]), /weight/);
  assert.throws(() => assertCustomPreferences([{ ...entry, direction: "target-range" }]), /direction/);
  assert.throws(() => assertPreferenceProfile(profile({ custom: [{ ...entry, criterion: one([{ religion: "*" }]) as CustomCriterion }] })), /never who lives/);
});

test("adding, replacing and removing a criterion keeps the profile tidy", () => {
  const entry = { criterion: kebabCafe, weight: 3, direction: "lower" as const };
  const added = withCustom(profile({}), entry);
  assert.equal(added.custom?.length, 1);
  assert.equal(withCustom(added, { ...entry, weight: 5 }).custom?.[0].weight, 5);
  assert.equal("custom" in withoutCustom(added, kebabCafe.id), false);
});

test("the preview match scores a custom criterion by its directed percentile", () => {
  const less = buildMatchPack(profile({ factors: [], custom: [{ criterion: kebabCafe, weight: 4, direction: "lower" }] }));
  const more = buildMatchPack(profile({ factors: [], custom: [{ criterion: kebabCafe, weight: 4, direction: "higher" }] }));
  assert.equal(less.values[0].geographyId, more.values.at(-1)!.geographyId);
  const component = less.values[0].components.find((item) => item.factorId === "custom:kebab-cafe")!;
  assert.equal(component.unit, "balance (-1 to +1)");  // custom_criteria.UNITS
  assert.equal(component.weight, 1);  // the only ranked criterion carries all the weight (rank-order centroid)
  assert.deepEqual(describeUnmetLimits(less.values[0], profile({})), []);
  const tradeoff = tradeoffsFor(less.values[0], profile({ custom: [{ criterion: kebabCafe, weight: 4, direction: "lower" }] }), null)
    .find((item) => item.id === "custom:kebab-cafe")!;
  assert.equal(tradeoff.label, "Kebab shops vs cafés");
  assert.match(tradeoff.detail, /fit \d+\/100 for less of it/);
});

test("zoomed out a ready-made criterion paints its MSOAs; a household's own has no roll-up", async () => {
  const pack = { ...previewCustomPack(kebabCafe), level: "msoa" as const };
  assert.deepEqual(new Set(customValuePack(pack).values.map((entry) => entry.carrier)), new Set(["msoa"]));
  assert.deepEqual(new Set(customValuePack(previewCustomPack(kebabCafe)).values.map((entry) => entry.carrier)), new Set(["lsoa"]));
  const own: CustomCriterion = { ...kebabCafe, id: "my-own", label: "My own" };
  assert.equal(await evaluateCustomCriterion(own, "msoa"), null);  // no request: only presets are rolled up
  assert.equal(await customRollup(own), null);
});

test("preview values and percentiles follow the API's rules", () => {
  assert.deepEqual(customPercentiles([1, 2, 2, null], "count"), [17, 67, 67, null]);
  assert.deepEqual(customPercentiles([4, 14], "nearest"), [75, 25]);
  const values = previewCustomValues(kebabCafe);
  assert.deepEqual(values[0].counts, { a: 12, b: 40 });
  assert.equal(values[0].value, Math.round((12 - 40) / (12 + 40 + 5) * 1000) / 1000);  // BALANCE_PRIOR
  const pack = previewCustomPack(kebabCafe);
  assert.equal(pack.schemaVersion, "custom-criterion-pack.v1");
  assert.equal(customValuePack(pack).values[0].regionPercentile, values[0].percentile);
  assert.equal(describeCounts(values[0].counts, kebabCafe), "12 kebabs & Turkish grills, 40 cafés");
  assert.equal(describeCounts({ a: 4, b: 0 }, kebabCafe), "4 kebabs & Turkish grills, no cafés");
  assert.equal(describeCounts({ a: 1, b: 1 }, kebabCafe), "1 place (kebabs & Turkish grills), 1 café", "never \"1 cafés\"");
  const pretGreggs = CUSTOM_PRESETS.find((preset) => preset.criterion.id === "pret-greggs")!.criterion;
  assert.equal(describeCounts({ a: 1, b: 2 }, pretGreggs), "1 Pret, 2 Greggs", "brands keep their own name");
  assert.equal(formatCustomValue(0.4, "balance"), "+0.40");
  assert.equal(formatCustomValue(0.25, "share"), "25%");
  assert.equal(formatCustomValue(null, "share"), "No places nearby");
});

test("a custom layer travels in the address; the criterion travels in the share fragment only", () => {
  assert.equal(isCustomLayerId("custom:kebab-cafe"), true);
  assert.equal(isCustomLayerId("custom:Bad"), false);
  assert.equal(parseMapState(new URLSearchParams("layer=custom:gyms")).layer, "custom:gyms");
  assert.equal(parseMapState(new URLSearchParams("layer=custom:<x>")).layer, "price-per-square-metre");
  assert.equal(isLayerAvailableInMode("custom:kebab-cafe", "real"), true);
  const shared = profile({ custom: [{ criterion: kebabCafe, weight: 2, direction: "higher" }] });
  const fragment = encodeSharedProfile(shared);
  assert.ok(!fragment.includes("kebab"));
  assert.deepEqual(decodeSharedProfile(fragment)?.custom, shared.custom);
  assert.equal(encodeSharedProfile(profile({})), encodeSharedProfile(profile({ custom: [] })));
});

test("the colour-square cells match the API's (contracts/fixtures/bivariate-cells.json)", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/bivariate-cells.json", import.meta.url), "utf8")) as {
    size: number;
    squares: { name: string; thresholds: Record<"a" | "b", number[]>; cases: { counts: { a: number; b: number }; cell: number }[] }[];
  };
  for (const set of fixture.squares) {
    const square = {
      axes: { a: { label: "A", thresholds: set.thresholds.a }, b: { label: "B", thresholds: set.thresholds.b } },
      colours: Array.from({ length: fixture.size }, () => Array.from({ length: fixture.size }, () => "#000000")),
      corners: { none: "", a: "", b: "", both: "" },
    };
    for (const item of set.cases) assert.equal(bivariateCell(item.counts, square), item.cell, `${set.name} ${JSON.stringify(item.counts)}`);
  }
});

test("pair criteria paint a colour square from both counts", () => {
  const square = {
    axes: { a: { label: "Kebab shops", thresholds: [1, 2, 4] }, b: { label: "Cafés", thresholds: [7, 20, 37] } },
    colours: [0, 1, 2, 3].map((a) => [0, 1, 2, 3].map((b) => `#${a}${b}0000`)),
    corners: { none: "few", a: "mostly kebab shops", b: "mostly cafés", both: "many of both" },
  };
  assert.equal(bivariateCell({ a: 2, b: 0 }, square), 2 * 4 + 0); // 0 cafés, 2 kebab shops
  assert.equal(bivariateCell({ a: 42, b: 40 }, square), 15); // many of both: the dark corner
  assert.equal(bivariateCell({ a: 0 }, square), null);
  assert.deepEqual(bivariateRanges([1, 2, 4]), ["0", "1", "2–3", "4+"]);
  assert.deepEqual(bivariateRanges([7, 20, 37]), ["0–6", "7–19", "20–36", "37+"]);
  assert.equal(bivariateAxisText(square, "b"), "Cafés in the area: 0–6 → 7–19 → 20–36 → 37+"); // one range per shade
  const stops = bivariateStops(square);
  assert.equal(stops.length, 16);
  assert.equal(stops[15].colour, "#330000");
  const pack = { ...previewCustomPack(kebabCafe), bivariate: square };
  const painted = customValuePack(pack);
  assert.equal(painted.values[0].value, bivariateCell(pack.values![0].counts, square));
  const served = customValuePack({ ...pack, values: pack.values!.map((entry) => ({ ...entry, cell: 7 })) });
  assert.equal(served.values[0].value, 7); // the API's cell wins (same levels, over all of London)
  assert.equal(customMapDefinition(kebabCafe, pack).legend.length, 16);
  const lines = customTooltip(pack)(pack.values![0].geographyId);
  assert.match(lines[0], /^In this area: \d+ kebabs & Turkish grills, \d+ cafés$/);
  assert.equal(lines.at(-1), "Places, not people");
  assert.ok(!lines.join(" ").includes("800 m")); // counted inside the area, not within a radius
});

test("criteria describe places inside the area, never a radius; nearest stays a distance", () => {
  assert.equal(describeFormula(kebabCafe), "More kebabs & Turkish grills (+1) or more cafés (−1) in the area");
  for (const formula of ["count", "density", "share", "variety"] as const) {
    assert.doesNotMatch(describeFormula({ ...kebabCafe, formula }), / m\b|within/);
  }
  assert.match(describeFormula({ ...kebabCafe, formula: "nearest" }), /^Walking minutes to the nearest/);
  assert.ok(CUSTOM_PRESETS.every((preset) => !/within \d/.test(preset.description ?? "")));
});

test("an Explore chip's layer is painted in the chip's yarn; other criteria keep the API's ramp", () => {
  const coffee = CUSTOM_PRESETS.find((preset) => preset.criterion.id === "good-coffee")!.criterion;
  const pack = { ...previewCustomPack(coffee), legend: CUSTOM_SEQUENTIAL.map((colour, value) => ({ value, colour, label: "" })) };
  assert.deepEqual(customMapDefinition(coffee, pack).legend.map((stop) => stop.colour), [...YARN_RAMPS.tangerine]);
  const own = { ...coffee, id: "my-coffee" };
  assert.deepEqual(customMapDefinition(own, pack).legend.map((stop) => stop.colour), [...CUSTOM_SEQUENTIAL]);
  assert.equal(customMapDefinition(coffee, null).legend.at(-1)?.colour, YARN_RAMPS.tangerine[4]);
});

test("an end tied beyond the list reads as one honest count, not rows of look-alikes", () => {
  const gyms = { ...presetBySlug("gyms-and-sports-centres")!.criterion, formula: "count" as const };
  const base = previewCustomPack(gyms);
  const nothing = { ...base.summary.bottom[0], value: 0, counts: { a: 0 } };
  const pack = { ...base, summary: { ...base.summary, bottom: [nothing], tied: { top: 1, bottom: 312 } } };
  assert.match(tiedEndWords(pack, "bottom", 5)!, /^312 areas have no gyms/);
  assert.equal(tiedEndWords(pack, "top", 5), null, "a lone top area keeps its row");
  assert.equal(tiedEndWords({ ...pack, summary: { ...pack.summary, tied: { top: 1, bottom: 4 } } }, "bottom", 5), null,
    "a tie the list shows in full keeps its rows");
  assert.equal(tiedEndWords(base, "bottom", 5), null, "a pack without tie counts (the preview) keeps its rows");
});

test("Layers v5: ready-made criteria walk to the nearest or count per 1,000 residents, never a balance", () => {
  const formulas = Object.fromEntries(CUSTOM_PRESETS.map((preset) => [preset.criterion.id, preset.criterion.formula]));
  assert.ok(!Object.values(formulas).includes("balance"));
  for (const id of ["gyms", "ev-charging", "family", "dog-friendly", "markets"]) assert.equal(formulas[id], "nearest", id);
  for (const id of ["nightlife", "late-night-food", "good-coffee", "culture", "quiet-nights"]) assert.equal(formulas[id], "per_resident", id);
  const family = presetBySlug("playgrounds-nurseries-and-libraries")!;
  assert.equal(family.criterion.id, "family", "the old slug and id still open Families");
  assert.equal(family.direction, "higher", "closer is better: nearest percentiles rank the short walk high");
  const nightlife = presetBySlug("nightlife")!.criterion;
  assert.equal(formatCustomValue(2.5, "per_resident"), "2.5 per 1,000 residents");
  assert.equal(describeFormula(nightlife), "Places per 1,000 residents of the area");
  assert.equal(previewCustomValues(nightlife)[0].value, 7.5); // 12 places for the preview's 1,600 residents
  assert.ok(customMapDefinition(nightlife, null).description.startsWith("Places per 1,000 residents"));
});

test("Build your own starts on the walk to the nearest; the balance is the last, advanced option", () => {
  const html = renderToStaticMarkup(createElement(Builder, { onUse: () => {} }));
  const measures = [...html.matchAll(/<option value="([a-z_]+)"[^>]*>([^<]+)</g)]
    .map((match) => [match[1], match[2]])
    .filter(([value]) => (CUSTOM_FORMULAS as readonly string[]).includes(value));
  assert.equal(measures[0][0], "nearest");
  assert.deepEqual(measures.at(-1), ["balance", "A vs B (balance, advanced)"]);
  assert.equal(new Set(measures.map(([value]) => value)).size, CUSTOM_FORMULAS.length);
});
