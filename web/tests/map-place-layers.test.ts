import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PLACE_VIEW,
  PLACE_ATTRIBUTION,
  PLACE_GROUPS,
  PLACE_LAYER,
  PLACE_MIN_ZOOM,
  confirmedBy,
  hygieneLabel,
  placeFilter,
  placeIcon,
  placeIconId,
  placeBadgeMarkup,
  placeLayers,
  placeSource,
  placeCard,
  placesFromQuery,
  placeTooltipLines,
  togglePlaceGroup,
  withPlacesQuery,
} from "../src/lib/map-place-layers";
import { parseTileCoordinate } from "../src/lib/tile-proxy";

const ALL = PLACE_GROUPS.map((group) => group.id);
const SHOWN = ALL.filter((id) => id !== "other");

/** Chain shops are left out of every place filter. */
const NO_CHAIN_SHOPS = ["!", ["all", ["==", ["get", "group"], "shop"], ["has", "brand"]]];

test("six groups, each with its own colour and icon, cover every tile group once", () => {
  assert.deepEqual(ALL, ["coffee", "food", "pub", "shop", "leisure", "other"]);
  assert.ok(PLACE_GROUPS.length <= 6);
  assert.equal(new Set(PLACE_GROUPS.map((group) => group.colour)).size, PLACE_GROUPS.length);
  assert.equal(new Set(PLACE_GROUPS.map((group) => group.icon)).size, PLACE_GROUPS.length, "every group has its own pictogram");
  for (const group of PLACE_GROUPS) {
    assert.match(group.icon, /^M[\d .,\-a-zA-Z]+$/, `${group.id}: an SVG path`);
    assert.ok(group.label && !group.label.includes("_"), `${group.id}: a plain label`);
  }
  const tiles = PLACE_GROUPS.flatMap((group) => group.tiles);
  assert.deepEqual([...tiles].sort(), ["coffee", "culture", "fast_food", "gym", "other", "pub", "restaurant", "shop"]);
  const icon = placeIcon() as unknown[];
  assert.equal(icon[0], "match");
  assert.deepEqual(icon[1], ["get", "group"]);
  assert.ok(!icon.includes("kebab"), "icons are by group, not category");
  assert.equal(icon[icon.indexOf("fast_food") + 1], placeIconId("food"), "merged tile groups share their group's icon");
  assert.equal(icon[icon.indexOf("restaurant") + 1], placeIconId("food"));
  assert.equal(icon[icon.indexOf("gym") + 1], placeIconId("leisure"));
  assert.equal(icon.at(-1), placeIconId("other"), "an unknown tile group falls back to Other");
  const badge = placeBadgeMarkup("coffee");
  assert.match(badge, /stroke-dasharray="2.2 1.7"/, "an embroidered patch: a running-stitch ring");
  assert.match(badge, /fill="#9d744d"/, "felt in the group's colour");
  assert.match(badge, /stroke="#ffffff"/, "the icon in white plied yarn");
});

test("links from before the merge open the merged groups", () => {
  assert.deepEqual(placesFromQuery("places=fast_food,gym,other"), { on: true, groups: ["food", "leisure", "other"] });
  assert.deepEqual(placesFromQuery("places=restaurant,food,culture"), { on: true, groups: ["food", "leisure"] });
  assert.deepEqual(placeFilter(["food", "leisure"]), ["all", ["in", ["get", "group"], ["literal", ["restaurant", "fast_food", "gym", "culture"]]], NO_CHAIN_SHOPS]);
});

test("the overlay is on by default, like a street map, and the address round-trips it", () => {
  assert.equal(DEFAULT_PLACE_VIEW.on, true);
  assert.deepEqual(placesFromQuery(""), { on: true, groups: SHOWN }, "Other starts hidden");
  assert.equal(withPlacesQuery("layer=crime", DEFAULT_PLACE_VIEW), "layer=crime", "the default needs no parameter");
  const all = { on: true, groups: [...SHOWN] };
  assert.equal(withPlacesQuery("layer=crime&places=coffee", all), "layer=crime");
  assert.deepEqual(placesFromQuery("?places=all"), all, "old links still read");
  const withOther = { on: true, groups: [...ALL] };
  assert.deepEqual(placesFromQuery(withPlacesQuery("", withOther)), withOther, "Other, once ticked, travels by name");
  const some = { on: true, groups: ["pub", "coffee"] as typeof ALL };
  const query = withPlacesQuery("", some);
  assert.equal(query, "places=coffee%2Cpub");
  assert.deepEqual(placesFromQuery(query), { on: true, groups: ["coffee", "pub"] });
  assert.equal(withPlacesQuery("", { on: true, groups: [] }), "places=none");
  assert.deepEqual(placesFromQuery("places=none"), { on: true, groups: [] });
  const off = { on: false, groups: [...SHOWN] };
  assert.equal(withPlacesQuery("places=all", off), "places=off", "switching off travels in the link");
  assert.deepEqual(placesFromQuery("places=off"), off);
});

test("unknown groups in a shared link are ignored, never trusted", () => {
  assert.deepEqual(placesFromQuery("places=pub,church"), { on: true, groups: ["pub"] });
  assert.deepEqual(placesFromQuery("places=1"), { on: true, groups: SHOWN });
});

test("ticking a group keeps the canonical order; unticking removes it", () => {
  const view = { on: true, groups: ["pub"] as typeof ALL };
  assert.deepEqual(togglePlaceGroup(view, "coffee").groups, ["coffee", "pub"]);
  assert.deepEqual(togglePlaceGroup(view, "pub").groups, []);
});

test("source and layer: places tiles from zoom 14, filtered by group, hidden when off", () => {
  const source = placeSource("https://example.test");
  assert.deepEqual(source.tiles, ["https://example.test/api/v1/tiles/places/{z}/{x}/{y}.pbf"]);
  assert.equal(source.minzoom, PLACE_MIN_ZOOM);
  assert.equal(PLACE_MIN_ZOOM, 14);
  for (const licence of ["ODbL", "OGL v3.0", "CDLA-Permissive-2.0", "Apache 2.0", "OpenStreetMap"]) {
    assert.match(source.attribution ?? "", new RegExp(licence.replace(".", "\\.")));
  }
  for (const licence of ["ODbL 1.0", "Open Government Licence v3.0", "CDLA-Permissive-2.0", "Apache 2.0"]) {
    assert.ok(PLACE_ATTRIBUTION.includes(licence), licence);
  }
  const [layer] = placeLayers({ on: false, groups: ["coffee"] });
  assert.equal(layer.id, PLACE_LAYER);
  assert.equal((layer as { "source-layer": string })["source-layer"], "places");
  assert.equal(layer.minzoom, 14);
  assert.equal(layer.layout?.visibility, "none");
  assert.deepEqual(layer.filter, placeFilter(["coffee"]));
  assert.deepEqual(placeFilter(["coffee", "pub"]), ["all", ["in", ["get", "group"], ["literal", ["coffee", "pub"]]], NO_CHAIN_SHOPS],
    "chain shops (a shop with a brand) read as advertising and are left out");
});

test("places are icons, never overlapping, most important first, named like map labels from zoom 15, readable over any colour", () => {
  const [layer] = placeLayers({ on: true, groups: ALL });
  assert.equal(layer.type, "symbol");
  const layout = layer.layout as Record<string, unknown>;
  const paint = layer.paint as Record<string, unknown>;
  assert.equal(layout.visibility, "visible");
  assert.deepEqual(layout["icon-image"], placeIcon());
  assert.deepEqual(layout["text-field"], ["step", ["zoom"], "", 15, ["get", "name"]]);
  // A name that would collide is dropped; its icon stays.
  assert.equal(layout["text-optional"], true);
  // Collision on (MapLibre's default): no allow-overlap or ignore-placement anywhere.
  for (const key of ["icon-allow-overlap", "text-allow-overlap", "icon-ignore-placement", "text-ignore-placement", "icon-optional"]) {
    assert.ok(!(key in layout) || layout[key] === false, key);
  }
  // symbol-sort-key places lower keys first: a higher score must give a lower key.
  assert.deepEqual(layout["symbol-sort-key"], ["-", 0, ["to-number", ["get", "score"], 0]]);
  assert.ok(typeof paint["text-halo-width"] === "number" && (paint["text-halo-width"] as number) >= 1.5, "a halo keeps names readable");
  assert.ok(paint["text-halo-color"], "halo colour");
});

test("confirmed by names the register first, in plain words", () => {
  assert.equal(confirmedBy("osm,fhrs,overture"), "register, Overture, OpenStreetMap");
  assert.equal(confirmedBy("fsq"), "Foursquare");
  assert.equal(confirmedBy("unknown"), null);
  assert.equal(confirmedBy(undefined), null);
});

test("hygiene ratings read as the register publishes them", () => {
  assert.equal(hygieneLabel("5"), "Food hygiene rating 5/5");
  assert.equal(hygieneLabel("0"), "Food hygiene rating 0/5");
  assert.equal(hygieneLabel("AwaitingInspection"), "Food hygiene: awaiting inspection");
  assert.equal(hygieneLabel(null), null);
  assert.equal(hygieneLabel(""), null);
});

test("tooltip: name, then category, brand and hygiene in one line; sources stay behind the card's ?", () => {
  assert.deepEqual(placeTooltipLines({
    name: "Kebab King", category: "kebab", group: "fast_food", sources: "fhrs,overture,osm", hygiene_rating: "5",
  }), ["Kebab King", "Kebab · Hygiene 5/5"]);
  assert.deepEqual(placeTooltipLines({
    name: "Soho branch", category: "coffee_shop", brand: "Pret A Manger", sources: "osm",
  }), ["Soho branch", "Coffee shop · Pret A Manger"]);
  assert.deepEqual(placeTooltipLines({ name: "Costa", brand: "Costa", category: "coffee_shop" }), ["Costa", "Coffee shop"]);
  assert.deepEqual(placeTooltipLines(undefined), []);
  assert.deepEqual(placeCard({ name: "Pizza East", category: "restaurant", sources: "fhrs,osm", hygiene_rating: "5" }),
    { name: "Pizza East", detail: "Restaurant · Hygiene 5/5", sources: "register, OpenStreetMap" });
  // A place with an id gets a ♡ (Saved › Places) where it was tapped.
  assert.deepEqual(placeCard({ id: "p1", name: "Pizza East", category: "restaurant" }, [-0.1, 51.5])?.save,
    { kind: "place", id: "p1", name: "Pizza East", meta: "Restaurant", at: [-0.1, 51.5] });
});

test("the web proxy accepts places tiles inside the pyramid only", () => {
  assert.deepEqual(parseTileCoordinate("14", "8185", "5447.pbf"), { z: 14, x: 8185, y: 5447 });
  assert.equal(parseTileCoordinate("14", "99999", "5447.pbf"), null);
});
