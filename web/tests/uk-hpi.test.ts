import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UkHpiView } from "../src/components/uk-hpi";
import type { GeographyId } from "../src/lib/contracts";
import { findTopic } from "../src/lib/map-topics";
import { fixtureAreaHpi, formatChange, hpiPath, readAreaHpi } from "../src/lib/uk-hpi";

const AREA = "uk:lsoa:E01000001" as GeographyId;

test("path, reader and the demo never reaching real mode", () => {
  assert.equal(hpiPath(AREA), "/api/v1/areas/uk%3Alsoa%3AE01000001/hpi");
  const demo = fixtureAreaHpi(AREA);
  assert.equal(readAreaHpi(demo, "demo")?.value.borough.name, "Islington");
  assert.equal(readAreaHpi(demo, "real"), null);
  assert.equal(readAreaHpi({ ...demo, dataMode: "release" }, "real")?.schemaVersion, "area-hpi.v1");
  assert.equal(readAreaHpi({ schemaVersion: "area-rents.v1" }, "demo"), null);
});

test("changes read signed, unknown never zero", () => {
  assert.equal(formatChange(9.2), "+9.2%");
  assert.equal(formatChange(-5.2), "−5.2%");
  assert.equal(formatChange(0), "0%");
  assert.equal(formatChange(null), "unknown");
});

test("the index renders a type switch, one line, changes against London and a London rank", () => {
  const html = renderToStaticMarkup(createElement(UkHpiView, { hpi: fixtureAreaHpi(AREA).value }));
  assert.match(html, /data-testid="uk-hpi"/);
  for (const label of ["All", "Flats", "Terraced", "Semi", "Detached"]) assert.match(html, new RegExp(`>${label}</button>`));
  assert.match(html, /aria-pressed="true"[^>]*>All</);
  assert.equal((html.match(/data-testid="uk-hpi-line"/g) ?? []).length, 1);
  assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="Islington average price/);
  assert.match(html, /<th scope="row">5 yrs<\/th><td>\+6\.3%<\/td><td>\+4\.9%<\/td>/);
  assert.match(html, /<th scope="col">Islington<\/th><th scope="col">London<\/th>/);
  assert.match(html, /class="chart chart-scale" role="img" aria-label="5-year change: faster than 64% of London boroughs"/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("an unpublished type stays off the switch and a missing rank shows no scale", () => {
  const hpi = fixtureAreaHpi(AREA).value;
  const html = renderToStaticMarkup(createElement(UkHpiView, {
    hpi: { ...hpi, types: hpi.types.filter((entry) => entry.type !== "detached"), regionPercentile: {} },
  }));
  assert.doesNotMatch(html, />Detached</);
  assert.doesNotMatch(html, /chart-scale/);
});

// Layers v5 (PR 1): the borough index is a view of Price per m², 5 and 10 years under it.
test("the map lists the borough index as a Price per m² view with 5 and 10 years", () => {
  const topic = findTopic("hpi-change-5y");
  assert.equal(topic?.group, "cost");
  assert.equal(topic?.id, "price-per-square-metre");
  const hpi = topic?.views?.find((view) => view.id === "hpi");
  assert.equal(hpi?.layer, "hpi-change-5y");
  assert.deepEqual(hpi?.subviews?.map((view) => [view.label, view.layer]), [["5 yrs", "hpi-change-5y"], ["10 yrs", "hpi-change-10y"]]);
  assert.equal(findTopic("hpi-change-10y")?.id, "price-per-square-metre");
});
