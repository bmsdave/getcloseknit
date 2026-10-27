import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SHOWS, showsFromQuery, shownCount, withShowsQuery } from "../src/lib/map-shows";
import { schoolFeatures, schoolMapCard } from "../src/lib/map-school-layer";

test("Show's overlays: stations on, schools, your places and street trees off, unless the address says otherwise", () => {
  assert.deepEqual(showsFromQuery(""), DEFAULT_SHOWS);
  assert.deepEqual(showsFromQuery("?schools=on&stations=off&mine=on"), { schools: true, stations: false, mine: true, trees: false });
  assert.deepEqual(showsFromQuery("?trees=on"), { ...DEFAULT_SHOWS, trees: true });
  assert.equal(withShowsQuery("layer=crime", DEFAULT_SHOWS), "layer=crime");
  assert.equal(withShowsQuery("layer=crime&stations=off", { schools: true, stations: true, mine: false, trees: false }), "layer=crime&schools=on");
  assert.equal(withShowsQuery("layer=green-streets", { ...DEFAULT_SHOWS, trees: true }), "layer=green-streets&trees=on");
  assert.deepEqual(showsFromQuery(withShowsQuery("", { schools: true, stations: false, mine: true, trees: true })),
    { schools: true, stations: false, mine: true, trees: true });
  assert.equal(shownCount(DEFAULT_SHOWS, [true, false]), 2);
  assert.equal(shownCount({ ...DEFAULT_SHOWS, trees: true }, []), 2);
});

test("a school point opens a card with its phase, a link to its page and its distance from the home pin", () => {
  const point = { urn: "100001", name: "A Primary", phase: "primary", latitude: 51.5, longitude: -0.1 };
  const collection = schoolFeatures([point]);
  assert.deepEqual(collection.features[0].geometry.coordinates, [-0.1, 51.5]);
  const card = schoolMapCard(point, null);
  assert.deepEqual([card.view.name, card.detail, card.view.href, card.view.external, card.distance], ["A Primary", "Primary school", "/school/100001", false, null]);
  // Its ♡ keeps where the school is, for Saved › On map.
  assert.deepEqual(card.save, { kind: "school", id: "100001", name: "A Primary", meta: "Primary school", href: "/school/100001", at: [-0.1, 51.5] });
  assert.equal(schoolMapCard(point, [-0.1, 51.509]).distance, "1.0 km");
  assert.equal(schoolMapCard(point, [-0.1, 51.502]).distance, "222 m");
});
