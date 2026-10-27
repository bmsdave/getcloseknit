import assert from "node:assert/strict";
import test from "node:test";

import { alternativesLine, commuteLine, nearestLine, type PlaceCommute, routablePlaces, routeLine, viaHub } from "../src/lib/commute";
import type { PlacePreference } from "../src/lib/contracts";

const routed: PlaceCommute = {
  placeId: "office", label: "Office", hub: { id: "kings-cross", name: "King's Cross St Pancras", walkFromHubMinutes: 3 },
  modes: { transit: { minutes: 24, range: [20, 29] }, cycle: { minutes: 27, range: [27, 27] } },
};

test("routed places read with the chosen mode first and the transit spread", () => {
  assert.equal(commuteLine(routed, "transit"), "24 min by public transport (20–29) · 27 min by bike");
  assert.equal(commuteLine(routed, "cycle"), "27 min by bike · 24 min by public transport (20–29)");
  const driving = { ...routed, modes: { car: { minutes: 41, range: [26, 41] as [number, number] } } };
  assert.equal(commuteLine(driving, "transit"), "41 min by car in morning traffic (26 with no traffic)");
  assert.equal(viaHub(routed), "via King's Cross St Pancras + 3 min walk");
});

test("places without a hub nearby are not routed", () => {
  assert.equal(commuteLine({ ...routed, hub: null, modes: {} }, "transit"), null);
  assert.equal(commuteLine(undefined, "transit"), null);
});

test("only pinned places are sent for routing", () => {
  const places = [
    { id: "a", target: { kind: "point", latitude: 51.5, longitude: -0.1 } },
    { id: "b", target: { kind: "category", category: "park" } },
  ] as unknown as PlacePreference[];
  assert.deepEqual(routablePlaces(places).map((place) => place.id), ["a"]);
});

test("the typical route names lines and changes", () => {
  const leg = (line: string, from: string) => ({ mode: "subway", line, from, to: null, minutes: 8, waitMinutes: 2 });
  const walk = { mode: "walk", line: null, from: null, to: null, minutes: 5, waitMinutes: 0 };
  assert.equal(routeLine({ ...routed, routes: [{ totalMinutes: 20, transfers: 0, walkingMinutes: 5, legs: [walk, leg("Victoria", "Walthamstow Central")] }] }),
    "Victoria from Walthamstow Central, no changes");
  assert.equal(routeLine({ ...routed, routes: [{ totalMinutes: 30, transfers: 1, walkingMinutes: 5, legs: [leg("Weaver", "Hackney Downs"), leg("Victoria", "Highbury")] }] }),
    "Weaver → Victoria from Hackney Downs, 1 change");
  assert.equal(routeLine(routed), null);
});

test("kinds of place name the nearest match and what is close instead", () => {
  const entry: PlaceCommute = {
    placeId: "ms", label: "An M&S", hub: null, modes: { walk: { minutes: 27, range: [27, 27] }, cycle: { minutes: 9, range: [9, 9] } },
    nearest: { name: "M&S Food", metres: 1667 }, alternatives: [{ label: "Any supermarket", metres: 494 }, { label: "Tesco", metres: 984 }],
  };
  assert.equal(nearestLine(entry, "walk"), "M&S Food · 27 min walk");
  assert.equal(nearestLine(entry, "cycle"), "M&S Food · 9 min by bike");
  assert.equal(alternativesLine(entry), "Any supermarket 8 min · Tesco 16 min");
  assert.equal(nearestLine({ ...entry, nearest: { name: "Top Grammar", metres: 900, rank: 3 } }, "walk"), "Top Grammar · #3 in London · 27 min walk");
});
