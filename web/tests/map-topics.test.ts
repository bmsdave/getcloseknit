import assert from "node:assert/strict";
import test from "node:test";

import type { CustomCriterion } from "../src/lib/custom-criteria";
import { customLayerId } from "../src/lib/custom-criteria";
import { rankingForLayer } from "../src/lib/area-pages";
import { CUSTOM_PRESETS } from "../src/lib/custom-presets";
import { METRICS } from "../src/lib/fixtures";
import { METRIC_IDS } from "../src/lib/contracts";
import { parseMapState } from "../src/lib/map-state";
import { DETAIL_LAYER_IDS } from "../src/lib/nature-layers";
import {
  activeTopicView, findTopic, hasTimeline, isFlatGroup, isRankedLayer, isSinglePeriod, LAYER_EXCLUSIONS, MAP_OVERLAYS, MAP_TOPIC_GROUPS, mapTopicGroups,
  PRESET_EXCLUSIONS, presetOfLayer, scaleForTopic, searchTopics, topicLayers, topicPillLabel, topicTitle, topicTrigger, visibleTopicGroups,
} from "../src/lib/map-topics";
import { TYPICAL_PRICE_TYPES } from "../src/lib/typical-price";

const allLayers = MAP_TOPIC_GROUPS.flatMap((group) => group.items.flatMap(topicLayers));

function count(layer: string): number {
  return allLayers.filter((id) => id === layer).length;
}

test("groups follow the decision order", () => {
  assert.deepEqual(MAP_TOPIC_GROUPS.map((group) => group.label), [
    "Cost", "Transport", "Safety", "Food & drink", "Going out", "Everyday life", "Nature", "Homes & area", "People", "My criteria",
  ]);
});

// Layers v5 (PR 1): the menu without its duplicates; the review's verdict table is docs/layers-review (owner-reviewed 2026-10-20).
test("Layers v5: the menu's items after the merges", () => {
  const names = Object.fromEntries(MAP_TOPIC_GROUPS.map((group) => [group.id, group.items.map((item) => item.label)]));
  assert.deepEqual(names.cost, ["Price per m²", "Typical price", "Typical rent", "Council tax band"]);
  assert.deepEqual(names.safety, ["Crime", "Road danger"]);
  assert.deepEqual(names["getting-around"], ["Station walk", "Cycling", "EV charging"]);
  assert.deepEqual(names["homes-area"], ["Wealth", "Noise", "Flood risk", "Clean air", "Tenure", "Accommodation type", "Company owners", "Short lets", "New homes", "Broadband", "HMOs"]);
  assert.deepEqual(names.people, ["Ethnic makeup", "Country of birth", "Religion", "Residents' age", "Household type", "Year of arrival", "National identity", "Student areas"]);
  assert.deepEqual(names["food-drink"], ["Cafés", "Variety of cuisines", "Takeaways", "Food hygiene"]);
  assert.deepEqual(names["going-out"], ["Nightlife", "Culture"]);
  assert.deepEqual(names["everyday-life"], ["Good schools nearby", "Supermarket", "GP", "Families", "Gyms", "Dog-friendly", "Markets"]);
  // 52 items before Layers v5, 38 after PR 1 (Build your own included), 41 after PR 3 batch 1 (Typical rent
  // replaces Rent change; Flood risk, Good schools nearby and Student areas are new), 44 after batch 2
  // (Supermarket, GP, Broadband).
  assert.equal(MAP_TOPIC_GROUPS.flatMap((group) => group.items).length, 44);
  // Merged as views.
  assert.deepEqual(findTopic("price-per-square-metre")?.views?.map((view) => view.label), ["Actual", "Rank", "Change", "Borough HPI"]);
  assert.equal(findTopic("hpi-change-10y")?.id, "price-per-square-metre");
  assert.deepEqual(findTopic("income")?.views?.map((view) => view.label), ["Income", "Deprivation"]);
  assert.equal(findTopic("deprivation")?.label, "Wealth");
  assert.deepEqual(findTopic("custom:good-coffee")?.views?.map((view) => view.layer), ["custom:good-coffee", "custom:good-coffee-kebab", "custom:indie-cafes"]);
  assert.equal(findTopic("custom:indie-cafes")?.label, "Cafés");
  assert.equal(presetOfLayer("custom:indie-cafes")?.criterion.id, "indie-cafes");
  assert.equal(presetOfLayer("income"), null);
  // Passports and languages are picks under Country of birth, each saying its table; the item's own picks keep their ids.
  const birth = findTopic("census-birth-uk")!;
  assert.equal(birth.picks?.label, "Pick a country, language or passport");
  assert.ok(birth.picks?.options.some((option) => option.id === "poland" && option.label === "Poland"));
  assert.ok(birth.picks?.options.some((option) => option.id === "passports-poland" && option.label === "Passport: Poland"));
  assert.ok(birth.picks?.options.some((option) => option.label.startsWith("Language: ")));
  assert.equal(new Set(birth.picks?.options.map((option) => option.id)).size, birth.picks?.options.length);
  assert.equal(findTopic("census-passport-poland")?.label, "Country of birth");
  assert.equal(topicTitle({ layer: "census-passport-poland", scaleMode: "linear", changeWindow: 5 }, [], "My match"), "Country of birth · Passport: Poland (MSOA)");
  // The titles of the merged views.
  const title = (layer: string) => topicTitle({ layer: layer as never, scaleMode: "linear", changeWindow: 5 }, [], "My match");
  assert.equal(title("hpi-change-5y"), "Price per m² · Borough HPI · 5 yrs");
  assert.equal(title("hpi-change-10y"), "Price per m² · Borough HPI · 10 yrs");
  assert.equal(title("income"), "Wealth · Household income");
  assert.equal(title("deprivation"), "Wealth · Deprivation");
  assert.equal(title("custom:indie-cafes"), "Cafés · Independent vs chain");
  assert.equal(title("road-collisions"), "Road danger");
  assert.equal(topicPillLabel({ layer: "road-collisions", scaleMode: "linear", changeWindow: 5 }, [], "My match"), "Road danger · Hurt per 1,000");
  // Out of the menu, with a reason each; their links still paint (tests/map-state.test.ts).
  for (const id of ["kebab-cafe", "quiet-nights", "pret-greggs", "bakeries-betting", "coworking", "universities"]) assert.ok(PRESET_EXCLUSIONS[id]?.length > 10, id);
  // A merged one's link finds what replaced it; a dropped one's finds no row.
  assert.equal(findTopic("custom:kebab-cafe")?.label, "Cafés");
  assert.equal(findTopic("custom:quiet-nights")?.label, "Nightlife");
  for (const id of ["pret-greggs", "bakeries-betting", "coworking"]) assert.equal(findTopic(`custom:${id}`), null, id);
  // Universities became Student areas (Layers v5 PR 3): its layer finds that item.
  assert.equal(findTopic("custom:universities")?.id, "student-share");
  for (const id of ["mobile-4g-indoor", "mobile-5g-outdoor", "future-station-distance"]) assert.equal(findTopic(id), null, id);
  // A dropped ready-made criterion the household saved is listed under My criteria (it has no other row).
  const universities = CUSTOM_PRESETS.find((entry) => entry.criterion.id === "universities")!.criterion;
  const gyms = CUSTOM_PRESETS.find((entry) => entry.criterion.id === "gyms")!.criterion;
  const mine = mapTopicGroups([universities, gyms]).find((group) => group.id === "my-criteria")!.items.map((item) => item.id);
  assert.deepEqual(mine, ["custom:universities", "build-your-own"]);
});

test("a small group shows its items' views flat; a long one or one with second levels does not", () => {
  const groups = Object.fromEntries(MAP_TOPIC_GROUPS.map((group) => [group.id, group]));
  // Cost has four items since rent change and council tax bands (open data wave A; HPI is a view since Layers v5): it folds.
  assert.equal(isFlatGroup(groups.cost), false);
  // Transport's three items have no views: flat.
  assert.equal(isFlatGroup(groups["getting-around"]), true);
  assert.equal(isFlatGroup(groups.safety), true);
  // Wildlife seen has twelve species: they fold behind "+n" once it is chosen.
  assert.equal(isFlatGroup(groups.nature), false);
  assert.equal(isFlatGroup(groups.people), false);
  assert.equal(isFlatGroup(groups["food-drink"]), false);
  assert.equal(hasTimeline(findTopic("price-per-square-metre")!), true);
  assert.equal(hasTimeline(findTopic("typical-price")!), false);
  assert.equal(isSinglePeriod(findTopic("typical-price-flat")!), true);
  assert.equal(findTopic("nature-score")?.label, "Green & trees");
  assert.equal(findTopic("nature-score")?.group, "nature");
});

// Owner decision 2026-10-18: income and social renting get their Top 10; the Census never does.
test("Census layers are never ranked: no Top 10 in the Layers menu", () => {
  for (const layer of ["census-tenure-owned", "census-religion-muslim"]) assert.equal(isRankedLayer(layer), false, layer);
  for (const layer of ["crime", "price-per-square-metre", "station-access", "income", "social-renting"]) assert.equal(isRankedLayer(layer), true, layer);
  assert.equal(rankingForLayer("income"), "/rankings/highest-income");
  assert.equal(rankingForLayer("social-renting"), "/rankings/most-social-renting");
});

// Owner decision 2026-10-17: deprivation (the official index of the area) gets its Top 10 like any layer.
test("deprivation is a ranked layer: its Top 10 opens the least deprived areas", () => {
  assert.equal(isRankedLayer("deprivation"), true);
  assert.equal(rankingForLayer("deprivation"), "/rankings/least-deprived");
});

test("every group has items, People included (tests/census-layers.test.ts)", () => {
  for (const group of MAP_TOPIC_GROUPS) assert.ok(group.items.length > 0, group.label);
  assert.equal(visibleTopicGroups().length, MAP_TOPIC_GROUPS.length);
});

test("every published layer appears exactly once, or is excluded with a reason", () => {
  for (const metric of METRICS) {
    const excluded = LAYER_EXCLUSIONS[metric.id];
    if (excluded) {
      assert.equal(count(metric.id), 0, `${metric.id} is excluded yet listed`);
      assert.ok(excluded.length > 10, `${metric.id} needs a reason`);
    } else {
      assert.equal(count(metric.id), 1, metric.id);
    }
  }
});

test("every Layers-menu id is a served metric or a drawn layer, and survives the URL", () => {
  const known = new Set<string>([...METRIC_IDS, ...DETAIL_LAYER_IDS, "personal-match"]);
  for (const id of allLayers) {
    if (id.startsWith("custom:")) continue;
    assert.ok(known.has(id), `${id} is in the menu but not a served metric id`);
    assert.equal(parseMapState(new URLSearchParams({ layer: id })).layer, id, `?layer=${id} falls back`);
  }
});

test("every ready-made criterion appears exactly once, or is left out with a reason", () => {
  for (const preset of CUSTOM_PRESETS) {
    const id = preset.criterion.id;
    assert.equal(count(customLayerId(preset.criterion)), id in PRESET_EXCLUSIONS ? 0 : 1, id);
  }
});

test("item ids are unique and every item has keywords", () => {
  const items = MAP_TOPIC_GROUPS.flatMap((group) => group.items);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  for (const item of items) {
    assert.ok(item.keywords.length > 0, item.id);
    assert.ok(MAP_TOPIC_GROUPS.find((group) => group.id === item.group)?.items.includes(item), item.id);
  }
});

test("Cost carries its views; Crime has its types instead", () => {
  assert.deepEqual(findTopic("price-per-square-metre")?.views?.map((view) => view.label), ["Actual", "Rank", "Change", "Borough HPI"]);
  assert.deepEqual(findTopic("typical-price")?.views?.map((view) => view.label), ["All", "Flats", "Terraced", "Semi", "Detached"]);
  assert.equal(findTopic("typical-price")?.label, "Typical price");
  assert.equal(findTopic("crime")?.views, undefined);
  assert.equal(findTopic("crime")?.group, "safety");
});

test("findTopic resolves type views, merged layers and presets", () => {
  for (const type of TYPICAL_PRICE_TYPES) assert.equal(findTopic(type.id)?.id, "typical-price");
  assert.equal(findTopic("stock-value-per-square-metre")?.id, "price-per-square-metre");
  const cycling = findTopic("custom:cycling");
  assert.equal(cycling?.kind, "preset");
  assert.equal(cycling?.group, "getting-around");
  assert.equal(findTopic("custom:nope"), null);
  assert.equal(findTopic("personal-match"), null);
});

test("the household's own criteria join My criteria, before Build your own", () => {
  const mine: CustomCriterion = {
    id: "my-pubs", label: "Proper pubs", formula: "count", radiusMetres: 800, sets: { a: { label: "Pubs", any: [{ amenity: "pub" }] } },
  };
  const preset = CUSTOM_PRESETS.find((entry) => entry.criterion.id === "gyms")!.criterion;
  const groups = mapTopicGroups([mine, preset]);
  const criteria = groups.find((group) => group.id === "my-criteria")!.items;
  assert.deepEqual(criteria.map((item) => item.id), ["custom:my-pubs", "build-your-own"]);
  assert.equal(criteria[0].kind, "custom");
  assert.equal(criteria[1].layer, null);
  assert.equal(findTopic("custom:my-pubs", [mine])?.label, "Proper pubs");
  assert.equal(findTopic("custom:gyms", [preset])?.kind, "preset");
});

test("search finds by label, keyword and accents, in group order", () => {
  assert.equal(searchTopics("price per")[0]?.id, "price-per-square-metre");
  assert.ok(searchTopics("burglary").some((item) => item.id === "crime"));
  assert.ok(searchTopics("cafes").some((item) => item.id === "custom:good-coffee"));
  assert.ok(searchTopics("tube").some((item) => item.id === "station-access"));
  assert.ok(searchTopics("flats").some((item) => item.id === "typical-price"));
  assert.ok(searchTopics("pubs").some((item) => item.id === "custom:nightlife"));
  assert.deepEqual(searchTopics("   "), []);
  assert.deepEqual(searchTopics("zzzz"), []);
  const order = searchTopics("price").map((item) => item.group);
  assert.equal(order[0], "cost");
});

test("overlays are separate from the topics", () => {
  assert.deepEqual(MAP_OVERLAYS.map((overlay) => overlay.label), ["Local places", "Schools", "Recent sales", "Stations", "My places", "Cycle lanes", "Road collisions", "Street trees"]);
  assert.ok(MAP_OVERLAYS.every((overlay) => !findTopic(overlay.id)));
});

test("the active view follows the layer, then the scale", () => {
  const price = findTopic("price-per-square-metre")!;
  assert.equal(activeTopicView(price, { layer: "price-per-square-metre", scaleMode: "percentile" })?.id, "rank");
  assert.equal(activeTopicView(price, { layer: "stock-value-per-square-metre", scaleMode: "change" })?.id, "change");
  assert.equal(activeTopicView(findTopic("crime")!, { layer: "crime", scaleMode: "percentile" }), null);
  const typical = findTopic("typical-price-flat")!;
  assert.equal(activeTopicView(typical, { layer: "typical-price-flat", scaleMode: "linear" })?.label, "Flats");
  assert.equal(activeTopicView(findTopic("income")!, { layer: "income", scaleMode: "linear" })?.label, "Income");
  assert.equal(activeTopicView(findTopic("income")!, { layer: "deprivation", scaleMode: "linear" })?.label, "Deprivation");
  // A view with its own layer wins over the scale: Borough HPI while the scale is still Rank.
  assert.equal(activeTopicView(price, { layer: "hpi-change-10y", scaleMode: "percentile" })?.id, "hpi");
  assert.equal(activeTopicView(findTopic("custom:good-coffee")!, { layer: "custom:good-coffee-kebab", scaleMode: "linear" })?.id, "vs-kebab");
});

test("a chosen item keeps a scale it offers, else actual values", () => {
  assert.equal(scaleForTopic(findTopic("crime")!, "percentile"), "linear");
  assert.equal(scaleForTopic(findTopic("crime")!, "change"), "linear");
  assert.equal(scaleForTopic(findTopic("income")!, "percentile"), "linear");
  assert.equal(scaleForTopic(findTopic("typical-price")!, "percentile"), "linear");
});

test("the selector button names the item and any view but actual values", () => {
  const title = (layer: string, scaleMode: "linear" | "percentile" | "change", extra: object = {}) =>
    topicTitle({ layer: layer as never, scaleMode, changeWindow: 5, ...extra }, [], "My match");
  assert.equal(title("price-per-square-metre", "linear"), "Price per m²");
  assert.equal(title("price-per-square-metre", "percentile"), "Price per m² · Rank in London");
  assert.equal(title("price-per-square-metre", "change"), "Price per m² · 5-year change");
  assert.equal(title("crime", "linear"), "Crime");
  assert.equal(title("typical-price-terraced", "linear"), "Typical price · Terraced");
  assert.equal(title("typical-price", "linear"), "Typical price · All homes");
  assert.equal(title("station-access", "percentile"), "Station walk");
  assert.equal(title("custom:gyms", "linear"), "Gyms");
  assert.equal(title("personal-match", "linear"), "My match");
});

test("every item has a short name and no description", () => {
  const names = Object.fromEntries(MAP_TOPIC_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item.label]));
  assert.equal(names["custom:cycling"], "Cycling");
  assert.equal(names["custom:good-coffee"], "Cafés");
  assert.equal(names["custom:family"], "Families");
  assert.equal(names["custom:late-night-food"], "Takeaways");
  for (const [id, name] of Object.entries(names)) assert.ok(name.length <= 26, `${id}: "${name}" is too long for a name`);
  for (const item of MAP_TOPIC_GROUPS.flatMap((group) => group.items)) assert.ok(!("meaning" in item), item.id);
});

test("search finds a ready-made criterion by its short name and its long label", () => {
  for (const query of ["cycling", "bike parking", "hire docks", "coffee vs kebab", "specialty coffee vs kebab", "independent"]) {
    assert.ok(searchTopics(query).length > 0, query);
  }
  assert.ok(searchTopics("bike parking").some((item) => item.id === "custom:cycling"));
  assert.ok(searchTopics("kebab").some((item) => item.id === "custom:good-coffee"));
  assert.ok(searchTopics("passport").some((item) => item.id === "census-birth-uk"));
  assert.ok(searchTopics("hpi").some((item) => item.id === "price-per-square-metre"));
  assert.ok(searchTopics("deprivation").some((item) => item.id === "income"));
});

test("noise finds the Noise layer first, never the bars and pubs count", () => {
  const found = searchTopics("noise");
  assert.equal(found[0]?.id, "noise");
  assert.equal(found[0]?.layer, "noise");
  assert.ok(!found.some((item) => item.id === "custom:nightlife"));
});

test("the selector button splits the item from the view, for two lines", () => {
  const trigger = (layer: string, scaleMode: "linear" | "percentile" | "change") =>
    topicTrigger({ layer: layer as never, scaleMode, changeWindow: 5 }, [], "My match");
  assert.deepEqual(trigger("price-per-square-metre", "percentile"), { name: "Price per m²", view: "Rank in London" });
  assert.deepEqual(trigger("price-per-square-metre", "change"), { name: "Price per m²", view: "5-year change" });
  assert.deepEqual(trigger("price-per-square-metre", "linear"), { name: "Price per m²", view: null });
  assert.deepEqual(trigger("personal-match", "linear"), { name: "My match", view: null });
});

test("the rank view names the view's scope on the England map: its region, or its region across regions", () => {
  const state = (rankScope?: string) => ({ layer: "price-per-square-metre" as never, scaleMode: "percentile" as const, changeWindow: 5, rankScope });
  assert.equal(topicTitle(state("North West"), [], "My match"), "Price per m² · Rank in North West");
  assert.equal(topicPillLabel(state("its region"), [], "My match"), "Price per m² · Rank in its region");
  assert.equal(topicTitle(state("London"), [], "My match"), "Price per m² · Rank in London");
  assert.equal(topicTitle(state(), [], "My match"), "Price per m² · Rank in London");
});

// v4 Task 2 (B), round 2: the phone pill read "Price per m²" and "Noise" with no view (CUJ16: "Price per m² · Actual").
test("the phone's layer pill always names the layer and its view", () => {
  const pill = (layer: string, scaleMode: "linear" | "percentile" | "change" = "linear") =>
    topicPillLabel({ layer: layer as never, scaleMode, changeWindow: 5 }, [], "My match");
  assert.equal(pill("price-per-square-metre"), "Price per m² · Actual");
  assert.equal(pill("price-per-square-metre", "percentile"), "Price per m² · Rank in London");
  assert.equal(pill("price-per-square-metre", "change"), "Price per m² · 5-year change");
  assert.equal(pill("noise"), "Noise · Road and rail");
  assert.equal(pill("air-no2"), "Clean air · NO₂");
  assert.equal(pill("personal-match"), "My match", "no view: the name alone");
});
