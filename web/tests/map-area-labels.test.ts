import assert from "node:assert/strict";
import test from "node:test";

import { areaTitle, friendlyTitle } from "../src/lib/area-labels";
import { demoFriendlyFields, demoMapLabels } from "../src/lib/area-labels-fixture";
import {
  AREA_LABEL_LAYER_IDS,
  AREA_LABEL_MAX_ZOOM,
  AREA_LABEL_SOURCE_ID,
  areaLabelKindAt,
  areaLabelLayers,
  areaLabelSource,
  BOROUGH_LABEL_LAYER_ID,
  DISTRICT_LABEL_LAYER_ID,
  DISTRICT_LABEL_MIN_ZOOM,
  REGION_LABEL_LAYER_ID,
  basemapLabelZooms,
} from "../src/lib/map-area-labels";
import { LAD_ZOOM } from "../src/lib/map-coverage";

test("regions over all of England, boroughs when zoomed out, postcode districts at mid zoom, nothing at street zoom", () => {
  assert.equal(areaLabelKindAt(5), "region");
  assert.equal(areaLabelKindAt(6.49), "region");
  assert.equal(areaLabelKindAt(6.5), "borough");
  assert.equal(areaLabelKindAt(10), "borough");
  assert.equal(areaLabelKindAt(11.49), "borough");
  assert.equal(areaLabelKindAt(11.5), "district");
  assert.equal(areaLabelKindAt(12.5), "district");
  assert.equal(areaLabelKindAt(14), null);
  assert.equal(areaLabelKindAt(15), null);
});

test("the three label layers split the zoom range at the same breaks as the areas", () => {
  const [region, borough, district] = areaLabelLayers();
  assert.deepEqual(AREA_LABEL_LAYER_IDS, [REGION_LABEL_LAYER_ID, BOROUGH_LABEL_LAYER_ID, DISTRICT_LABEL_LAYER_ID]);
  assert.equal(region.minzoom, undefined);
  assert.equal(region.maxzoom, LAD_ZOOM);
  // All nine regions fit at z5-6 on a desktop (England ~300 px wide at z5.3): smaller, wrapped, free to move.
  assert.deepEqual(region.layout?.["text-size"], ["step", ["zoom"], 12, 5.5, 13, 6, 14]);
  assert.equal(region.layout?.["text-max-width"], 7);
  assert.ok((region.layout?.["text-variable-anchor"] as string[]).includes("center"));
  assert.equal(borough.layout?.["text-max-width"], 14);
  assert.equal(borough.layout?.["text-padding"], 6);
  assert.equal(region.layout?.["text-transform"], undefined, "a region is in ordinary case");
  assert.equal(borough.minzoom, LAD_ZOOM);
  assert.equal(borough.maxzoom, DISTRICT_LABEL_MIN_ZOOM);
  assert.equal(district.minzoom, DISTRICT_LABEL_MIN_ZOOM);
  assert.equal(district.maxzoom, AREA_LABEL_MAX_ZOOM);
  assert.deepEqual(borough.filter, ["==", ["get", "kind"], "borough"]);
  assert.deepEqual(district.filter, ["==", ["get", "kind"], "district"]);
});

test("labels come from their own point source, never the per-LSOA areas", () => {
  for (const layer of areaLabelLayers()) {
    assert.equal(layer.source, AREA_LABEL_SOURCE_ID);
    assert.deepEqual(layer.layout?.["text-field"], ["get", "label"]);
    assert.deepEqual(layer.layout?.["symbol-sort-key"], ["get", "rank"]);
    assert.equal(layer.layout?.["text-allow-overlap"], false);
    assert.equal(layer.layout?.["text-ignore-placement"], false);
  }
  assert.deepEqual(areaLabelSource("http://x"), { type: "geojson", data: "http://x/api/v1/labels" });
});

test("label styling carries no evidence or selection state", () => {
  const serialised = JSON.stringify(areaLabelLayers());
  for (const forbidden of [`"value"`, `"quality"`, `"selected"`, "interpolate", "feature-state"]) {
    assert.ok(!serialised.includes(forbidden), `label spec leaks ${forbidden}`);
  }
});

test("demo labels: one per borough and district, no LSOA codes", () => {
  const features = demoMapLabels().features;
  const keys = features.map((f) => `${f.properties.kind}:${f.properties.code}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const feature of features) {
    assert.doesNotMatch(feature.properties.label, /\d{3}[A-Z]$/);
    if (feature.properties.kind === "district") assert.match(feature.properties.label, /^[A-Z]{1,2}\d[A-Z\d]? · /);
  }
});

test("friendly title joins the neighbourhood name and postcode district", () => {
  assert.equal(friendlyTitle({ friendlyName: "Alperton East", postcodeDistrict: "NW10" }), "Alperton East · NW10");
  assert.equal(friendlyTitle({ friendlyName: "Brent", postcodeDistrict: null }), "Brent");
  assert.equal(friendlyTitle({ friendlyName: " ", postcodeDistrict: "NW10" }), null);
  assert.equal(friendlyTitle(null), null);
});

test("area title keeps the official name beneath, or alone without a friendly name", () => {
  assert.deepEqual(areaTitle("Brent 026D", { friendlyName: "Alperton East", postcodeDistrict: "NW10" }),
    { title: "Alperton East · NW10", code: "Brent 026D" });
  assert.deepEqual(areaTitle("Brent 026D", {}), { title: "Brent 026D", code: null });
  assert.deepEqual(areaTitle("Brent", { friendlyName: "Brent" }), { title: "Brent", code: null });
  assert.deepEqual(areaTitle(null, null), { title: null, code: null });
});

test("demo areas get friendly names; unknown areas read null", () => {
  assert.deepEqual(demoFriendlyFields("uk:lsoa:E01000001"),
    { friendlyName: "St James's", postcodeDistrict: "SW1A", displayName: "St James's · SW1A" });
  assert.deepEqual(demoFriendlyFields("uk:lsoa:E09999999"), { friendlyName: null, postcodeDistrict: null, displayName: null });
});

test("basemap country and state names wait for LAD zoom, under England's region labels (G-E32)", () => {
  const zooms = basemapLabelZooms([
    { id: "label_country_1", type: "symbol", maxzoom: 9 },
    { id: "label_country_3", type: "symbol", minzoom: 2, maxzoom: 9 },
    { id: "label_state", type: "symbol", minzoom: 5, maxzoom: 8 },
    { id: "label_city", type: "symbol", minzoom: 3 },
    { id: "water", type: "fill" },
  ]);
  assert.deepEqual(zooms, [["label_country_1", LAD_ZOOM, 9], ["label_country_3", LAD_ZOOM, 9], ["label_state", LAD_ZOOM, 8]]);
});
