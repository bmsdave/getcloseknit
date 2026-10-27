import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { drawableModes, modeMinutes, nearestLine, type PlaceCommute, routeShapes } from "../src/lib/commute";
import { assertPlaces, PLACE_MODES, type PlacePreference, type PreferenceProfile } from "../src/lib/contracts";
import { buildMatchPack, estimatePlaceMinutes } from "../src/lib/matching";
import { decodeSharedProfile, encodeSharedProfile } from "../src/lib/profile-state";

const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/agent-share-links.json", import.meta.url), "utf8")) as {
  cases: { name: string; profile: PreferenceProfile; fragment: string }[];
};
const carCase = fixture.cases.find((item) => item.name === "car-and-time-bands")!;

const routed: PlaceCommute = {
  placeId: "office", label: "Office", hub: { id: "kings-cross", name: "King's Cross St Pancras", walkFromHubMinutes: 3 },
  modes: { transit: { minutes: 24, range: [20, 29] }, cycle: { minutes: 27, range: [27, 27] }, car: { minutes: 31, range: [19, 31] } },
  routes: [{ totalMinutes: 22, transfers: 0, walkingMinutes: 6, legs: [
    { mode: "walk", line: null, from: null, to: "Walthamstow Central", minutes: 4, waitMinutes: 0, coordinates: [[-0.02, 51.58], [-0.019, 51.583]] },
    { mode: "subway", line: "Victoria", from: "Walthamstow Central", to: "King's Cross", minutes: 14, waitMinutes: 2, coordinates: [[-0.019, 51.583], [-0.1239, 51.5306]] },
  ] }],
  paths: { car: { km: 11.2, coordinates: [[-0.02, 51.58], [-0.1239, 51.5306]] } },
};

test("car is appended to the place modes, so old links keep their indexes", () => {
  assert.deepEqual(PLACE_MODES, ["walk", "cycle", "transit", "car"]);
});

test("car and time bands validate like the API", () => {
  const places = carCase.profile.places!;
  assert.doesNotThrow(() => assertPlaces(places));
  assert.throws(() => assertPlaces([{ ...places[0], when: "sunday-night" } as unknown as PlacePreference]), /time band/);
  assert.throws(() => assertPlaces([{ ...places[0], mode: "taxi" } as unknown as PlacePreference]), /place mode/);
});

test("a time band survives the share link and an absent one stays absent", () => {
  const decoded = decodeSharedProfile(encodeSharedProfile(carCase.profile))!;
  assert.deepEqual(decoded.places!.map((place) => place.when), ["weekday-pm", "saturday", "weekday-am"]);
  const plain = { ...carCase.profile, places: carCase.profile.places!.map(({ when: _when, ...place }) => place) };
  assert.equal(decodeSharedProfile(encodeSharedProfile(plain))!.places!.some((place) => "when" in place), false);
});

test("car estimates at a morning-traffic speed (same formula as personal_places.py)", () => {
  assert.equal(estimatePlaceMinutes(5, "car"), 5 * 1.3 / 20 * 60);
  const evening = { ...carCase.profile, places: carCase.profile.places!.map((place) => ({ ...place, when: "saturday" as const })) };
  const morning = { ...carCase.profile, places: carCase.profile.places!.map((place) => ({ ...place, when: "weekday-am" as const })) };
  assert.deepEqual(buildMatchPack(evening).values.map((value) => value.score), buildMatchPack(morning).values.map((value) => value.score));
});

test("cards and tiles list every mode, the chosen one first", () => {
  assert.equal(modeMinutes(routed, "car"), "31 min car · 24 transit · 27 bike");
  assert.equal(modeMinutes(routed, "transit"), "24 min transit · 27 bike · 31 car");
  assert.equal(modeMinutes({ ...routed, modes: {} }, "car"), null);
  const local: PlaceCommute = { ...routed, hub: null, nearest: { name: "Tesco Extra", metres: 1600 },
    modes: { walk: { minutes: 26, range: [26, 26] }, car: { minutes: 6, range: [6, 6] } } };
  assert.equal(nearestLine(local, "car"), "Tesco Extra · 6 min by car");
  assert.equal(nearestLine(local, "transit"), "Tesco Extra · 26 min walk");
  assert.equal(modeMinutes(local, "transit"), "26 min walk · 6 car"); // a kind reached "by transit" is scored on foot
});

test("the map switch draws transit legs or the street path for the picked mode", () => {
  assert.deepEqual(routeShapes(routed, "transit").map((shape) => shape.kind), ["walk", "route"]);
  assert.deepEqual(routeShapes(routed, "car").map((shape) => shape.mode), ["car"]);
  assert.deepEqual(routeShapes(routed, "cycle"), []); // no bike path in this release: no line, never a straight one
  assert.deepEqual(drawableModes(routed, "car"), ["car", "transit"]);
  assert.deepEqual(drawableModes(undefined, "transit"), []);
});

test("a time-band index outside the list damages the link, as in share_links.py", () => {
  const body = carCase.fragment.slice("#profile=v1.".length);
  const compact = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown[];
  const extras = compact[compact.length - 1] as { p: unknown[][] };
  assert.equal(decodeSharedProfile(carCase.fragment)?.places?.[0].when, "weekday-pm");
  // null is "no time band" (it pads the tail before a school ranking), so it is not damage.
  for (const index of [3, -1, true]) {
    extras.p[0][9] = index;
    const fragment = `#profile=v1.${Buffer.from(JSON.stringify(compact)).toString("base64url")}`;
    assert.equal(decodeSharedProfile(fragment), null, `index ${index}`);
  }
});
