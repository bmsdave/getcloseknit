import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { AreaCommute } from "../src/lib/commute";
import type { GeographyId, MatchCriterion, MatchPack, MatchResult, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { bottomBriefAreasFor, briefAreasFor, fitRows, matchRows, percentileValue } from "../src/lib/match-brief";
import { itemLine } from "../src/lib/match-words";
import { tripRows } from "../src/components/your-places";

const id = (n: number) => `uk:lsoa:E0100${String(n).padStart(4, "0")}` as GeographyId;

function area(n: number, title: string, score: number, extra: Partial<MatchResult> = {}): MatchResult {
  return {
    geographyId: id(n), name: `Croydon ${String(n).padStart(3, "0")}A`, title, score, rank: n, rankScore: score / 100, evidenceCompleteness: 100,
    excluded: false, unmetLimits: [], sourceReleaseSet: "t", components: [], ...extra,
  };
}

const pack = (values: MatchResult[], extra: Partial<MatchPack> = {}): MatchPack =>
  ({ schemaVersion: "match-pack.v2", profileVersion: "preference-profile.v2", sourceReleaseSet: "t", values, ...extra });

test("round 2 #10/#11: the list's ten are the map's ten: one row (and one pin) per name, numbered alike", () => {
  // Budget only: five New Addington North LSOAs and three Erith East DA8 tie at the top (finding: rows 2–6 one name).
  const names = ["Welling · DA16", ...Array(5).fill("New Addington North · CR0"), ...Array(3).fill("Erith East · DA8"),
    "Erith East · DA17", "Sutton · SM1", "Ilford · IG1", "Barking · IG11", "Hayes · UB3", "Feltham · TW13", "Enfield · EN1", "Romford · RM1"];
  const results = names.map((title, index) => area(index + 1, title, 100 - index));
  const live = pack(results);
  const rows = matchRows(live, null, "top");
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map((row) => row.title)).size, 10, "no name twice");
  assert.deepEqual(rows.slice(0, 4).map((row) => row.title), ["Welling · DA16", "New Addington North · CR0", "Erith East · DA8", "Erith East · DA17"]);
  // The brief (the pins) asks for exactly the rows, in their order.
  assert.deepEqual(briefAreasFor(live, null).slice(0, 10), rows.map((row) => row.geographyId));
  // Bottom 10 the same way: the pack's own bottom list first, one per name.
  const withBottom = pack(results, { bottom: [id(17), id(16), id(9), id(8)].map((geographyId, index) =>
    ({ geographyId, rank: 17 - index, percentile: index, score: 1, weakest: [] })) });
  const bottom = matchRows(withBottom, null, "bottom");
  assert.deepEqual(bottom.slice(0, 3).map((row) => row.geographyId), [id(17), id(16), id(9)]);
  assert.equal(bottom.filter((row) => row.title === "Erith East · DA8").length, 1);
  assert.deepEqual(bottomBriefAreasFor(withBottom, null).slice(0, 10), bottom.map((row) => row.geographyId));
  // Out areas and areas the search scores 0 are never in the ten.
  const out = pack([area(1, "A · N1", 90, { excluded: true }), area(2, "B · N2", 0, { rankScore: 0 }), area(3, "C · N3", 50)]);
  assert.deepEqual(matchRows(out, null, "top").map((row) => row.title), ["C · N3"]);
});

test("round 2 #10: the list and the map pins read one helper (no second ranking in either)", () => {
  const list = readFileSync(new URL("../src/components/match/match-results.tsx", import.meta.url), "utf8");
  const overlays = readFileSync(new URL("../src/components/match/match-overlays.tsx", import.meta.url), "utf8");
  const brief = readFileSync(new URL("../src/components/match/use-match-brief.ts", import.meta.url), "utf8");
  for (const source of [list, overlays]) assert.match(source, /matchRows\(/);
  assert.match(brief, /briefAreasFor\(pack, selected, liked, page, profile\)/);
  assert.doesNotMatch(list, /topTen|bottomTen/);
  assert.doesNotMatch(overlays, /bottomAreas/);
});

test("round 2 #47: the area popup reads the 0–100 score and real units, never x/10", () => {
  const overlays = readFileSync(new URL("../src/components/match/match-overlays.tsx", import.meta.url), "utf8");
  const popup = overlays.slice(overlays.indexOf("export function fitPopup"), overlays.indexOf("/** True once the map is zoomed"));
  assert.doesNotMatch(popup, /\/10|score \/ 10/);
  assert.match(popup, /\$\{result\.score\}<span class="sr-only"> of 100<\/span>/);
  // A London-percentile range ("≤ median") says its bound as the layer's value there, with the unit, as its card does.
  const profile: PreferenceProfile = {
    ...structuredClone(DEFAULT_PROFILE), factors: [], places: [],
    ranges: [{ layer: "crime", min: null, max: 50, softMin: null, softMax: 75, importance: 1, scale: "percentile" }],
  };
  const crime = (n: number, value: number) => area(n, `Area ${n} · N7`, 50, {
    components: [{ factorId: "range:crime", rawValue: value, utility: 0, fit: 0 } as unknown as MatchResult["components"][number]] });
  const values = [10, 20, 40, 65.4, 80, 100, 158, 300, 4459].map((value, index) => crime(index + 1, value));
  const live = pack(values);
  assert.equal(percentileValue(live, "range:crime", 50), 80);
  const lower = values[6];
  const rows = fitRows(lower, profile, live);
  assert.deepEqual(rows.map((row) => [row.name, row.value, row.state, row.note]), [["Crime", "158 / 1,000", "out", "over 80 / 1,000"]]);
  // Without the pack's values the bound stays in London words, never the bare percentile ("over 50").
  assert.equal(fitRows(lower, profile)[0].note, "over London median");
  // The card's line says the unit once.
  const item: MatchCriterion = { kind: "range", layer: "crime", scale: "value", min: null, max: 15, softMin: null, softMax: 22, must: false };
  assert.equal(itemLine(item, profile), "≤ 15 / 1,000 · up to 22");
});

test("round 2 #44: Getting around says the minutes My match scores, an estimate when no hub is near the place", () => {
  const profile: PreferenceProfile = {
    ...structuredClone(DEFAULT_PROFILE),
    places: [{ id: "highbury", label: "Highbury & Islington", target: { kind: "point", latitude: 51.546, longitude: -0.104 }, mode: "transit",
      targetMinutes: 30, weight: 3, must: false }],
  };
  const commute = { schemaVersion: "area-commute.v1", geographyId: id(1), network: { id: "n" }, caveats: [], places: [
    { placeId: "highbury", label: "Highbury & Islington", hub: null, estimate: true, routes: [], paths: {},
      modes: { transit: { minutes: 12, range: [12, 12] }, walk: { minutes: 32, range: [32, 32] } } },
  ] } as AreaCommute;
  assert.deepEqual(tripRows(profile, commute).map((row) => [row.term, row.value]), [["Highbury & Islington", "12 min · estimate"]]);
  // G-E14: a wider area's page (MSOA, LAD) has no times of its own: it says so, never drops the place.
  assert.deepEqual(tripRows(profile, null, "uk:msoa:E02001089" as GeographyId).map((row) => [row.term, row.value]),
    [["Highbury & Islington", "Times per neighbourhood"]]);
  // An area outside London's routing: the place stays, said as London only (My match marks its minutes est.).
  const outside = { ...commute, places: [{ ...commute.places[0], estimate: undefined, reason: "outside-coverage" as const,
    modes: { transit: { minutes: null, range: null } } }] } as AreaCommute;
  assert.deepEqual(tripRows(profile, outside).map((row) => row.value), ["Door to door: London only"]);
});

test("round 2 #29/#34: chips come first for a shared search too, and the editor never moves in the tree", () => {
  const panel = readFileSync(new URL("../src/components/personal-match-panel.tsx", import.meta.url), "utf8");
  // One {editor} slot, never inside a ternary that swaps it with the results.
  assert.equal(panel.split("{editor}").length - 1, 1);
  assert.doesNotMatch(panel, /\? editor :|: editor\}/);
  // CUJ08 step 2: chips in priority order, then the count and the top 10, whoever made the search.
  assert.doesNotMatch(panel, /resultsFirst/);
  assert.ok(panel.indexOf("{editor}") < panel.indexOf("{resultsNode}"));
});

test("round 2 #46/#35: the desktop panel header is solid and sticky, and Top 10 › lands under it", () => {
  const css = readFileSync(new URL("../src/styles/layout.css", import.meta.url), "utf8");
  assert.match(css, /\.match-panel > \.match-panel-title \{\s*position: sticky; top: 0;/);
  assert.match(css, /\.match-results-anchor \{ scroll-margin-top: 58px; \}/);
});
