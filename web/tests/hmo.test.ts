import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HmoBlock } from "../src/components/hmo";
import { type AreaHmoResponse, demoAreaHmo, hmoPath, readAreaHmo } from "../src/lib/area-hmo";

const PUBLISHED: AreaHmoResponse = {
  schemaVersion: "area-hmo.v1", productReleaseId: "rel-1", dataMode: "release", confidence: "high",
  value: {
    geographyId: "uk:lsoa:E01000842", available: true,
    borough: { id: "uk:lad:E09000007", name: "Camden" },
    register: { status: "published", url: "https://camden.example/hmo.csv", page: "https://camden.example/hmo", updated: "2026-09-30", retrieved: "2026-10-18" },
    licensedHmos: 12, homes: 700, per1000Homes: 17.1, regionPer1000: 6.2, regionPercentile: 91,
    schemes: [
      { kind: "additional", start: "2025-12-01", until: "2030-11-30", url: "https://camden.example/al", coverage: "whole" },
      { kind: "selective", start: "2024-01-01", until: "2029-01-01", url: "https://camden.example/sl", coverage: "part" },
      { kind: "selective", start: "2022-06-05", until: "2027-06-04", url: "https://camden.example/st", coverage: "streets", streets: 24 },
    ],
    notes: [], sourceVersions: ["src-hmo-1"],
  },
  evidence: [], sources: [{ sourceId: "hmo-registers", sourceName: "London borough HMO licence registers", attribution: "Contains public sector information." }],
  caveats: ["Licensed HMOs only."],
};

const render = (hmo: AreaHmoResponse | null | "unknown") => renderToStaticMarkup(createElement(HmoBlock, { hmo }));

test("the area's rate beside London, with its percentile", () => {
  const html = render(PUBLISHED);
  assert.match(html, /data-testid="hmo"/);
  assert.match(html, /This area.*17\.1/);
  assert.match(html, /London.*6\.2/);
  assert.match(html, /12 licensed HMOs/);
  assert.match(html, /More than 91% of London/);
});

test("schemes link to the borough's page; part coverage is said", () => {
  const html = render(PUBLISHED);
  assert.match(html, /<a href="https:\/\/camden.example\/al"[^>]*>Additional HMO licensing<\/a> until 30 Nov 2030/);
  assert.match(html, /<a href="https:\/\/camden.example\/sl"[^>]*>Selective licensing<\/a> in part of the area until 1 Jan 2029/);
  assert.match(html, /Selective licensing<\/a> on 24 named streets until 4 Jun 2027/);
});

test("an unpublished register says so and never shows zero", () => {
  const html = render({ ...PUBLISHED, confidence: "none", value: { ...PUBLISHED.value, register: { ...PUBLISHED.value.register!, status: "search-only" }, licensedHmos: null, homes: null, per1000Homes: null, regionPer1000: null, regionPercentile: null, schemes: [] } });
  assert.match(html, /HMO register<\/a>: not published/);
  assert.match(html, /href="https:\/\/camden.example\/hmo"/);
  assert.doesNotMatch(html, /0 licensed/);
  assert.doesNotMatch(html, /This area/);
});

test("unknown and unloaded render nothing; loading says so", () => {
  assert.equal(render("unknown"), "");
  assert.equal(render({ ...PUBLISHED, value: { geographyId: "uk:lsoa:E01000842", available: false, notes: [], schemes: [] } }), "");
  assert.match(render(null), /Loading/);
});

test("reader, path and demo", () => {
  assert.equal(hmoPath("uk:lsoa:E01000842"), "/api/v1/areas/uk%3Alsoa%3AE01000842/hmo");
  assert.equal(readAreaHmo(PUBLISHED), PUBLISHED);
  assert.equal(readAreaHmo({ schemaVersion: "area-home.v1" }), null);
  assert.equal(demoAreaHmo("uk:lsoa:E01000842").value.available, false);
});
