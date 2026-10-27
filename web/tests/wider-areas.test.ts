import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WiderAreas } from "../src/components/evidence-panel";
import type { GeographyId } from "../src/lib/contracts";
import { readAreaEvidenceBody } from "../src/lib/map-state";
import { scopeName } from "../src/lib/scope-name";

const crumbs = (region?: string) => renderToStaticMarkup(createElement(WiderAreas, {
  parentId: "uk:msoa:E02001093" as GeographyId, ownName: "Benchill South", region, metric: "price-per-square-metre",
  period: "2026-06", mode: "real", release: "r1", onSelect: () => undefined,
}));

test("the card's breadcrumbs start at the area's region, never London for Manchester or Cornwall", () => {
  assert.match(crumbs(scopeName({ code: "E12000002", name: "North West" })), /data-testid="wider-areas-region">North West</);
  assert.match(crumbs(scopeName({ code: "E12000009", name: "South West" })), /data-testid="wider-areas-region">South West</);
  // No rankScope (demo fixtures, an older API): London, as before.
  assert.match(crumbs(scopeName(undefined)), /data-testid="wider-areas-region">London</);
  assert.match(crumbs(), /data-testid="wider-areas-region">London</);
});

test("the area's evidence keeps its region and box from the API (the breadcrumb root, a link's fly-to)", () => {
  const body = {
    schemaVersion: "area-summary.v1", summary: { geographyId: "uk:lsoa:E01019015", sourceVersion: "src-1" },
    priceTimeline: [], metricTimeline: [], parentId: "uk:msoa:E02003955",
    rankScope: { code: "E12000009", name: "South West" }, bbox: [-4.8, 50.33, -4.76, 50.36],
  };
  const result = readAreaEvidenceBody(body, { mode: "real", release: "r1" });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.deepEqual(result.payload.rankScope, { code: "E12000009", name: "South West" });
  assert.deepEqual(result.payload.bbox, [-4.8, 50.33, -4.76, 50.36]);
  const older = readAreaEvidenceBody({ ...body, rankScope: undefined, bbox: "x" }, { mode: "real", release: "r1" });
  assert.ok(older.status === "available" && older.payload.rankScope === null && older.payload.bbox === null);
});
