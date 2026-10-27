import assert from "node:assert/strict";
import test from "node:test";

import { boroughSortParam, rankingBoroughsHref, rankingBySlug, rankingGroupAnchor, rankingMapHref, rankingTopHref, type AreaRanking } from "../src/lib/area-pages";
import type { AreaBrief } from "../src/lib/brief-model";
import { placesByPriority, type AreaCommute } from "../src/lib/commute";
import type { GeographyId, MatchResult, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { budgetFitFor, fitRows, refitBrief } from "../src/lib/match-brief";
import { addCriterion, freshSearch, moveCriterion, searchItems, setBudget } from "../src/lib/match-search";
import { budgetRange } from "../src/lib/match-words";
import { addressLabel, placeKindOptions } from "../src/lib/place-kinds";
import { boxCenter, rankingShortTitle, rankParam } from "../src/lib/ranking-top";
import { nearestRows, tripRows } from "../src/components/your-places";

// v4.4 "match-flows": fixes from the final prod check (findings.json 17–20, 25, 36, 39, 45, 46, 62, 63, 77, 79).

const budgeted = (maximum = 650_000): PreferenceProfile => setBudget(freshSearch(structuredClone(DEFAULT_PROFILE)), { market: "buy", maximum });

test("one budget figure everywhere: ✓ up to the comfortable end, a stretch up to the maximum typed, over beyond (finding 39)", () => {
  const profile = budgeted();
  assert.equal(budgetRange(profile), "≤ £600k–£650k");
  // The prod case: "2-bed ~£646k · within budget" under a "≤ £600k" chip. Now a stretch.
  assert.equal(budgetFitFor(646_000, profile), "stretch");
  assert.equal(budgetFitFor(600_000, profile), "within");
  assert.equal(budgetFitFor(651_000, profile), "over");
  assert.equal(budgetFitFor(null, profile), "unknown");
  const brief = {
    areas: [{ geographyId: "uk:lsoa:E01000001", estimatedPrice: 646_000, budgetFit: "within" }],
    ring: [{ geographyId: "uk:lsoa:E01000002", estimatedPrice: 590_000, budgetFit: "within" }],
  } as unknown as AreaBrief;
  const refit = refitBrief(brief, profile);
  assert.deepEqual([refit.areas[0].budgetFit, refit.ring[0].budgetFit], ["stretch", "within"]);
});

test("the popup's price row reads the same: ≈ on the edge between £600k and £650k, even under a Must (finding 39)", () => {
  const profile = budgeted();
  const row = (price: number) => fitRows({
    geographyId: "uk:lsoa:E01000001", name: "A", score: 80, rank: 1, excluded: false, unmetLimits: [],
    components: [{ factorId: "affordability", rawValue: price, unit: "£ ballpark", utility: 1, weight: 0, fit: 1, fitKind: "in", must: true,
      carrierGeographyId: "uk:lsoa:E01000001", quality: "observed", sourceVersion: "t" }],
  } as unknown as MatchResult, profile)[0];
  assert.deepEqual([row(646_000).state, row(646_000).note], ["edge", "on the edge"]);
  assert.deepEqual([row(580_000).state, row(580_000).note], ["in", null]);
  assert.deepEqual([row(700_000).state, row(700_000).note], ["out", "over budget"]);
});

test("Travel to a kind: \"gym\" offers the nearest gym on foot, the same card as the Gym chip (finding 45)", () => {
  const [gym] = placeKindOptions("gym");
  assert.equal(gym.text, "Gym · ≤ 10 min walk");
  assert.deepEqual(gym.criterion.target, { kind: "category", category: "gym" });
  assert.equal(gym.criterion.mode, "walk");
  assert.equal(gym.criterion.id, "gym");
  assert.deepEqual(placeKindOptions("the gym").map((option) => option.label), ["Gym"]);
  assert.deepEqual(placeKindOptions("gym near work").map((option) => option.label), ["Gym"]);
  assert.deepEqual(placeKindOptions("puregym").map((option) => option.label), ["PureGym", "Gym"]);
  assert.deepEqual(placeKindOptions("swimming").map((option) => option.label), ["Swimming pool"]);
  assert.deepEqual(placeKindOptions("M&S").map((option) => option.text), ["M&S · ≤ 10 min walk", "Supermarket · ≤ 10 min walk"]);
  // Names of places stay addresses and stations.
  assert.deepEqual(placeKindOptions("Clapham Common"), []);
  assert.deepEqual(placeKindOptions("Park Road"), []);
  assert.deepEqual(placeKindOptions("King's Cross"), []);
  assert.deepEqual(placeKindOptions("g"), []);
  // Two letters are a whole word or nothing: "gp" is a GP, "Ba" (Bank) and "St" (Stratford) are not a pub or a station kind.
  assert.deepEqual(placeKindOptions("gp").map((option) => option.label), ["GP"]);
  assert.deepEqual(placeKindOptions("Ba"), []);
  assert.deepEqual(placeKindOptions("St"), []);
});

test("an address picked in Travel to keeps a name, never a bare house number (finding 45: the place was called \"5\")", () => {
  assert.equal(addressLabel("5, The Old Gym, 12 Marshalsea Road, London SE1 1HL"), "The Old Gym");
  assert.equal(addressLabel("12 Marshalsea Road, London"), "12 Marshalsea Road");
  assert.equal(addressLabel("Flat 3, 10 Upper Street, London"), "10 Upper Street");
  assert.equal(addressLabel("N5 1AA"), "N5 1AA");
});

test("the tailored area page lists the household's places #1 first, never dropping one without a time (finding 46)", () => {
  let profile = budgeted();
  const point = (id: string, label: string) => ({ kind: "place" as const, id, label, target: { kind: "point" as const, latitude: 51.5, longitude: -0.1 },
    mode: "transit" as const, targetMinutes: 35, must: false });
  profile = addCriterion(profile, point("old-gym", "The Old Gym"));
  profile = addCriterion(profile, point("highbury", "Highbury & Islington"));
  profile = addCriterion(profile, { kind: "place", id: "park", label: "Park", target: { kind: "category", category: "park" }, mode: "walk", targetMinutes: 10, must: false });
  // Highbury & Islington moved to #1 in My match.
  profile = moveCriterion(profile, "place:highbury", 0);
  assert.deepEqual(placesByPriority(profile).map((place) => place.id), ["highbury", "old-gym", "park"]);
  const commute = {
    places: [
      { placeId: "old-gym", label: "The Old Gym", hub: null, modes: { transit: { minutes: 32, range: [30, 35] } }, routes: [] },
      // No transit time for #1 (a hub without this area): its row stays, with another mode's time.
      { placeId: "highbury", label: "Highbury & Islington", hub: null, modes: { cycle: { minutes: 16, range: [15, 18] } }, routes: [] },
      { placeId: "park", label: "Park", hub: null, modes: { walk: { minutes: 5, range: [5, 5] } }, nearest: { name: "Highbury Fields", metres: 400 } },
    ],
  } as unknown as AreaCommute;
  assert.deepEqual(tripRows(profile, commute).map((row) => [row.term, row.value]),
    [["Highbury & Islington", "16 min by bike"], ["The Old Gym", "32 min"]]);
  assert.deepEqual(nearestRows(profile, commute).map((row) => [row.term, row.value]), [["Park", "Highbury Fields · 5 min walk"]]);
  // Before the times arrive, no half list.
  assert.deepEqual(tripRows(profile, null), []);
});

test("a ranking's On map ↗ opens its layer and month with its top 10; rows keep the month too (findings 20, 77)", () => {
  const crime = rankingBySlug("lowest-crime") as AreaRanking;
  assert.equal(rankingTopHref(crime, "2026-08"), "/?layer=crime&period=2026-08&rank=lowest-crime");
  assert.equal(rankingMapHref(crime, "uk:msoa:E02000598" as GeographyId, "2026-08"), "/?selected=uk%3Amsoa%3AE02000598&layer=crime&period=2026-08");
  const gyms = rankingBySlug("most-gyms") as AreaRanking;
  assert.equal(rankingTopHref(gyms), "/?layer=custom%3Agyms&rank=most-gyms");
  assert.equal(rankParam("?layer=crime&rank=lowest-crime"), "lowest-crime");
  assert.equal(rankParam("?rank=<script>"), null);
  assert.equal(rankingShortTitle("Most expensive areas"), "Most expensive");
  assert.equal(rankingShortTitle("Areas with the least recorded crime"), "Least recorded crime");
  assert.equal(rankingShortTitle("Areas closest to a station"), "Closest to a station");
  assert.deepEqual(boxCenter([[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]]), [1, 2]);
  assert.equal(rankingGroupAnchor("Getting around"), "rankings-getting-around");
});

test("Areas | Boroughs: the boroughs table sorted the ranking's way, only where it has the figure (finding 20)", () => {
  assert.equal(rankingBoroughsHref(rankingBySlug("most-expensive")!), "/area/london?sort=price");
  assert.equal(rankingBoroughsHref(rankingBySlug("lowest-crime")!), "/area/london?sort=crime&dir=asc");
  assert.equal(rankingBoroughsHref(rankingBySlug("most-nightlife")!), "/area/london?sort=going-out");
  assert.equal(rankingBoroughsHref(rankingBySlug("closest-to-a-station")!), null);
  assert.deepEqual(boroughSortParam("crime", "asc"), { by: "crime", dir: "asc" });
  assert.deepEqual(boroughSortParam("crime"), { by: "crime", dir: "desc" });
});

test("a tool's price is the typed maximum: £570k reads £525k–£570k on the chip (findings 17, 62, 63)", () => {
  const profile = budgeted(570_000);
  assert.deepEqual(searchItems(profile).map((item) => [item.id, item.must]), [["affordability", true]]);
  assert.equal(budgetRange(profile), "≤ £525k–£570k");
});
