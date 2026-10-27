import assert from "node:assert/strict";
import test from "node:test";

import { RANKINGS } from "../src/lib/area-pages";
import { ALL_CENSUS_VIEWS, CENSUS_LAYERS, CENSUS_METRIC_IDS, censusView, isCensusMetric, isMsoaFigure } from "../src/lib/census-layers";
import { CENSUS_PICK_IDS, CENSUS_PICK_TOPICS } from "../src/lib/census-picks";
import { assertPreferenceProfile, FACTOR_IDS, METRIC_IDS, type PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE, getMetric, getValuePack, METRICS } from "../src/lib/fixtures";
import { effectiveScaleMode } from "../src/lib/legend-scale";
import { legendCaption, legendTitle, mapValueText } from "../src/lib/map-legend";
import { parseMapState, REAL_PUBLISHED_LAYERS } from "../src/lib/map-state";
import {
  activeTopicPick, activeTopicSubview, activeTopicView, findTopic, MAP_TOPIC_GROUPS, searchTopics, topicLayers, topicTrigger, topicViewColumns,
  visibleTopicGroups,
} from "../src/lib/map-topics";
import { metricPolarity, paletteRamp, PALETTES } from "../src/lib/palettes";
import { PEOPLE_GROUPS, PEOPLE_TOPIC_IDS } from "../src/lib/people-profile";

const ALL_VIEWS = ALL_CENSUS_VIEWS;
const NEW_IDS: readonly string[] = CENSUS_METRIC_IDS;

test("every Census category is its own published metric, once", () => {
  const views = ALL_VIEWS.map((view) => view.metric).filter((id) => id !== "social-renting");
  assert.deepEqual([...views].sort(), [...CENSUS_METRIC_IDS].sort());
  assert.equal(new Set(views).size, views.length);
  // 49 and 11 world regions (TS004, per area), then one per detailed category (lib/census-picks.ts).
  assert.equal(CENSUS_METRIC_IDS.length, 49 + 11 + CENSUS_PICK_IDS.length);
  assert.equal(CENSUS_PICK_IDS.length, CENSUS_PICK_TOPICS.reduce((sum, topic) => sum + topic.picks.length, 0));
  for (const id of CENSUS_METRIC_IDS) {
    assert.ok((METRIC_IDS as readonly string[]).includes(id), id);
    assert.ok(REAL_PUBLISHED_LAYERS.includes(id), id);
    assert.equal(getMetric(id).id, id);
  }
  assert.ok(isCensusMetric("census-ethnicity-asian"));
  assert.ok(!isCensusMetric("social-renting"));
  assert.ok(!isCensusMetric("crime"));
});

test("People holds ethnic makeup, country of birth, religion, age, household type and the detailed tables; Homes & area adds tenure and accommodation", () => {
  const people = MAP_TOPIC_GROUPS.find((group) => group.id === "people")!;
  // Layers v5 (PR 1): Main language and Passports held are picks under Country of birth; PR 3 adds Student areas (TS066).
  assert.deepEqual(people.items.map((item) => item.label), ["Ethnic makeup", "Country of birth", "Religion", "Residents' age", "Household type",
    "Year of arrival", "National identity", "Student areas"]);
  assert.ok(visibleTopicGroups().some((group) => group.id === "people"));
  assert.deepEqual(findTopic("census-ethnicity-asian")?.views?.map((view) => view.label), ["Asian", "Black", "Mixed", "White", "Other"]);
  assert.deepEqual(findTopic("census-religion-none")?.views?.map((view) => view.label),
    ["Christian", "Muslim", "Hindu", "Jewish", "Sikh", "Buddhist", "No religion", "Other"]);
  assert.deepEqual(findTopic("census-age-65-plus")?.views?.map((view) => view.label), ["0–14", "15–24", "25–44", "45–64", "65+"]);
  assert.deepEqual(findTopic("census-household-other")?.views?.map((view) => view.label),
    ["One person", "Couple, no children", "Couple with children", "Lone parent", "Other"]);
  const homes = MAP_TOPIC_GROUPS.find((group) => group.id === "homes-area")!;
  assert.deepEqual(homes.items.map((item) => item.label), ["Wealth", "Noise", "Flood risk", "Clean air", "Tenure", "Accommodation type", "Company owners", "Short lets", "New homes", "Broadband", "HMOs"]);
  assert.deepEqual(findTopic("census-accommodation-flat")?.views?.map((view) => view.label), ["Detached", "Semi", "Terraced", "Flat", "Other"]);
});

test("Ethnic makeup is two-level: a group, then All <group> or one of its detailed Census groups", () => {
  const item = findTopic("census-ethnicity-indian")!;
  assert.equal(item.label, "Ethnic makeup");
  assert.deepEqual(findTopic("census-ethnicity-asian"), item);
  assert.deepEqual(item.views?.map((view) => view.label), ["Asian", "Black", "Mixed", "White", "Other"]);
  const subviews = (id: string) => item.views?.find((view) => view.id === id)?.subviews?.map((view) => view.label);
  assert.deepEqual(subviews("asian"), ["All Asian", "Indian", "Pakistani", "Bangladeshi", "Chinese", "Other Asian"]);
  assert.deepEqual(subviews("black"), ["All Black", "African", "Caribbean", "Other Black"]);
  assert.deepEqual(subviews("mixed"), ["All Mixed", "White and Asian", "White and Black African", "White and Black Caribbean", "Other Mixed"]);
  assert.deepEqual(subviews("white"), ["All White", "White British", "Irish", "Gypsy or Irish Traveller", "Roma", "Other White"]);
  assert.deepEqual(subviews("other"), ["All Other", "Arab", "Any other"]);
  // The 19 TS021 categories, each once, each inside the group that sums it.
  const ethnicity = CENSUS_LAYERS.find((layer) => layer.topic === "ethnicity")!;
  for (const group of ethnicity.views) {
    const detail = group.subviews ?? [];
    assert.deepEqual(detail.flatMap((view) => view.categories), [...group.categories], group.id);
    for (const view of detail) assert.equal(view.categories.length, 1, view.metric);
  }
  assert.equal(ethnicity.views.flatMap((group) => group.subviews ?? []).length, 19);

  const indian = { layer: "census-ethnicity-indian" as const, scaleMode: "linear" as const, changeWindow: 5 };
  assert.equal(activeTopicView(item, indian)?.id, "asian");
  assert.equal(activeTopicSubview(item, indian)?.label, "Indian");
  assert.deepEqual(topicTrigger(indian, [], "x"), { name: "Ethnic makeup", view: "Indian" });
  const asian = { ...indian, layer: "census-ethnicity-asian" as const };
  assert.equal(activeTopicSubview(item, asian)?.label, "All Asian");
  assert.deepEqual(topicTrigger(asian, [], "x"), { name: "Ethnic makeup", view: "Asian" });
  assert.equal(activeTopicSubview(findTopic("census-religion-none")!, { layer: "census-religion-none", scaleMode: "linear" }), null);

  assert.equal(legendTitle({ id: "census-ethnicity-indian", label: "x" }), "% of residents, Indian (Census 2021)");
  assert.equal(legendTitle({ id: "census-ethnicity-other-white", label: "x" }), "% of residents, other White (Census 2021)");
  assert.equal(mapValueText(7.6, { id: "census-ethnicity-bangladeshi", unit: "%" }), "8% of residents, Bangladeshi");
  assert.ok(searchTopics("bangladeshi").some((topic) => topic.label === "Ethnic makeup"));
  // Links keep working: the group ids as before, and each detailed id.
  assert.equal(parseMapState(new URLSearchParams("layer=census-ethnicity-black")).layer, "census-ethnicity-black");
  assert.equal(parseMapState(new URLSearchParams("layer=census-ethnicity-caribbean")).layer, "census-ethnicity-caribbean");
});

test("Detailed tables: every category with 1,000+ London residents is a pick; MSOA tables say so", () => {
  const ethnic = findTopic("census-ethnic-asian-japanese")!;
  assert.equal(ethnic.label, "Ethnic makeup");
  assert.equal(ethnic.picks?.label, "Pick a group (MSOA level)");
  assert.equal(ethnic.picks?.search, "Search groups");
  assert.equal(ethnic.picks?.note, "MSOA figures: each MSOA is one colour");
  const labels = ethnic.picks?.options.map((option) => option.label) ?? [];
  for (const label of ["Japanese (Asian)", "Korean (Asian)", "Japanese (Other)", "Polish (White)", "Nigerian (Black African)"]) {
    assert.ok(labels.includes(label), label);
  }
  assert.equal(labels.length, CENSUS_PICK_TOPICS.find((topic) => topic.topic === "ethnicity-detailed")!.picks.length);
  const japanese = { layer: "census-ethnic-asian-japanese" as const, scaleMode: "linear" as const, changeWindow: 5 };
  assert.equal(activeTopicView(ethnic, japanese), null);
  assert.equal(activeTopicPick(ethnic, japanese)?.label, "Japanese (Asian)");
  assert.deepEqual(topicTrigger(japanese, [], "x"), { name: "Ethnic makeup", view: "Japanese (Asian) (MSOA)" });
  assert.equal(legendTitle({ id: "census-ethnic-asian-korean", label: "x" }), "% of residents, Asian: Korean (Census 2021, MSOA figures)");
  assert.equal(legendCaption({ id: "census-ethnic-asian-korean", label: "x" }, "2021-03"),
    "% of residents, Asian: Korean (Census 2021, MSOA figures) · MSOA figures: each MSOA is one colour");
  // Detailed groups are small: under 1% keeps a decimal.
  assert.equal(mapValueText(0.42, { id: "census-ethnic-asian-japanese", unit: "%" }), "0.4% of residents, Asian: Japanese (MSOA figure)");
  assert.equal(mapValueText(0, { id: "census-ethnic-asian-korean", unit: "%" }), "0% of residents, Asian: Korean (MSOA figure)");
  assert.ok(isMsoaFigure("census-ethnic-asian-japanese"));
  assert.ok(!isMsoaFigure("census-ethnicity-chinese"));
  assert.ok(searchTopics("japanese").some((topic) => topic.label === "Ethnic makeup"));
  assert.ok(searchTopics("korea").some((topic) => topic.label === "Country of birth"));
  assert.equal(parseMapState(new URLSearchParams("layer=census-ethnic-asian-korean")).layer, "census-ethnic-asian-korean");

  // Religion's detailed beliefs (TS031) are picks under its views.
  const religion = findTopic("census-belief-atheist")!;
  assert.equal(religion.label, "Religion");
  assert.equal(religion.picks?.label, "Pick a belief (MSOA level)");
  assert.ok(!religion.picks?.options.some((option) => option.label === "Christian"));

  // Year of arrival (TS015) is per area: views, no picks, no MSOA note.
  const arrival = findTopic("census-arrival-born-in-the-uk")!;
  assert.equal(arrival.label, "Year of arrival");
  assert.deepEqual(arrival.views?.slice(0, 3).map((view) => view.label), ["Born in the UK", "Before 1951", "1951–1960"]);
  assert.equal(arrival.picks, undefined);
  assert.ok(!isMsoaFigure("census-arrival-born-in-the-uk"));

  // Main language (ONS API, per LSOA): a pick under Country of birth (Layers v5), named as a language; no MSOA note for it.
  const language = findTopic("census-language-polish")!;
  assert.equal(language.label, "Country of birth");
  assert.equal(language.picks?.label, "Pick a country, language or passport");
  const polish = { layer: "census-language-polish" as const, scaleMode: "linear" as const, changeWindow: 5 };
  assert.deepEqual(topicTrigger(polish, [], "x"), { name: "Country of birth", view: "Language: Polish" });
  assert.ok(!isMsoaFigure("census-language-polish"));
  assert.equal(legendCaption({ id: "census-language-polish", label: "x" }, "2021-03"), "% of residents aged 3+, main language Polish (Census 2021)");
  for (const entry of getValuePack("census-language-polish", "2021-03").values) assert.equal(entry.quality, "observed");

  // Passports held (TS013) and national identity (TS028): lists of MSOA figures.
  assert.equal(findTopic("census-passport-japan")?.label, "Country of birth");
  assert.equal(legendTitle({ id: "census-passport-japan", label: "x" }), "% of residents, passport: Japan (Census 2021, MSOA figures)");
  assert.equal(findTopic("census-identity-japanese")?.picks?.label, "Pick an identity (MSOA level)");
  assert.ok(searchTopics("passport").some((topic) => topic.label === "Country of birth"));

  const pack = getValuePack("census-ethnic-asian-japanese", "2021-03");
  for (const entry of pack.values) {
    assert.ok(entry.value !== null && entry.value > 0 && entry.value < 100);
    assert.equal(entry.quality, "fallback");
    assert.equal(entry.regionPercentile, null);
  }
  const definition = METRICS.find((metric) => metric.id === "census-ethnic-asian-japanese")!;
  assert.ok(definition.caveats.some((caveat) => caveat.startsWith("MSOA figures: each MSOA is one colour")), definition.caveats.join(" | "));
  assert.ok(!METRICS.find((metric) => metric.id === "census-ethnicity-chinese")!.caveats.some((caveat) => caveat.includes("MSOA figures")));
});

test("Country of birth: world regions per area, or one of 190 countries picked from a list of MSOA figures", () => {
  const item = findTopic("census-birth-uk")!;
  assert.equal(item.label, "Country of birth");
  assert.deepEqual(item.views?.map((view) => view.label), [
    "UK", "EU before 2004", "Joined EU 2004", "Romania, Bulgaria", "Croatia, Cyprus, Malta", "Europe, non-EU", "Africa", "Middle East & Asia", "Americas & Caribbean", "Oceania & other", "British Overseas"]);
  assert.equal(topicViewColumns(item), 3);
  assert.equal(item.picks?.label, "Pick a country, language or passport");
  assert.equal(item.picks?.search, "Search countries, languages, passports");
  const tables = ["country-of-birth-extended", "main-language", "passports"];
  assert.equal(item.picks?.options.length, tables.reduce((sum, table) => sum + CENSUS_PICK_TOPICS.find((topic) => topic.topic === table)!.picks.length, 0));
  assert.deepEqual(item.picks?.options.slice(0, 4).map((option) => option.label), ["England", "Northern Ireland", "Scotland", "Wales"]);
  for (const country of ["Japan", "Korea (South)", "Poland", "India"]) assert.ok(item.picks?.options.some((option) => option.label === country), country);
  assert.deepEqual(findTopic("census-birth-country-poland"), item);
  assert.ok(topicLayers(item).includes("census-birth-country-japan"));

  // A country presses no region chip; the button and the legend say it is an MSOA figure.
  const poland = { layer: "census-birth-country-poland" as const, scaleMode: "linear" as const, changeWindow: 5 };
  assert.equal(activeTopicView(item, poland), null);
  assert.equal(activeTopicPick(item, poland)?.label, "Poland");
  assert.equal(activeTopicPick(item, { ...poland, layer: "census-birth-eu8" }), null);
  assert.deepEqual(topicTrigger(poland, [], "x"), { name: "Country of birth", view: "Poland (MSOA)" });
  assert.deepEqual(topicTrigger({ ...poland, layer: "census-birth-eu8" }, [], "x"), { name: "Country of birth", view: "Joined EU 2004" });
  assert.equal(legendTitle({ id: "census-birth-country-poland", label: "x" }), "% of residents, born in Poland (Census 2021, MSOA figures)");
  assert.equal(legendCaption({ id: "census-birth-country-poland", label: "x" }, "2021-03"),
    "% of residents, born in Poland (Census 2021, MSOA figures) · MSOA figures: each MSOA is one colour");
  assert.equal(legendCaption({ id: "census-birth-eu8", label: "x" }, "2021-03"), "% of residents, born in a country that joined the EU in 2004 (Poland, Lithuania, Latvia, Estonia, Czechia, Slovakia, Hungary, Slovenia) (Census 2021)");
  assert.equal(mapValueText(3.4, { id: "census-birth-country-poland", unit: "%" }), "3% of residents, born in Poland (MSOA figure)");
  assert.equal(mapValueText(59.4, { id: "census-birth-uk", unit: "%" }), "59% of residents, born in the UK");
  assert.ok(isMsoaFigure("census-birth-country-poland"));
  assert.ok(!isMsoaFigure("census-birth-eu8"));
  assert.ok(searchTopics("poland").some((topic) => topic.label === "Country of birth"));
  assert.ok(searchTopics("born").some((topic) => topic.label === "Country of birth"));
  assert.equal(parseMapState(new URLSearchParams("layer=census-birth-country-poland")).layer, "census-birth-country-poland");
  assert.equal(parseMapState(new URLSearchParams("layer=census-birth-africa")).layer, "census-birth-africa");
});

test("Social rent is a view of Tenure, so its links still open it", () => {
  const tenure = findTopic("social-renting")!;
  assert.equal(tenure.label, "Tenure");
  assert.deepEqual(tenure.views?.map((view) => view.label), ["Owned", "Private rent", "Social rent"]);
  assert.equal(activeTopicView(tenure, { layer: "social-renting", scaleMode: "linear" })?.label, "Social rent");
  assert.deepEqual(topicTrigger({ layer: "social-renting", scaleMode: "linear", changeWindow: 5 }, [], "x"), { name: "Tenure", view: "Social rent" });
  // No item says the same thing twice: social-renting is listed once, inside Tenure.
  const items = MAP_TOPIC_GROUPS.flatMap((group) => group.items);
  assert.equal(items.filter((item) => item.layer === "social-renting" || item.views?.some((view) => view.layer === "social-renting")).length, 1);
});

test("long view rows wrap into three columns", () => {
  assert.equal(topicViewColumns(findTopic("census-ethnicity-asian")!), 5);
  assert.equal(topicViewColumns(findTopic("census-religion-christian")!), 3);
  assert.equal(topicViewColumns(findTopic("census-household-other")!), 3);
  assert.equal(topicViewColumns(findTopic("typical-price")!), 5);
  assert.equal(topicViewColumns(findTopic("crime")!), 1);
});

test("the legend says what is counted, of whom, and the source", () => {
  assert.equal(legendTitle({ id: "census-ethnicity-asian", label: "x" }), "% of residents, Asian (Census 2021)");
  assert.equal(legendTitle({ id: "census-household-lone-parent", label: "x" }), "% of households, lone parent (Census 2021)");
  assert.equal(legendTitle({ id: "social-renting", label: "x" }), "% of households, social rent (Census 2021)");
  // One census date, already in the title: no month.
  assert.equal(legendCaption({ id: "census-religion-none", label: "x" }, "2021-03"), "% of residents, no religion (Census 2021)");
  assert.equal(mapValueText(34.4, { id: "census-age-0-14", unit: "%" }), "34% of residents, aged 0–14");
});

test("Census layers are always neutral, never the traffic light and never a rank", () => {
  const traffic = PALETTES.find((palette) => palette.id === "current")!;
  for (const view of ALL_VIEWS) {
    assert.equal(metricPolarity(view.metric), "neutral", view.metric);
    assert.deepEqual(paletteRamp(traffic, view.metric), traffic.colours, view.metric);
    assert.equal(effectiveScaleMode(view.metric, "percentile", false), "linear", view.metric);
    assert.equal(getMetric(view.metric as never).direction === "higher-is-better", false, view.metric);
  }
});

test("demo packs carry each area's share and no London rank", () => {
  const pack = getValuePack("census-ethnicity-white", "2021-03");
  assert.equal(pack.values.length, 3);
  for (const entry of pack.values) {
    assert.ok(entry.value !== null && entry.value > 0 && entry.value < 100);
    assert.equal(entry.regionPercentile, null);
    assert.equal(entry.countryPercentile, null);
  }
  // Shares of one topic add up to the whole (religion leaves out "chose not to answer").
  const ageTotal = CENSUS_LAYERS.find((layer) => layer.topic === "age")!.views
    .reduce((sum, view) => sum + (getValuePack(view.metric as never, "2021-03").values[0].value ?? 0), 0);
  assert.ok(Math.abs(ageTotal - 100) < 0.5, String(ageTotal));
  // South Bank has no religion figures: grey, never 0.
  assert.equal(getValuePack("census-religion-christian", "2021-03").values[2].value, null);
  // A group's share is the sum of its detailed groups.
  const asian = CENSUS_LAYERS.find((layer) => layer.topic === "ethnicity")!.views.find((view) => view.id === "asian")!;
  const detail = (asian.subviews ?? []).reduce((sum, view) => sum + (getValuePack(view.metric as never, "2021-03").values[0].value ?? 0), 0);
  assert.ok(Math.abs(detail - (getValuePack("census-ethnicity-asian", "2021-03").values[0].value ?? 0)) < 0.5, String(detail));
  assert.ok((getValuePack("census-ethnicity-indian", "2021-03").values[0].value ?? 0) > 0);
  const definition = METRICS.find((metric) => metric.id === "census-ethnicity-white")!;
  assert.equal(definition.provenance.licence, "OGL-3.0");
  assert.ok(definition.caveats.length > 0);
  // World regions add up to every resident; a country is its MSOA's figure, marked as a wider area's.
  const regions = CENSUS_LAYERS.find((layer) => layer.topic === "country-of-birth")!.views
    .reduce((sum, view) => sum + (getValuePack(view.metric as never, "2021-03").values[0].value ?? 0), 0);
  assert.ok(Math.abs(regions - 100) < 0.5, String(regions));
  const poland = getValuePack("census-birth-country-poland", "2021-03");
  for (const entry of poland.values) {
    assert.ok(entry.value !== null && entry.value > 0 && entry.value < 100);
    assert.equal(entry.quality, "fallback");
    assert.equal(entry.regionPercentile, null);
  }
  const country = METRICS.find((metric) => metric.id === "census-birth-country-poland")!;
  assert.ok(country.caveats.some((caveat) => caveat.startsWith("MSOA figures: each MSOA is one colour")), country.caveats.join(" | "));
  assert.ok(!METRICS.find((metric) => metric.id === "census-birth-eu8")!.caveats.some((caveat) => caveat.includes("MSOA figures")));
});

test("no ranking page lists areas by a Census layer", () => {
  for (const ranking of RANKINGS) {
    // Social rent, the older `social-renting` metric shown as Tenure's view, ranks (owner decision 2026-10-18).
    if (ranking.kind !== "metric" || ranking.metric === "social-renting") continue;
    assert.equal(censusView(ranking.metric), null, ranking.slug);
  }
});

test("Find my area cannot match on a Census layer", () => {
  // Social rent stays retired (RETIRED_FACTOR_IDS, tests/find-my-area.test.ts); the new layers are not factors at all.
  for (const id of NEW_IDS) {
    assert.ok(!(FACTOR_IDS as readonly string[]).includes(id), id);
    const profile = structuredClone(DEFAULT_PROFILE) as PreferenceProfile;
    profile.factors = [...profile.factors.filter((factor) => factor.factorId === "affordability"),
      { factorId: id as never, weight: 3, direction: "higher", minimumUtility: null, maximumUtility: null }];
    assert.throws(() => assertPreferenceProfile(profile), /unsupported profile factor/, id);
  }
});

test("an area's People section shows the full breakdown of every Census map layer but the detailed map-only ones", () => {
  const shown: readonly string[] = PEOPLE_GROUPS.flatMap((group) => group.topics);
  const people: readonly string[] = PEOPLE_TOPIC_IDS;
  const mapOnly = CENSUS_LAYERS.filter((layer) => !people.includes(layer.topic)).map((layer) => layer.topic);
  assert.deepEqual(mapOnly, ["year-of-arrival", "main-language", "passports", "national-identity"]);
  for (const layer of CENSUS_LAYERS) if (!mapOnly.includes(layer.topic)) assert.ok(shown.includes(layer.topic), layer.topic);
});
