import assert from "node:assert/strict";
import test from "node:test";

import { assertRanges, isDescriptiveLayer, METRIC_IDS } from "../src/lib/contracts";
import { METRICS } from "../src/lib/fixtures";
import { metricGuidePath } from "../src/lib/guide-routes";
import { HELP } from "../src/lib/help-texts";
import { legendTitle, mapValueText } from "../src/lib/map-legend";
import { MERGED_LAYERS, parseMapState, REAL_PUBLISHED_LAYERS } from "../src/lib/map-state";
import { findTopic, isRankedLayer, isSinglePeriod, LAYER_EXCLUSIONS, PRESET_EXCLUSIONS, topicTitle } from "../src/lib/map-topics";
import {
  showsUniversities, UNIVERSITY_LAYERS, UNIVERSITY_MIN_ZOOM, universityLayers, universityPointsPath, universitySource,
} from "../src/lib/map-university-layer";
import { previewCriterionValues } from "../src/lib/matching";
import { RANGE_LAYER_GROUPS } from "../src/lib/range-layers";

const NEW_LAYERS = ["typical-rent", "typical-rent-1-bed", "typical-rent-3-bed", "flood-risk", "good-schools-nearby",
  "good-schools-nearby-secondary", "student-share"] as const;

test("Layers v5 PR 3: the seven new metrics are published, with a guide each", () => {
  for (const id of NEW_LAYERS) {
    assert.ok((METRIC_IDS as readonly string[]).includes(id), id);
    assert.ok((REAL_PUBLISHED_LAYERS as readonly string[]).includes(id), id);
    assert.equal(parseMapState(new URLSearchParams({ layer: id })).layer, id);
    assert.notEqual(metricGuidePath(id), "/guide", id);
    assert.notEqual(legendTitle(METRICS.find((metric) => metric.id === id)!), "", id);
  }
  assert.equal(metricGuidePath("flood-risk"), "/guide/flood");
  assert.equal(metricGuidePath("good-schools-nearby"), "/guide/schools");
  assert.equal(metricGuidePath("typical-rent"), "/guide/home-cost");
});

test("Typical rent replaces Rent change in Cost: 1, 2 and 3 bedrooms, 2 shown first", () => {
  const item = findTopic("typical-rent")!;
  assert.equal(item.group, "cost");
  assert.equal(item.label, "Typical rent");
  assert.equal(item.layer, "typical-rent");
  assert.deepEqual(item.views?.map((view) => view.layer), ["typical-rent-1-bed", "typical-rent", "typical-rent-3-bed"]);
  assert.equal(findTopic("typical-rent-3-bed")?.id, "typical-rent");
  assert.equal(isSinglePeriod(item), true);
  assert.equal(topicTitle({ layer: "typical-rent-1-bed", scaleMode: "linear", changeWindow: 5 }, [], "My match"), "Typical rent · 1 bedroom");
  assert.equal(findTopic("rent-change-1y"), null);
  assert.match(LAYER_EXCLUSIONS["rent-change-5y"] ?? "", /Typical rent/);
  const rent = METRICS.find((metric) => metric.id === "typical-rent")!;
  assert.equal(rent.carrier, "lad");
  assert.equal(rent.unit, "£ a month");
  assert.equal(mapValueText(2400, rent), "£2,400 a month (borough)");
});

test("Flood risk sits in Homes & area, Good schools nearby in Everyday life with Primary and Secondary", () => {
  assert.equal(findTopic("flood-risk")?.group, "homes-area");
  assert.equal(findTopic("flood-risk")?.measure, "Rivers, sea, rain");
  const schools = findTopic("good-schools-nearby")!;
  assert.equal(schools.group, "everyday-life");
  assert.deepEqual(schools.views?.map((view) => [view.label, view.layer]),
    [["Primary", "good-schools-nearby"], ["Secondary", "good-schools-nearby-secondary"]]);
  assert.equal(findTopic("good-schools-nearby-secondary")?.id, "good-schools-nearby");
  const card = RANGE_LAYER_GROUPS.flatMap((group) => group.items).find((entry) => entry.layer === "good-schools-nearby");
  assert.equal(card?.better, "higher");
});

test("Student areas is a People item, descriptive like the Census: never ranked, matched or a range", () => {
  const item = findTopic("student-share")!;
  assert.equal(item.group, "people");
  assert.equal(item.label, "Student areas");
  assert.ok(isDescriptiveLayer("student-share"));
  assert.ok(isDescriptiveLayer("census-age-65-plus"));
  assert.ok(!isDescriptiveLayer("flood-risk"));
  assert.equal(isRankedLayer("student-share"), false);
  assert.equal(isRankedLayer("good-schools-nearby"), true);
  assert.equal(previewCriterionValues("student-share"), null);
  assert.throws(() => assertRanges([{ layer: "student-share", min: 10, importance: 3 }]), /never a match criterion/);
  assert.ok(!RANGE_LAYER_GROUPS.flatMap((group) => group.items).some((entry) => entry.layer === "student-share"));
  const definition = METRICS.find((metric) => metric.id === "student-share")!;
  assert.match(definition.description, /never ranked/);
});

test("The retired Universities criterion opens Student areas, which draws universities from street zoom", () => {
  assert.equal(MERGED_LAYERS["custom:universities"], "student-share");
  assert.equal(parseMapState(new URLSearchParams("layer=custom:universities")).layer, "student-share");
  assert.equal(findTopic("custom:universities")?.id, "student-share");
  assert.match(PRESET_EXCLUSIONS.universities, /Student areas/);
  assert.ok(showsUniversities("student-share"));
  assert.ok(!showsUniversities("census-age-15-24"));
  const [dots, labels] = universityLayers();
  assert.equal(dots.minzoom, UNIVERSITY_MIN_ZOOM);
  assert.equal(UNIVERSITY_MIN_ZOOM, 13);
  assert.ok((labels.minzoom ?? 0) >= UNIVERSITY_MIN_ZOOM);
  assert.deepEqual([dots.id, labels.id], [...UNIVERSITY_LAYERS]);
  assert.equal(universityPointsPath("rel-1"), "/api/v1/universities/points?release=rel-1");
  const source = universitySource([{ id: "osm:w1", name: "A University", kind: "university", latitude: 51.5, longitude: -0.1 }]);
  assert.match(String(source.attribution), /OpenStreetMap/);
});

test("The new layers' demo legends rise strictly, and help texts name source, year and licence", () => {
  for (const id of NEW_LAYERS) {
    const metric = METRICS.find((entry) => entry.id === id)!;
    const values = metric.legend.map((stop) => stop.value);
    assert.ok(values.length >= 2, id);
    for (let index = 1; index < values.length; index += 1) assert.ok(values[index] > values[index - 1], `${id}: ${values}`);
    assert.ok(metric.legend.at(-1)!.label.endsWith("+"), id);
    assert.ok(metric.provenance.licence, id);
  }
  for (const id of ["typical-rent", "flood-risk", "good-schools-nearby", "student-share"] as const) {
    assert.match(HELP[id].short, /Open Government Licence/, id);
    assert.match(HELP[id].short, /ONS|Environment Agency|DfE/, id);
  }
  assert.match(HELP["flood-risk"].short, /2025/);
  assert.match(HELP["student-share"].short, /2021/);
});
