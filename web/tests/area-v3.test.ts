import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AreaTiles, AreaVerdict } from "../src/components/area-standouts";

import { gpEssential } from "../src/lib/area-health";
import { rateChip, spanWords, stableWords } from "../src/lib/area-safety";
import { budgetFit, chosenTypes, mergeTags, pageTailor, personalTags, tailorLine, typeOrder } from "../src/lib/area-tailor";
import type { GeographyId, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import type { MarketTypeStats } from "../src/lib/market";
import type { PeopleCategory } from "../src/lib/people-profile";
import { deprivationWords, densityWords, leadLine, shareChip, shareRows, shareScale } from "../src/lib/share-rows";
import { readStandouts, STANDOUT_TILE_IDS, stripPosition, type StandoutTag } from "../src/lib/standouts";
import { fixtureStandouts } from "../src/lib/standouts-fixture";

const profile = (extra: Partial<PreferenceProfile>): PreferenceProfile => ({ ...structuredClone(DEFAULT_PROFILE), ...extra });

const stats = (propertyType: MarketTypeStats["propertyType"], median: number, p25: number, p75: number, p95: number, max: number, sales = 20): MarketTypeStats => ({
  propertyType, sales, medianPrice: median, p5: p25 * 0.8, p25, p75, p95, minPrice: p25 * 0.7, maxPrice: max,
  pricePerSquareMetreSales: sales, medianPricePerSquareMetre: null,
});

test("v3 Fix 27G: the 12 fixed tiles in one order, tags at most 3 pros then 2 cons, never people", () => {
  const demo = fixtureStandouts("uk:lsoa:E01000001" as GeographyId)!;
  assert.deepEqual(demo.tiles.map((tile) => tile.id), [...STANDOUT_TILE_IDS]);
  assert.equal(readStandouts(demo, "demo")?.tiles.length, 12);
  // Real mode never takes the demo's figures; a payload missing a tile is refused.
  assert.equal(readStandouts(demo, "real"), null);
  assert.equal(readStandouts({ ...demo, tiles: demo.tiles.slice(1) }, "demo"), null);
  const pros = demo.tags.filter((tag) => tag.kind === "pro");
  const cons = demo.tags.filter((tag) => tag.kind === "con");
  assert.ok(pros.length <= 3 && cons.length <= 2);
  assert.deepEqual(demo.tags.map((tag) => tag.kind), [...pros, ...cons].map((tag) => tag.kind));
  assert.ok(demo.tags.every((tag) => !/income|depriv|social|ethnic|religion|people/i.test(tag.text + tag.id)));
  // A tile without data stays in place and has no strip position.
  const air = demo.tiles.find((tile) => tile.id === "air")!;
  assert.equal(air.available, false);
  assert.equal(stripPosition(air), null);
  // Neutral price sits on the strip by its raw London percentile.
  assert.equal(stripPosition(demo.tiles[0]), 96);
});

// Owner decision 2026-10-17: deprivation is no tile, but tags at London's 10% ends in the People chip's words.
test("a deprivation tag reads like the People chip and leads to People; the 12 tiles stay", () => {
  const demo = fixtureStandouts("uk:lsoa:E01000001" as GeographyId)!;
  const tags: StandoutTag[] = [
    { id: "deprivation", kind: "pro", text: "Among London's least deprived 10%", section: "people" },
    { id: "deprivation", kind: "con", text: "Among London's most deprived 10%", section: "people" },
  ];
  const read = readStandouts({ ...demo, tags }, "demo")!;
  assert.deepEqual(read.tiles.map((tile) => tile.id), [...STANDOUT_TILE_IDS]);
  assert.ok(!(STANDOUT_TILE_IDS as readonly string[]).includes("deprivation"));
  assert.equal(`Deprivation: ${read.tags[0].text.replace(/^Among/, "among")}`, deprivationWords(95));
  assert.equal(`Deprivation: ${read.tags[1].text.replace(/^Among/, "among")}`, deprivationWords(5));
  const html = renderToStaticMarkup(createElement(AreaVerdict, { standouts: read }));
  assert.match(html, /href="#people"[^>]*>.*Among London&#x27;s least deprived 10%/);
});

test("v3 Fix 33: tailoring reads house types, the household's own budget and the first pinned place", () => {
  assert.deepEqual(chosenTypes({ houseTypes: ["detached", "terraced"] }), ["T", "D"]);
  assert.deepEqual(chosenTypes({ propertyType: "house" }), ["T", "S", "D"]);
  assert.deepEqual(chosenTypes({ propertyType: "flat" }), ["F"]);
  assert.deepEqual(chosenTypes({}), []);
  // The default profile's budget is never shown as the household's.
  const unset = pageTailor(DEFAULT_PROFILE, false);
  assert.equal(unset.active, false);
  assert.equal(unset.budget, null);
  assert.equal(tailorLine(unset), "");
  const tailored = pageTailor(profile({ maximumBudget: 1_200_000, bedrooms: 3, houseTypes: ["terraced", "semi", "detached"] }), true);
  assert.equal(tailorLine(tailored), "Buy ≤ £1.2m · 3-bed · Terraced, Semi, Detached");
  // Types only reorder: the user's first, the rest after, none dropped.
  assert.deepEqual(typeOrder(tailored), ["T", "S", "D", "F"]);
  assert.deepEqual(typeOrder(unset), ["F", "T", "S", "D"]);
});

test("v3 Fix 33a: budget fit from the dearest and the quartiles; personal tags first", () => {
  const terraced = stats("T", 474_000, 430_000, 520_000, 590_000, 640_000);
  const detached = stats("D", 836_000, 766_000, 948_000, 1_250_000, 1_600_000);
  assert.equal(budgetFit(terraced, 1_200_000), "all");
  assert.equal(budgetFit(detached, 1_200_000), "most");
  assert.equal(budgetFit(detached, 800_000), "some");
  assert.equal(budgetFit(detached, 650_000), "few");
  assert.equal(budgetFit(detached, 100_000), "none");
  assert.equal(budgetFit(stats("F", 325_000, 312_000, 330_000, 340_000, 345_000, 4), 1_000_000), null);
  const tailor = { ...pageTailor(profile({ maximumBudget: 1_200_000, houseTypes: ["detached"] }), true), place: { label: "King's Cross", minutes: 52, targetMinutes: 45 } };
  const mine = personalTags(tailor, [terraced, detached], null);
  assert.deepEqual(mine.map((tag) => [tag.kind, tag.text]), [["pro", "Within budget"], ["con", "Fails: King's Cross 52 min"]]);
  const merged = mergeTags(mine, [
    { kind: "pro" as const, text: "a", section: "price" as const }, { kind: "pro" as const, text: "b", section: "price" as const },
    { kind: "pro" as const, text: "c", section: "price" as const }, { kind: "con" as const, text: "d", section: "price" as const },
    { kind: "con" as const, text: "e", section: "price" as const },
  ]);
  assert.deepEqual(merged.map((tag) => tag.text), ["Within budget", "a", "b", "Fails: King's Cross 52 min", "d"]);
});

const category = (id: string, label: string, share: number | null, regionShare: number | null): PeopleCategory => ({
  id, label, count: share === null ? null : Math.round(share * 1000), share, regionShare,
});

test("v3 Fix 29: one row per category, top 4 + Other, chips at 5 points, ages in order, no religion lead", () => {
  const ethnicity = [
    category("white-british", "White British", 0.79, 0.368), category("other-white", "Other White", 0.043, 0.147),
    category("indian", "Indian", 0.04, 0.075), category("chinese", "Chinese", 0.025, 0.017),
    category("black-african", "Black African", 0.024, 0.079), category("other", "Any other group", 0.013, 0.047),
  ];
  const folded = shareRows("ethnicity", ethnicity);
  assert.equal(folded.folded, true);
  assert.deepEqual(folded.rows.map((row) => row.label), ["White British", "Other White", "Indian", "Chinese", "Other"]);
  assert.equal(folded.rows[0].chip, "+42");
  assert.equal(folded.rows[2].chip, null);
  assert.ok(Math.abs(folded.rows[4].share! - 0.037) < 1e-9);
  assert.equal(shareRows("ethnicity", ethnicity, true).rows.length, 6);
  // Tailoring puts the household's own row first and keeps it out of Other (it reorders and highlights, never hides).
  assert.deepEqual(shareRows("ethnicity", ethnicity, false, ["other"]).rows.map((row) => row.label),
    ["Any other group", "White British", "Other White", "Indian", "Other"]);
  assert.equal(shareRows("ethnicity", ethnicity, true, ["other"]).rows[0].label, "Any other group");
  assert.equal(shareRows("ethnicity", ethnicity, true, ["other"]).rows.length, 6);
  const ages = [
    category("0-14", "0 to 14", 0.161, 0.181), category("15-24", "15 to 24", 0.109, 0.123), category("25-44", "25 to 44", 0.158, 0.341),
    category("45-64", "45 to 64", 0.292, 0.237), category("65-plus", "65 and over", 0.28, 0.119),
  ];
  assert.deepEqual(shareRows("age", ages).rows.map((row) => row.id), ["0-14", "15-24", "25-44", "45-64", "65-plus"]);
  assert.equal(leadLine("age", ages), "Aged 25–44: 16% here, 34% in London");
  assert.equal(leadLine("religion", [category("christian", "Christian", 0.546, 0.407)]), null);
  assert.equal(shareChip(0.39, 0.36), null);
  assert.equal(shareChip(0.246, 0.39), "−14");
  assert.equal(shareScale(folded.rows), 0.8);
  assert.equal(deprivationWords(100), "Deprivation: among London's least deprived 10%");
  assert.equal(deprivationWords(4), "Deprivation: among London's most deprived 10%");
  assert.equal(deprivationWords(50), "Deprivation: around London's middle");
  assert.equal(densityWords({ residents: 1563, year: 2024, areaKm2: 0.54, densityPerKm2: 2898, regionDensityPerKm2: 5690, sourceVersion: "x" }),
    "2,898 people / km² · half London's density");
});

test("v3 Fix 33b: crime line only on a 15% move, else stable in words; rate chips against London", () => {
  assert.equal(stableWords({ from: "2023-08", to: "2026-08", months: 36, changePercent: -6, stable: true, points: [] }), "Stable over 3 years");
  assert.equal(stableWords({ from: "2025-09", to: "2026-08", months: 11, changePercent: -11, stable: true, points: [] }), "Stable over 11 months");
  assert.equal(stableWords({ from: "2023-08", to: "2026-08", months: 36, changePercent: 22, stable: false, points: [] }), null);
  // A moved rate's row says how long it covers, never "over 1 years".
  assert.equal(spanWords(11), "11 months");
  assert.equal(spanWords(12), "1 year");
  assert.equal(spanWords(36), "3 years");
  assert.equal(rateChip(7, 31), "−24");
  assert.equal(rateChip(5.1, 9.1), "−4.0");
  assert.equal(rateChip(2.6, 3), null);
});

test("v3 Fix 33c: Local places' GP row is NHS England's (as Health and the GP tag), never a branch surgery on the map", () => {
  const gp = { patientsPerGp: null, practices: 0, nearestMetres: 1270, month: "2026-10", regionPercentile: null, withinMetres: 1000 };
  assert.deepEqual(gpEssential(gp), { name: "None within 1 km", distance: "1.27 km" });
  assert.deepEqual(gpEssential({ ...gp, practices: 2, nearestMetres: 389 }), { name: "2 within 1 km", distance: "389 m" });
  assert.equal(gpEssential({ ...gp, nearestMetres: null }), null);
  assert.equal(gpEssential(null), null);
});

// v4 Task 12: the map sheet's peek shows the same tiles and tags as full height, only the first four
// tiles and no "Show all"; each leads to the full area page at its section, never an x/10 or "Details ›".
test("v4 Task 12: peek tiles are the first four, link to the full page and carry no x/10 rating", () => {
  const read = fixtureStandouts("uk:lsoa:E01000001" as GeographyId)!;
  const page = (section: string) => `/area/lsoa/E01000001#${section}`;
  const html = renderToStaticMarkup(createElement(AreaTiles, { standouts: read, limit: 4, href: (tile) => page(tile.section ?? "overview") }));
  const ids = [...html.matchAll(/data-testid="area-tile-([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, STANDOUT_TILE_IDS.slice(0, 4));
  assert.doesNotMatch(html, /Show all|area-tiles-more|data-phone-extra/);
  assert.match(html, /href="\/area\/lsoa\/E01000001#price"/);
  assert.doesNotMatch(html, /\/10|Details/);
  const full = renderToStaticMarkup(createElement(AreaTiles, { standouts: read }));
  assert.equal([...full.matchAll(/data-testid="area-tile-/g)].length, STANDOUT_TILE_IDS.length);
  assert.match(full, /Show all 12/);
  const tags = renderToStaticMarkup(createElement(AreaVerdict, { standouts: read, href: page }));
  assert.match(tags, /href="\/area\/lsoa\/E01000001#/);
  assert.doesNotMatch(tags, /href="#/);
});
