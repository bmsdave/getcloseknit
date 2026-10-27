import assert from "node:assert/strict";
import test from "node:test";

import { assertPreferenceProfile, type PlacePreference } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import type { SchoolPoint } from "../src/lib/map-school-layer";
import { decodeSharedProfile, encodeShareLink, sensitiveFieldPreview } from "../src/lib/profile-state";
import {
  DEFAULT_SCHOOL_FILTER, describeSchoolFilter, isSchoolFilterText, parseSchoolFilter, schoolFilterText, schoolShown,
} from "../src/lib/school-filter";

// The same cases as api/tests/test_school_filter.py: the two sides read one text.
const POINTS: SchoolPoint[] = [
  { urn: "100001", name: "A", latitude: 51.5, longitude: -0.1, kind: "state", stage: "primary", phase: "primary", ofsted: "outstanding",
    group: "academy", measures: { ks2RwmExpected: [84, "2024/25"], fsm6Share: [9, "2024/25"] } },
  { urn: "100002", name: "B", latitude: 51.5, longitude: -0.1, kind: "state", stage: "primary", phase: "primary", ofsted: "good",
    group: "community", faith: "Roman Catholic", measures: { ks2RwmExpected: [66, "2024/25"], fsm6Share: [41, "2024/25"] } },
  { urn: "100003", name: "C", latitude: 51.5, longitude: -0.1, kind: "state", stage: "primary", phase: "primary", ofsted: "outstanding" },
  { urn: "100004", name: "D", latitude: 51.5, longitude: -0.1, kind: "state", stage: "secondary", phase: "secondary", ofsted: "good",
    intake: "Girls", measures: { progress8: [0.42, "2023/24"], englandTopPercent: [8, "2024/25"] } },
  { urn: "100005", name: "E", latitude: 51.5, longitude: -0.1, kind: "independent", stage: "secondary", phase: "secondary", intake: "Boys",
    aLevelRank: { rank: 3, pool: 300, year: "2024/25" } },
];
const keep = (text: string) => POINTS.filter((point) => schoolShown(point, parseSchoolFilter(text, true)!)).map((point) => point.urn);

test("the compact text round-trips in its canonical order", () => {
  for (const text of ["on", "t.p", "t", "t.p.s_o.out.good", "o.rc_e.academy.free_g.girls_f.none_m.ks2.75", "m.p8.-0.5", "m.top", "m.fsm.30_a", "t.x_a"]) {
    assert.equal(schoolFilterText(parseSchoolFilter(text, true)!), text, text);
    assert.ok(isSchoolFilterText(text), text);
  }
  for (const text of ["", "x.1", "t.q", "o.great", "t.p_t.s", "o.out_t.p", "m.ks2.150", "m.p8.abc", "g.any", "a.1", "e"]) {
    assert.equal(isSchoolFilterText(text), false, text);
  }
  // The address is lenient: unknown words are dropped.
  assert.deepEqual(parseSchoolFilter("t.p.q_zz.1")?.phases, ["primary"]);
  assert.equal(schoolFilterText({ ...DEFAULT_SCHOOL_FILTER, measure: { id: "progress8", threshold: 0.30000000000000004 } }), "m.p8.0.3");
});

test("one filter keeps the same schools as the API's", () => {
  assert.equal(keep("on").length, POINTS.length);
  assert.deepEqual(keep("t.p_m.ks2.75"), ["100001"], "a threshold drops schools without the measure");
  assert.deepEqual(keep("t.p_m.ks2"), ["100001", "100002", "100003"], "colour only drops nobody");
  assert.deepEqual(keep("m.top.10"), ["100004"]);
  assert.deepEqual(keep("m.fsm.30"), ["100001"]);
  assert.deepEqual(keep("o.good"), ["100002", "100004", "100005"]);
  assert.deepEqual(keep("t.x_g.boys"), ["100005"]);
  assert.deepEqual(keep("g.girls"), ["100004"]);
  assert.deepEqual(keep("f.faith"), ["100002"]);
  assert.deepEqual(keep("e.academy"), ["100001"]);
  assert.deepEqual(keep("a"), ["100005"]);
  assert.equal(describeSchoolFilter(parseSchoolFilter("t.p_o.out.good_m.ks2.75")!), "Primary · Outstanding or Good · KS2 expected standard ≥ 75%");
});

test("My match takes the filter as a place: validated, shared in the link, read back in words", () => {
  const place: PlacePreference = {
    id: "school", label: "Primary · Outstanding or Good", target: { kind: "school-filter", filter: "t.p_o.out.good_m.ks2.75", within: 1000 },
    mode: "walk", targetMinutes: 15, weight: 4, must: false,
  };
  const profile = { ...DEFAULT_PROFILE, places: [place] };
  assertPreferenceProfile(profile);
  assert.throws(() => assertPreferenceProfile({ ...profile, places: [{ ...place, target: { kind: "school-filter", filter: "o.good_t.p" } }] }), /school filter/);
  assert.throws(() => assertPreferenceProfile({ ...profile, places: [{ ...place, target: { kind: "school-filter", filter: "t.p_o.out.good_m.ks2.75", within: 20 } }] }), /within/);
  const link = encodeShareLink(profile);
  const back = decodeSharedProfile(link.slice(link.indexOf("#")));
  assert.deepEqual(back?.places?.[0].target, place.target);
  assert.ok(sensitiveFieldPreview(profile).some((line) => line.includes("near a school like this (Primary · Outstanding or Good · KS2")));
});
