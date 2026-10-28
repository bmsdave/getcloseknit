import assert from "node:assert/strict";
import test from "node:test";

import { mergeTags, pageTailor, personalTags } from "../src/lib/area-tailor";
import type { GeographyId, MatchComponent, MatchCriterion, MatchPack, MatchResult, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { clearOfControls, coveredLabels, pinOffsets, type PinBox } from "../src/lib/map-clearance";
import { preserveDiagnosticsQuery } from "../src/lib/map-state";
import type { MarketTypeStats } from "../src/lib/market";
import { matchExtrasOn } from "../src/lib/match-extras";
import { matchPercentiles, outAreas } from "../src/lib/match-map";
import { budgetFromTarget, searchCriteria, setBudget, withCriteria, type SearchItem } from "../src/lib/match-search";
import { tieNote, whyParts } from "../src/lib/match-words";

const id = (n: number) => `uk:lsoa:E0100${String(n).padStart(4, "0")}` as GeographyId;
const profile = (extra: Partial<PreferenceProfile> = {}): PreferenceProfile => ({ ...structuredClone(DEFAULT_PROFILE), ...extra });

function result(n: number, score: number | null, extra: Partial<MatchResult> = {}): MatchResult {
  return {
    geographyId: id(n), name: `Area ${n}`, score, rank: null, rankScore: score ?? undefined, evidenceCompleteness: 100,
    excluded: false, unmetLimits: [], sourceReleaseSet: "t", components: [], ...extra,
  };
}
const pack = (values: MatchResult[], extra: Partial<MatchPack> = {}): MatchPack =>
  ({ schemaVersion: "match-pack.v2", profileVersion: "preference-profile.v2", sourceReleaseSet: "t", values, ...extra });

test("v4.6 CUJ08: a group laid out wider than it sat never lands on the pin beside it", () => {
  // Pins 1 and 2 overlap; laid side by side they reach pin 3, which touched neither: all three join one layout.
  const boxes: PinBox[] = [{ x: 100, y: 100, width: 90, height: 24 }, { x: 110, y: 100, width: 90, height: 24 }, { x: 205, y: 100, width: 24, height: 24 }];
  const offsets = pinOffsets(boxes, 4);
  const placed = boxes.map((box, index) => ({ ...box, x: box.x + offsets[index][0], y: box.y + offsets[index][1] }));
  for (let one = 0; one < placed.length; one += 1) {
    for (let other = one + 1; other < placed.length; other += 1) {
      const a = placed[one], b = placed[other];
      const apart = Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2;
      assert.ok(apart, `pins ${one + 1} and ${other + 1} overlap`);
    }
  }
  // Pins already apart stay where they are.
  assert.deepEqual(pinOffsets([{ x: 0, y: 0, width: 20, height: 20 }, { x: 100, y: 0, width: 20, height: 20 }], 4), [[0, 0], [0, 0]]);
});

test("v4.6 CUJ01 / Task 26: a secondary label on a pin, a place card, a control or an earlier label is hidden", () => {
  const card = { left: 100, top: 100, right: 300, bottom: 140 };
  const legend = { left: 0, top: 800, right: 320, bottom: 900 };
  const labels = [
    { left: 250, top: 120, right: 330, bottom: 140 }, // "Bus 476" over the place card
    { left: 10, top: 820, right: 200, bottom: 840 }, // a station under the legend
    { left: 500, top: 500, right: 560, bottom: 520 }, // clear
    { left: 520, top: 505, right: 580, bottom: 525 }, // on the one before it
    { left: 600, top: 600, right: 600, bottom: 600 }, // not laid out: never hidden
  ];
  assert.deepEqual(coveredLabels(labels, [card], [legend]), [true, true, false, true, false]);
});

test("v4.6 CUJ06: the top 10's fit clears the controls column and the legend, never the whole map", () => {
  const frame = { left: 0, top: 0, right: 390, bottom: 844 };
  const base = { top: 80, bottom: 420, left: 24, right: 24 };
  // Phone at half: the column (my location, the round buttons) on the right, the legend over the sheet.
  const padded = clearOfControls(frame, base, [{ left: 334, top: 300, right: 378, bottom: 410 }], [{ left: 62, top: 360, right: 326, bottom: 410 }]);
  assert.equal(padded.right, 390 - 334 + 12);
  assert.equal(padded.bottom, 844 - 360 + 12);
  assert.equal(padded.top, 80);
  // A control under the sheet (below the covered bottom) adds nothing; some map always stays in view.
  assert.equal(clearOfControls(frame, base, [], [{ left: 62, top: 600, right: 326, bottom: 650 }]).bottom, 420);
  const wide = clearOfControls(frame, base, [{ left: 200, top: 300, right: 378, bottom: 410 }], [{ left: 0, top: 90, right: 390, bottom: 410 }]);
  assert.ok(390 - wide.left - wide.right >= 120);
  assert.ok(844 - wide.top - wide.bottom >= 120);
});

const place = (placeId: string, label: string): MatchCriterion =>
  ({ kind: "place", id: placeId, label, target: { kind: "point", latitude: 51.5, longitude: -0.1 }, mode: "transit", targetMinutes: 30, must: false });
const items: SearchItem[] = [
  { id: "place:kx", criterion: place("kx", "King's Cross"), must: false, rank: 1, weight: 0.6 },
  { id: "range:crime", criterion: { kind: "range", layer: "crime", scale: "percentile", min: null, max: 50, softMin: null, softMax: 75, must: false }, must: false, rank: 2, weight: 0.4 },
];
const component = (factorId: string, rawValue: number, extra: Partial<MatchComponent> = {}): MatchComponent =>
  ({ factorId, rawValue, fit: 1, weight: 0.5, unit: "min", quality: "observed", sourceVersion: "t", ...extra } as MatchComponent);

test("v4.6 CUJ01/CUJ08: tied scores say what orders them, and each tied row leads with #1's then #2's value", () => {
  assert.equal(tieNote([100, 100, 100, 93], items), "Tied at 100 · ordered by #1 King's Cross, then #2 Safer streets");
  assert.equal(tieNote([100, 93, 88], items), null);
  assert.equal(tieNote([100, 100], []), null);
  // A budget-only search ties on its Must: the API orders it by the typical price, and the note says so.
  const budgetOnly: SearchItem[] = [{ id: "affordability", criterion: { kind: "budget", must: true }, must: true, rank: null, weight: 0 }];
  assert.equal(tieNote([100, 100], budgetOnly), "Tied at 100 · ordered by Budget");
  const cheap = result(1, 100, { components: [component("affordability", 273_000)], reasons: [] });
  assert.equal(whyParts(cheap, budgetOnly, profile(), true)[0].text, "typical £273k");
  const row = result(1, 100, { components: [component("place:kx", 17), component("range:crime", 12, { percentile: 26 })], reasons: ["range:crime"] });
  const tied = whyParts(row, items, profile(), true);
  assert.equal(tied[0].text, "#1 King's Cross 17′");
  assert.equal(tied.length, 2);
  // Not tied: the strongest reasons, as before.
  assert.deepEqual(whyParts(row, items, profile()).map((part) => part.id), ["range:crime"]);
});

test("G-E13/G-E14: a criterion with no data here says not scored; an unrouted pin's minutes say est.", () => {
  // Greater Manchester publishes no crime: Safer streets is half a fit there, and the row says so.
  const row = result(1, 75, { components: [component("place:kx", 4, { quality: "fallback" })], reasons: ["place:kx"], evidenceCompleteness: 60 });
  const parts = whyParts(row, items, profile());
  assert.deepEqual(parts.map((part) => [part.mark, part.text]), [["in", "#1 King's Cross 4′ est."], ["none", "#2 Safer streets: no data"]]);
  // A routed pin (through a commute hub) is no estimate; nothing missing, nothing added.
  const routed = result(2, 90, { components: [component("place:kx", 17), component("range:crime", 12, { percentile: 26 })], reasons: ["place:kx"] });
  assert.deepEqual(whyParts(routed, items, profile()).map((part) => part.text), ["#1 King's Cross 17′"]);
});

test("v4.6 CUJ06/CUJ11: a tool's price is the budget, a Must (over it hatched), and the stretch fades above it", () => {
  assert.deepEqual(budgetFromTarget(570_000, "buy"), { targetBudget: 570_000, maximumBudget: 620_000 });
  assert.deepEqual(budgetFromTarget(500_000, "buy"), { targetBudget: 500_000, maximumBudget: 545_000 });
  const next = setBudget(profile(), { market: "buy", target: 570_000 });
  assert.equal(next.targetBudget, 570_000);
  assert.equal(next.maximumBudget, 620_000);
  assert.equal(searchCriteria(next).find((item) => item.kind === "budget")?.must, true);
  // A ranked budget already in the search turns Must too; a typed maximum keeps its own.
  const typed = setBudget(profile(), { market: "buy", maximum: 600_000 });
  const ranked = withCriteria(typed, searchCriteria(typed).map((item) => (item.kind === "budget" ? { ...item, must: false } : item)));
  assert.equal(searchCriteria(ranked).find((item) => item.kind === "budget")?.must, false);
  const carried = setBudget(ranked, { target: 500_000 });
  assert.equal(searchCriteria(carried).find((item) => item.kind === "budget")?.must, true);
  // The map hatches a failed Must, never a soft miss (V4-21e): that rule is unchanged.
  const live = pack([result(1, 90), result(2, 0), result(3, null, { excluded: true })]);
  assert.deepEqual(outAreas(live), [id(3)]);
  assert.equal(matchPercentiles(live).has(id(2)), true);
});

test("v4.6 CUJ10: a ranking's rank= stays in the address the map writes", () => {
  assert.equal(new URLSearchParams(preserveDiagnosticsQuery("layer=crime&period=2026-08", "?layer=crime&rank=lowest-crime")).get("rank"), "lowest-crime");
  assert.equal(preserveDiagnosticsQuery("layer=crime", "?layer=crime"), "layer=crime");
  assert.equal(new URLSearchParams(preserveDiagnosticsQuery("layer=crime", "?rank=<script>")).get("rank"), null);
});

const stats = (median: number, p75: number, sales = 40): MarketTypeStats =>
  ({ propertyType: "F", sales, medianPrice: median, p5: median * 0.6, p25: median * 0.85, p75, p95: p75 * 1.3, maxPrice: p75 * 1.6 } as MarketTypeStats);

test("v4.6 CUJ13: the area view tags every household place in My match's order, and the budget as My match reads it", () => {
  const tailor = {
    ...pageTailor(profile({ maximumBudget: 600_000 }), true),
    places: [
      { label: "Work", minutes: 11, targetMinutes: 30, softMinutes: 45 },
      { label: "Gym", minutes: 4, targetMinutes: 10, softMinutes: 15 },
      { label: "Park", minutes: 7, targetMinutes: 5, softMinutes: 8 },
      { label: "Pool", minutes: 40, targetMinutes: 10, softMinutes: 15 },
    ],
  };
  // The typical price (£560k) is inside the budget though the dearer quarter (£700k) is not: "Within budget".
  const tags = personalTags(tailor, [], stats(560_000, 700_000));
  assert.deepEqual(tags.map((tag) => tag.text), ["Within budget", "Work 11 min", "Gym 4 min", "≈ Park 7 min", "Fails: Pool 40 min"]);
  const area = ["a", "b", "c"].map((text) => ({ kind: "pro" as const, text, section: "price" as const }));
  const merged = mergeTags(tags, area);
  assert.deepEqual(merged.filter((tag) => tag.kind === "pro").map((tag) => tag.text), ["Within budget", "Work 11 min", "Gym 4 min", "≈ Park 7 min"]);
  // With one place of their own, the area's pros fill to three as before.
  assert.deepEqual(mergeTags([tags[1]], area).map((tag) => tag.text), ["Work 11 min", "a", "b"]);
});

test("v4.6 CUJ01: My match's older extras wait behind a default-off flag", () => {
  assert.equal(matchExtrasOn(), false);
});
