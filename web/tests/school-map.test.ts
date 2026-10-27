import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfstedIcon } from "../src/components/school/ofsted-icon";
import { SchoolPanel } from "../src/components/school/school-legend";
import {
  DEFAULT_SCHOOL_FILTER, faithTag, schoolCounts, schoolFeatures, schoolFilterFromQuery, schoolFoldCount, schoolFoldLayer,
  schoolIcon, schoolIcons, schoolLayer, schoolMapCard, schoolPointFromProperties, schoolPopupView, schoolShown, schoolSource, schoolTags,
  withSchoolFilterQuery, type SchoolPoint,
} from "../src/lib/map-school-layer";
import { mergeMapSetup } from "../src/lib/map-setup";
import { showsFromQuery } from "../src/lib/map-shows";
import {
  MEASURE_COLOUR, MEASURE_NONE_COLOUR, OFSTED_COLOUR, rankTier, schoolIconCode, schoolIconId, schoolIconLabel, schoolIconMarkup, type SchoolIcon,
} from "../src/lib/school-icons";
import { intakeLabel, schoolHeaderTags, type SchoolProfile } from "../src/lib/school-card";
import { demoSchoolCard } from "../src/lib/school-card-fixture";

// /school/136551 as the API sends it (school-points.v1): England top 1% in 2024/25, 12th of 512 London secondaries.
const NEWSTEAD: SchoolPoint = {
  urn: "136551", name: "Newstead Wood School", phase: "secondary", latitude: 51.367847, longitude: 0.077838,
  kind: "state", stage: "secondary", ofsted: "outstanding", topPercent: 1, rankYear: "2024/25", regionRank: 12, regionPool: 512, selective: true,
  sixthForm: true, intake: "Girls · mixed sixth form",
};
const PRIVATE: SchoolPoint = {
  urn: "100001", name: "City of London School for Girls", phase: "secondary", latitude: 51.519, longitude: -0.0946,
  kind: "independent", stage: "secondary", sixthForm: true, intake: "Girls",
};
const PLAIN: SchoolPoint = { urn: "100002", name: "B Primary", phase: "primary", latitude: 51.5, longitude: -0.1, kind: "state", stage: "primary" };

test("Task 1c: one channel per fact — Ofsted top, phase letter, funding body, London award plaque", () => {
  assert.deepEqual(schoolIcon(NEWSTEAD), { kind: "state", stage: "secondary", ofsted: "outstanding", tier: 1 });
  assert.deepEqual(schoolIcon(PRIVATE), { kind: "independent", stage: "secondary", ofsted: null, tier: null });
  const markup = (icon: Partial<SchoolIcon>) => schoolIconMarkup({ kind: "state", stage: "primary", ofsted: null, tier: null, ...icon });
  // Ofsted is the top's colour only: no marks (★ ● ◐) on the cap.
  for (const [mark, colour] of Object.entries(OFSTED_COLOUR)) {
    const cap = markup({ ofsted: mark as SchoolIcon["ofsted"] });
    assert.match(cap, new RegExp(`d="m2\\.5 9\\.5 9\\.5-5 9\\.5 5-9\\.5 5Z" fill="${colour}"`), mark);
  }
  assert.deepEqual(OFSTED_COLOUR, { outstanding: "#009e73", good: "#0072b2", "requires-improvement": "#b8860b", inadequate: "#c0352c", "report-card": "#5b6270" });
  // Not inspected: a plain sun top. Phase: P · S · PS on the band, never a tassel.
  assert.match(markup({}), /d="m2\.5 9\.5 9\.5-5 9\.5 5-9\.5 5Z" fill="#f6c445"/);
  assert.match(markup({}), />P<\/text>/);
  assert.match(markup({ stage: "secondary" }), />S<\/text>/);
  assert.match(markup({ stage: "all-through" }), />PS<\/text>/);
  assert.doesNotMatch(markup({ stage: "secondary" }), /V15\.6|>6</);
  // Private: ink body, white top, white letter; never an Ofsted colour or a plaque.
  const independent = markup({ kind: "independent", ofsted: "good", tier: 10 });
  assert.match(independent, /d="M6\.5 11\.6[^"]*" fill="#22252c"/);
  assert.match(independent, /d="m2\.5 9\.5[^"]*" fill="#ffffff"/);
  assert.doesNotMatch(independent, /#0072b2|#c98a00|>10</);
  // Rank: a plaque with its number, Silver 25 · Gold 10 · Diamond 5 · Red Diamond 3 · Ruby 1; none below.
  for (const [tier, colour] of [[25, "#d5dbe3"], [10, "#c98a00"], [5, "#5fb0e6"], [3, "#e2453c"], [1, "#9a1b4b"]] as const) {
    assert.match(markup({ tier }), new RegExp(`fill="${colour}".*>${tier}</text></g></g>$`), String(tier));
  }
  assert.doesNotMatch(markup({}), /translate\(16\.5 -7\)/);
  assert.equal(schoolIconLabel(schoolIcon(NEWSTEAD)), "Secondary, state, Ofsted Outstanding, top 1% in England (Ruby)");
  assert.equal(schoolIconLabel(schoolIcon(PRIVATE)), "Secondary, private");
});

test("Task 1c: the tier band holds the exact England Top %", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10, 11, 25, 26, 0, null, undefined].map(rankTier), [1, 3, 3, 5, 5, 10, 10, 25, 25, null, null, null, null]);
});

test("Task 1c: every marker is the same size (36 px, v4.6) at every zoom; overlaps fold into the best cap with +N", () => {
  const layer = schoolLayer();
  assert.equal(layer.minzoom, 12);
  assert.equal(layer.layout?.["icon-size"], 1);
  assert.equal(layer.layout?.["icon-allow-overlap"], true);
  assert.deepEqual(layer.layout?.["icon-image"], ["concat", "school-", ["to-string", ["coalesce", ["get", "best"], ["get", "code"]]]]);
  const source = schoolSource([NEWSTEAD, PRIVATE]);
  assert.equal(source.cluster, true);
  assert.deepEqual(source.clusterProperties, { best: ["max", ["get", "code"]], faded: ["min", ["get", "faded"]] });
  const fold = schoolFoldLayer();
  assert.deepEqual(fold.filter, ["has", "point_count"]);
  assert.equal(schoolFoldCount("school-fold-3"), 3);
  assert.equal(schoolFoldCount("school-2142"), null);
  // Priority: Ruby > Red Diamond > Diamond > Gold > Silver > Outstanding > the rest.
  const code = (icon: Partial<SchoolIcon>) => schoolIconCode({ kind: "state", stage: "primary", ofsted: null, tier: null, ...icon });
  const order = [code({ tier: 1 }), code({ tier: 3 }), code({ tier: 5 }), code({ tier: 10 }), code({ tier: 25 }), code({ ofsted: "outstanding" }),
    code({ ofsted: "good" }), code({ ofsted: "inadequate" }), code({})];
  assert.deepEqual([...order].sort((a, b) => b - a), order);
  // One image per look, named by its code; every point carries its code.
  const [feature] = schoolFeatures([NEWSTEAD]).features;
  assert.equal(feature.properties?.code, schoolIconCode(schoolIcon(NEWSTEAD)));
  assert.equal(schoolIconId(schoolIcon(NEWSTEAD)), `school-${feature.properties?.code}`);
  assert.equal(new Set(schoolIcons([NEWSTEAD, PRIVATE, PLAIN]).map(schoolIconId)).size, 3);
});

test("Show › Schools filters by phase, Ofsted and England top %, and travels in the address as one ?schools= text", () => {
  const points = [NEWSTEAD, PRIVATE, PLAIN, { ...PLAIN, urn: "100003", ofsted: "good" as const, topPercent: 17, regionRank: 300, regionPool: 1800 }];
  assert.equal(schoolFeatures(points).features.length, 4);
  const top10 = { ...DEFAULT_SCHOOL_FILTER, measure: { id: "englandTopPercent" as const, threshold: 10 } };
  assert.deepEqual(points.filter((point) => schoolShown(point, top10)).map((point) => point.urn), ["136551"]);
  const noPrivate = { ...DEFAULT_SCHOOL_FILTER, phases: ["primary", "secondary", "all-through"] as const };
  assert.equal(schoolFeatures(points, noPrivate).features.length, 3);
  const goodOnly = { ...DEFAULT_SCHOOL_FILTER, ofsted: ["good"] as const };
  // Ofsted filters state schools only: a private school has no grade here and stays with its type.
  assert.deepEqual(points.filter((point) => schoolShown(point, goodOnly)).map((point) => point.urn), ["100001", "100003"]);
  const counts = schoolCounts(points);
  assert.deepEqual(counts.types, { primary: 2, secondary: 1, "all-through": 0, private: 1 });
  assert.deepEqual(counts.ofsted, { out: 1, good: 1, ri: 0, inad: 0, rc: 0, none: 1 });
  assert.equal(counts.tiers[1], 1);
  assert.equal(counts.tiers[25], 1);
  // The address: ?schools=on for every school, else the compact text (lib/school-filter.ts).
  assert.equal(withSchoolFilterQuery("layer=crime", true, DEFAULT_SCHOOL_FILTER), "layer=crime&schools=on");
  const narrowed = { ...DEFAULT_SCHOOL_FILTER, phases: ["primary", "secondary"] as const, ofsted: ["out", "good", "ri"] as const, measure: top10.measure };
  const query = withSchoolFilterQuery("", true, narrowed);
  assert.equal(query, "schools=t.p.s_o.out.good.ri_m.top.10");
  assert.deepEqual(schoolFilterFromQuery(query), narrowed);
  const aLevelQuery = withSchoolFilterQuery("", true, { ...DEFAULT_SCHOOL_FILTER, aLevelOnly: true });
  assert.equal(aLevelQuery, "schools=a");
  assert.equal(schoolFilterFromQuery(aLevelQuery).aLevelOnly, true);
  assert.equal(showsFromQuery(`?${query}`).schools, true);
  assert.equal(withSchoolFilterQuery(query, false, narrowed), "");
  assert.deepEqual(schoolFilterFromQuery("schools=on"), DEFAULT_SCHOOL_FILTER);
  assert.deepEqual(schoolFilterFromQuery("schools=none").phases, []);
  // Older addresses still read, and are rewritten as the compact text.
  const legacy = "schools=primary,secondary&ofsted=out,good,ri&top10=1";
  assert.deepEqual(schoolFilterFromQuery(legacy), narrowed);
  assert.equal(withSchoolFilterQuery(legacy, true, schoolFilterFromQuery(legacy)), query);
  // The saved setup keeps schools and their filters together; a link naming schools sets the group.
  assert.equal(new URLSearchParams(mergeMapSetup("", query)).get("schools"), "t.p.s_o.out.good.ri_m.top.10");
  assert.equal(new URLSearchParams(mergeMapSetup("schools=on", query)).get("schools"), "on");
});

test("option 4: a chosen measure colours the caps by its step; schools without it are faded, a threshold drops them", () => {
  const p8 = (value: number): SchoolPoint => ({ ...NEWSTEAD, urn: String(136000 + Math.round(value * 10 + 50)), measures: { progress8: [value, "2023/24"] } });
  const points = [p8(-0.8), p8(-0.2), p8(0.2), p8(0.9), { ...NEWSTEAD, urn: "136999" }];
  const colour = { ...DEFAULT_SCHOOL_FILTER, measure: { id: "progress8" as const, threshold: null } };
  assert.deepEqual(points.map((point) => schoolIcon(point, colour).measure), [0, 1, 2, 3, null]);
  // Coloured by a measure, the Ofsted colour steps aside (one channel per fact); without one it stays.
  assert.equal(schoolIcon(NEWSTEAD, colour).ofsted, null);
  assert.equal(schoolIcon(NEWSTEAD).ofsted, "outstanding");
  assert.ok(schoolIconMarkup(schoolIcon(p8(0.9), colour)).includes(MEASURE_COLOUR[3]));
  assert.ok(schoolIconMarkup(schoolIcon(NEWSTEAD, colour)).includes(MEASURE_NONE_COLOUR));
  assert.ok(schoolIconCode(schoolIcon(p8(0.9), colour)) > schoolIconCode(schoolIcon(p8(-0.8), colour)));
  const features = schoolFeatures(points, colour).features;
  assert.deepEqual(features.map((feature) => feature.properties?.faded), [0, 0, 0, 0, 1]);
  assert.equal(schoolFeatures(points, { ...colour, measure: { id: "progress8", threshold: 0 } }).features.length, 2);
  // England top % is darker the lower it is.
  const top = { ...DEFAULT_SCHOOL_FILTER, measure: { id: "englandTopPercent" as const, threshold: null } };
  assert.equal(schoolIcon({ ...NEWSTEAD, topPercent: 1 }, top).measure, 3);
  assert.equal(schoolIcon({ ...NEWSTEAD, measures: { englandTopPercent: [40, "2024/25"] } }, top).measure, 0);
  // A fold is faded only when every school in it is; the layer reads it.
  assert.deepEqual((schoolSource(points).clusterProperties as Record<string, unknown>).faded, ["min", ["get", "faded"]]);
  assert.ok(JSON.stringify(schoolLayer().paint).includes("faded"));
});
test("Task 1c: the Show list draws real markers with All · None per group and the five awards", () => {
  const html = renderToStaticMarkup(createElement(SchoolPanel, { filter: DEFAULT_SCHOOL_FILTER, zoom: 13 }));
  for (const id of ["type", "ofsted"]) {
    assert.match(html, new RegExp(`data-testid="school-${id}-all"[^>]*disabled`));
    assert.match(html, new RegExp(`data-testid="school-${id}-none"`));
  }
  for (const label of ["Primary", "Secondary", "All-through", "Private", "Outstanding", "Requires improvement", "Not inspected", "England top %", "Academy", "Girls", "No faith", "Sixth forms by A-level results"]) {
    assert.match(html, new RegExp(label));
  }
  assert.equal((html.match(/translate\(19\.5 -6\.5\)/g) ?? []).length, 5, "five plaques in the key");
  assert.match(html, /P primary · S secondary · PS all-through/);
  assert.match(renderToStaticMarkup(createElement(SchoolPanel, { zoom: 11 })), /Zoom in to see schools/);
  // Schools filter v2: Reset is off for the default filter; a measure shows its colour key, its threshold and the summary.
  assert.match(html, /data-testid="school-filter-reset" disabled/);
  const ks2 = renderToStaticMarkup(createElement(SchoolPanel, {
    filter: { ...DEFAULT_SCHOOL_FILTER, phases: ["primary"], measure: { id: "ks2RwmExpected", threshold: 75 } }, zoom: 13, onUseInMatch: () => undefined }));
  assert.match(ks2, /data-testid="school-measure-key"/);
  assert.match(ks2, /data-testid="school-threshold"/);
  assert.match(ks2, /Primary · KS2 expected standard ≥ 75%/);
  assert.match(ks2, /Use in My match/);
});

test("Task 1c / 47: the popup and the rows show Ofsted as the cap's top in the same colour", () => {
  const swatch = renderToStaticMarkup(createElement(OfstedIcon, { mark: "outstanding", label: "Ofsted: Outstanding" }));
  assert.match(swatch, /fill="#009e73"/);
  assert.match(swatch, /aria-label="Ofsted: Outstanding"/);
  assert.match(renderToStaticMarkup(createElement(OfstedIcon, { mark: null, label: "Not rated by Ofsted" })), /fill="#f6c445"/);
});

test("Fix 23: at most 3 tags, most useful first (the award is England's, with its year)", () => {
  assert.deepEqual(schoolTags(NEWSTEAD).map((tag) => tag.label), ["Top 1% England · 2024/25", "Secondary", "Grammar"]);
  assert.equal(schoolTags(NEWSTEAD)[0].top, true);
  const faith: SchoolPoint = { ...NEWSTEAD, topPercent: 20, rankYear: undefined, selective: false, faith: "Roman Catholic", intake: "Boys" };
  assert.deepEqual(schoolTags(faith).map((tag) => tag.label), ["Top 20% England", "Secondary", "Catholic"]);
  const plain: SchoolPoint = { ...NEWSTEAD, topPercent: undefined, selective: false };
  // "Girls · mixed sixth form" stands for Sixth form too (Fix 25).
  assert.deepEqual(schoolTags(plain).map((tag) => tag.label), ["Secondary", "Girls · mixed sixth form"]);
  assert.deepEqual(schoolTags({ ...plain, intake: "Girls" }).map((tag) => tag.label), ["Secondary", "Sixth form", "Girls"]);
  assert.deepEqual(schoolTags(PRIVATE).map((tag) => tag.label), ["Private", "Secondary", "Sixth form"]);
  assert.deepEqual(schoolTags({ urn: "100002", name: "B", phase: "primary", latitude: 0, longitude: 0 }).map((tag) => tag.label), ["Primary"]);
});

test("issue #201: a private school with a combined A-level rank shows the rank tag, not a bare Private", () => {
  const ranked: SchoolPoint = { ...PRIVATE, aLevelRank: { rank: 12, pool: 480, year: "2024/25" } };
  assert.deepEqual(schoolTags(ranked).map((tag) => tag.label), ["A level #12 of 480", "Secondary", "Sixth form"]);
  assert.equal(schoolTags(ranked)[0].top, true);
  // No rank: the bare Private tag stays.
  assert.deepEqual(schoolTags(PRIVATE).map((tag) => tag.label), ["Private", "Secondary", "Sixth form"]);
  const view = schoolPopupView(ranked);
  assert.equal(view.position, "#12 of 480 London sixth forms");
  assert.equal(schoolPopupView(PRIVATE).position, null);
  // The filter keeps only schools with a combined A-level rank, every sector.
  const aLevelOnly = { ...DEFAULT_SCHOOL_FILTER, aLevelOnly: true };
  assert.deepEqual([NEWSTEAD, PRIVATE, ranked].filter((point) => schoolShown(point, aLevelOnly)).map((point) => point.urn), ["100001"]);
  assert.equal(schoolCounts([NEWSTEAD, PRIVATE, ranked]).sixthForms, 1);
  // The rank survives the feature round-trip.
  const [feature] = schoolFeatures([ranked]).features;
  assert.deepEqual(schoolPointFromProperties(feature.properties ?? undefined, [ranked.longitude, ranked.latitude]),
    { ...ranked, ofsted: undefined, topPercent: undefined, rankYear: undefined, regionRank: undefined, regionPool: undefined,
      selective: false, faith: undefined });
});

test("faith tags are descriptive words as parents say them", () => {
  assert.deepEqual(["Roman Catholic", "Catholic", "Church of England", "Church of England/Christian", "Jewish", "Unknown", "None", "", null]
    .map(faithTag), ["Catholic", "Catholic", "C of E", "C of E", "Jewish", null, null, null, null]);
});

test("2026-10-20: the plaque, the tag and the page's Results line read one England figure of one year", () => {
  // Montpelier Primary (101912): England 638 of 15,057 = top 5% in 2024/25, 175 of 1,689 in London (11%). The plaque
  // used to read the London place (Silver, 25) and the tag "Top 11% London" while the page said top 5%.
  const montpelier: SchoolPoint = { ...PLAIN, urn: "101912", ofsted: "good", topPercent: 5, rankYear: "2024/25", regionRank: 175, regionPool: 1689 };
  assert.equal(schoolIcon(montpelier).tier, 5);  // the band holds the exact figure …
  assert.equal(schoolTags(montpelier)[0].label, "Top 5% England · 2024/25");  // … the tag names it, its pool and year
  assert.equal(schoolTags(montpelier)[0].top, true);
  assert.equal(schoolPopupView(montpelier).position, "#175 of 1,689 in London");  // London is its own line
  assert.deepEqual([NEWSTEAD, montpelier].filter((point) => schoolShown(point, { ...DEFAULT_SCHOOL_FILTER, measure: { id: "englandTopPercent", threshold: 10 } })).length, 2);
  // The feature carries the year to the popup; a London place without an England figure gives no plaque or tag.
  const [feature] = schoolFeatures([montpelier]).features;
  assert.equal(schoolPointFromProperties(feature.properties ?? undefined, [0, 0])?.rankYear, "2024/25");
  const unranked: SchoolPoint = { ...montpelier, topPercent: undefined, rankYear: undefined };
  assert.equal(schoolIcon(unranked).tier, null);
  assert.ok(!schoolTags(unranked)[0].label.startsWith("Top"));
  assert.equal(schoolPopupView(unranked).position, "#175 of 1,689 in London");
});

test("Fix 23 + Task 1c: the popup's Ofsted swatch, the exact London place; a private school links to GIAS", () => {
  const view = schoolPopupView(NEWSTEAD);
  assert.deepEqual([view.href, view.external, view.ofsted], ["/school/136551", false, { mark: "outstanding", label: "Ofsted: Outstanding" }]);
  assert.equal(view.position, "#12 of 512 in London");
  assert.equal(schoolPopupView({ ...NEWSTEAD, regionRank: 12, regionPool: 2256 }).position, "#12 of 2,256 in London");
  // England coverage (migration 110): a school outside London is placed within its own region.
  assert.equal(schoolPopupView({ ...NEWSTEAD, rankScope: { code: "E12000002", name: "North West" } }).position,
    "#12 of 512 in North West");
  assert.equal(schoolPopupView({ ...NEWSTEAD, ofsted: "report-card" }).ofsted?.label, "New Ofsted report card");
  assert.equal(schoolPopupView({ ...NEWSTEAD, ofsted: undefined }).ofsted, null);
  const independent = schoolPopupView(PRIVATE);
  assert.equal(independent.ofsted, null);
  assert.equal(independent.position, null);
  assert.equal(independent.external, true);
  assert.equal(independent.href, "https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/100001");
  // A private school has no page or ♡ here: its card links to GIAS.
  const card = schoolMapCard(PRIVATE, null);
  assert.deepEqual([card.detail, card.view.external, card.save], ["Private secondary school", true, null]);
});

test("a rendered feature gives its point back; a fold gives none", () => {
  const [feature] = schoolFeatures([NEWSTEAD, PRIVATE]).features;
  assert.deepEqual(schoolPointFromProperties(feature.properties ?? undefined, [NEWSTEAD.longitude, NEWSTEAD.latitude]), { ...NEWSTEAD, faith: undefined });
  assert.equal(schoolPointFromProperties({ urn: "x" }, [0, 0]), null);
  assert.equal(schoolPointFromProperties({ cluster: true, point_count: 4, best: 5612 }, [0, 0]), null);
});

test("Fix 25: the card's intake tag is the API's label, else GIAS gender", () => {
  const profile = { gias: { gender: "Girls" }, intake: { label: "Girls · mixed sixth form", mixedSixthForm: true } } as unknown as SchoolProfile;
  assert.equal(intakeLabel(profile, null), "Girls · mixed sixth form");
  assert.equal(intakeLabel({ ...profile, intake: undefined }, null), "Girls");
  assert.equal(intakeLabel(null, "Mixed"), "Mixed");
});

test("Fix 25: a girls' school with a mixed sixth form has one intake tag in the card header", () => {
  const card = demoSchoolCard("100002")!;
  const girls = (intake: SchoolProfile["intake"]) =>
    schoolHeaderTags({ ...card, profile: { ...card.profile!, gias: { ...card.profile!.gias!, gender: "Girls" }, intake } });
  const mixed = girls({ label: "Girls · mixed sixth form", mixedSixthForm: true });
  assert.ok(mixed.includes("Girls · mixed sixth form"), mixed.join(" | "));
  assert.ok(!mixed.includes("Sixth form"), "the intake tag stands for Sixth form");
  const plain = girls({ label: "Girls", mixedSixthForm: false });
  assert.ok(plain.includes("Girls") && plain.includes("Sixth form"), plain.join(" | "));
});
