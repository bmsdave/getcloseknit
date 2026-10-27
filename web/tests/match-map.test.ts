import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { GeographyId, MatchPack, MatchResult } from "../src/lib/contracts";
import { bottomBriefAreasFor } from "../src/lib/match-brief";
import {
  bottomAreas, inBottomDecile, MATCH_BANDS, MATCH_HATCH, MATCH_HATCH_NIGHT, matchBand, matchHatchPixels, matchHatchSwatch, matchInk, matchMapValue,
  matchPercentiles, outAreas, parseMatchList,
} from "../src/lib/match-map";
import { parseMapState, serializeMapState } from "../src/lib/map-state";
import { drawBarStatus } from "../src/lib/zones";

/** WCAG contrast of two hex colours. */
function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const id = (n: number) => `uk:lsoa:E0100${String(n).padStart(4, "0")}` as GeographyId;

function result(n: number, score: number | null, extra: Partial<MatchResult> = {}): MatchResult {
  return {
    geographyId: id(n), name: `Area ${n}`, score, rank: null, evidenceCompleteness: 100, excluded: false, unmetLimits: [],
    sourceReleaseSet: "test", components: [], rankScore: score ?? undefined, ...extra,
  };
}

function pack(values: MatchResult[], extra: Partial<MatchPack> = {}): MatchPack {
  return { schemaVersion: "match-pack.v2", profileVersion: "preference-profile.v2", sourceReleaseSet: "test", values, ...extra };
}

test("7 bands by percentile: top 5% deep blue … bottom 5% deep red, the middle near white (V4-21e)", () => {
  assert.deepEqual(MATCH_BANDS, ["#b2182b", "#ef8a62", "#fddbc7", "#f2f2f2", "#d1e5f0", "#67a9cf", "#2166ac"]);
  const cases: [number, number][] = [[0, 0], [4.9, 0], [5, 1], [19, 1], [20, 2], [39, 2], [40, 3], [59, 3], [60, 4], [79, 4], [80, 5], [94, 5], [95, 6], [100, 6]];
  assert.deepEqual(cases.map(([percentile]) => matchBand(percentile)), cases.map(([, band]) => band));
  assert.equal(matchMapValue(null), null);
  assert.equal(matchMapValue(undefined), null);
});

test("a ranked pack keeps its own percentiles; a live (unranked) one ranks by score, ties by id", () => {
  const ranked = pack([result(1, 90, { rank: 1, percentile: 100 }), result(2, 40, { rank: 2, percentile: 0 }),
    result(3, null, { excluded: true, unmetLimits: ["range:crime:outside"] })]);
  assert.deepEqual([...matchPercentiles(ranked)], [[id(1), 100], [id(2), 0]]);
  // A dragged slider: ranks are null, so the percentile comes from the precise score.
  const live = pack([result(1, 20), result(2, 80), result(3, 50), result(4, 50), result(5, 10, { excluded: true })]);
  assert.deepEqual(Object.fromEntries(matchPercentiles(live)), { [id(2)]: 100, [id(3)]: 67, [id(4)]: 33, [id(1)]: 0 });
  assert.deepEqual([...matchPercentiles(pack([result(7, 55)]))], [[id(7), 100]], "one scored area is the best");
});

test("failing a Must is hatched, never red: out areas have no band and are listed for the hatch", () => {
  const values = [result(1, 90, { rank: 1, percentile: 100 }), result(2, 5, { rank: 2, percentile: 0 }),
    result(3, null, { excluded: true, unmetLimits: ["budget:over"] })];
  const p = pack(values);
  const percentiles = matchPercentiles(p);
  assert.equal(matchMapValue(percentiles.get(id(2))), 0, "scored low reads red");
  assert.equal(matchMapValue(percentiles.get(id(3))), null, "out is grey under the hatch");
  assert.deepEqual(outAreas(p), [id(3)]);
  // The hatch is light: a thin grey stripe over a light veil, the same in the legend's key.
  const pixels = matchHatchPixels();
  assert.equal(pixels.length, 8 * 8 * 4);
  assert.deepEqual([...pixels.slice(0, 4)], [...MATCH_HATCH.stripe]);
  assert.deepEqual([...pixels.slice(4 * 4, 4 * 4 + 4)], [...MATCH_HATCH.veil]);
  assert.ok(MATCH_HATCH.stripe[3] < 150, "lighter than the v3 hatch that read as dirt");
  assert.match(matchHatchSwatch("#d1d5d3"), /^repeating-linear-gradient\(45deg, rgba\(91, 98, 112, 0\.55\) 0 3px, rgba\(255, 255, 255, 0\.35\) 3px 8px\), #d1d5d3$/);
});

test("Bottom 10: the pack's list (least first), else the lowest percentiles; the popup badge is red under 10%", () => {
  const values = Array.from({ length: 30 }, (_, index) => result(index + 1, 100 - index * 3));
  const live = pack(values);
  assert.deepEqual(bottomAreas(live), Array.from({ length: 10 }, (_, index) => id(30 - index)));
  const withList = pack(values, { bottom: [{ geographyId: id(5), rank: 30, percentile: 0, score: 1, weakest: [] }] });
  assert.deepEqual(bottomAreas(withList), [id(5)]);
  assert.deepEqual(bottomAreas(null), []);
  assert.deepEqual(bottomBriefAreasFor(live, id(1)).slice(0, 3), [id(1), id(30), id(29)], "the selected area first, then −1, −2");
  assert.equal(inBottomDecile(9), true);
  assert.equal(inBottomDecile(10), false);
  assert.equal(inBottomDecile(null), false);
});

test("MapState matchList: ?list=bottom on My match, written only when it is the bottom", () => {
  assert.equal(parseMatchList("bottom"), "bottom");
  assert.equal(parseMatchList("top"), "top");
  assert.equal(parseMatchList("worst"), "top");
  const state = parseMapState(new URLSearchParams("layer=personal-match&list=bottom"));
  assert.equal(state.matchList, "bottom");
  assert.match(serializeMapState(state), /(^|&)list=bottom(&|$)/);
  assert.equal(parseMapState(new URLSearchParams("layer=personal-match")).matchList, undefined);
  // Never carried onto another layer's link.
  assert.doesNotMatch(serializeMapState({ ...state, layer: "crime" }), /list=/);
  assert.doesNotMatch(serializeMapState({ ...state, matchList: "top" }), /list=/);
});

test("zones and outlines use the theme's ink, readable on the snow and the navy basemap (G5 Task 29)", () => {
  assert.equal(matchInk("day"), "#22252c");
  assert.equal(matchInk("night"), "#f4f7fa");
  assert.ok(contrastRatio(matchInk("night"), "#16203a") > 7);
  assert.ok(contrastRatio(matchInk("day"), "#ffffff") > 7);
});

test("at night the Must hatch recedes: a navy veil and muted stripes, never brighter than the basemap (G5 Task 29)", () => {
  const pixels = matchHatchPixels("night");
  assert.deepEqual([...pixels.slice(0, 4)], [...MATCH_HATCH_NIGHT.stripe]);
  assert.deepEqual([...pixels.slice(4 * 4, 4 * 4 + 4)], [...MATCH_HATCH_NIGHT.veil]);
  // The veil is the night basemap's navy (#16203a), mostly opaque, so the grey under it does not glow.
  assert.deepEqual(MATCH_HATCH_NIGHT.veil.slice(0, 3), [22, 32, 58]);
  assert.ok(MATCH_HATCH_NIGHT.veil[3] >= 160);
  assert.match(matchHatchSwatch("#d1d5d3", "night"), /rgba\(22, 32, 58, 0\.78\) 3px 8px\), #d1d5d3$/);
});

test("the drawing bar counts the corners of the zone being drawn", () => {
  assert.deepEqual(drawBarStatus(0), { lead: "Tap corners", count: " · 0 so far" });
  assert.equal(`${drawBarStatus(4).lead}${drawBarStatus(4).count}`, "Tap corners · 4 so far");
});

// Per user only (V4-21e): no bottom list or red map on area pages, rankings or SEO pages.
test("the match ramp and the bottom list never reach public pages", () => {
  const root = new URL("../src/", import.meta.url).pathname;
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
  const publicDirs = ["app/area", "app/rankings", "app/postcode", "app/sector", "app/school", "app/property", "app/explore", "app/guide",
    "app/compare", "app/brief", "app/tools", "components/area-page", "components/rankings"];
  const checked = publicDirs.flatMap((dir) => { try { return files(join(root, dir)); } catch { return []; } });
  assert.ok(checked.length > 10, "the public pages were found");
  for (const file of checked) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /lib\/match-map|Least like your search|bottomAreas|list=bottom/, file);
  }
  for (const word of ["avoid", "worst"]) {
    assert.doesNotMatch(readFileSync(join(root, "lib/match-map.ts"), "utf8").replace(/never "avoid" or "worst"|"avoid"\/"worst"/g, ""),
      new RegExp(`Least like.*${word}|${word} areas`, "i"));
  }
});
