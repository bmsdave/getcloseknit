import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RentTrendBlock, RentTrendSourcesBlock } from "../src/components/rent-trend";
import type { GeographyId } from "../src/lib/contracts";
import { findTopic, LAYER_EXCLUSIONS } from "../src/lib/map-topics";
import { fixtureRentTrend, readRentTrend, rentTrendCell, rentTrendPath, type AreaRentTrendResponse } from "../src/lib/rent-trend";

const AREA = "uk:lsoa:E01002704" as GeographyId;
const real = (): AreaRentTrendResponse => ({
  ...fixtureRentTrend(AREA),
  dataMode: "release",
  productReleaseId: "rel-1",
  sources: [{ sourceId: "ons-pipr", sourceName: "ONS Price Index of Private Rents", sourceUrl: "https://www.ons.gov.uk/x.xlsx",
    release: "src-ons-pipr-series-2026-08", licence: "OGL-3.0", attribution: "Source: Office for National Statistics" }],
});
const render = (trend: AreaRentTrendResponse | null, bedrooms: number | null = null) =>
  renderToStaticMarkup(createElement(RentTrendBlock, { trend, bedrooms }));

test("path and reader: real mode never takes the demo", () => {
  assert.equal(rentTrendPath(AREA), "/api/v1/areas/uk%3Alsoa%3AE01002704/rent-trend");
  assert.equal(readRentTrend(fixtureRentTrend(AREA), "real"), null);
  assert.ok(readRentTrend(fixtureRentTrend(AREA), "demo"));
  assert.ok(readRentTrend(real(), "real"));
  assert.equal(readRentTrend({ schemaVersion: "area-rents.v1" }, "real"), null);
});

test("the household's bedrooms pick the cell, else all homes", () => {
  const value = real().value;
  assert.equal(rentTrendCell(value, 2)?.category, "twoBedrooms");
  assert.equal(rentTrendCell(value, 7)?.category, "fourOrMoreBedrooms");
  assert.equal(rentTrendCell(value, null)?.category, "all");
  assert.equal(rentTrendCell({ ...value, categories: value.categories.filter((cell) => cell.category === "all") }, 2)?.category, "all");
});

test("rent, sparkline, 1- and 5-year change next to London, and the London rank", () => {
  const html = render(real(), 2);
  assert.match(html, /data-testid="rent-trend"/);
  assert.match(html, /Rent, 2 bed/);
  assert.match(html, /£[\d,]+ \/ month/);
  assert.match(html, /1 yr \+3\.8% · 5 yr \+24\.6%/);
  assert.match(html, /London \+3\.1% · \+22\.9%/);
  assert.match(html, /Faster rise than 64% of London boroughs/);
  assert.match(html, /data-testid="rent-trend-sparkline"/);
});

test("outside London the comparison and rank are the region's (rankScope), never London's", () => {
  const trend = real();
  const html = render({ ...trend, value: { ...trend.value, rankScope: { code: "E12000002", name: "North West" } } }, 2);
  assert.match(html, /North West \+3\.1% · \+22\.9%/);
  assert.match(html, /North West rank/);
  assert.match(html, /Faster rise than 64% of local authorities in North West/);
  assert.doesNotMatch(html, /London/);
});

test("unknown stays unknown: nothing rendered", () => {
  assert.equal(render(null), "");
  assert.equal(render({ ...real(), value: { ...real().value, available: false, categories: [] } }), "");
});

test("sources go in the section's menu, word for word", () => {
  const html = renderToStaticMarkup(createElement(RentTrendSourcesBlock, { trend: real() }));
  assert.match(html, /Source: Office for National Statistics/);
  assert.match(html, /No City of London|Demo data/);
});

test("Rent change left the menu for Typical rent (Layers v5 PR 3); its layers stay published", () => {
  assert.equal(findTopic("rent-change-1y"), null);
  assert.equal(findTopic("rent-change-5y"), null);
  assert.ok(LAYER_EXCLUSIONS["rent-change-1y"]?.includes("Typical rent"));
  assert.ok(LAYER_EXCLUSIONS["rent-change-5y"]?.includes("Typical rent"));
  assert.equal(findTopic("typical-rent")?.group, "cost");
});
