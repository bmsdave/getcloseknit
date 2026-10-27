import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ofstedMark } from "../src/components/area-schools";
import { OfstedIcon } from "../src/components/school/ofsted-icon";
import { sectionInView } from "../src/components/section-tabs";
import { readAreaPageSeed, SEED_OFF_HEADER } from "../src/lib/area-page-seed";
import type { GeographyId, MetricDefinition, SchoolObservation } from "../src/lib/contracts";
import { METRICS } from "../src/lib/fixtures";
import { areaSeedFollowUps, areaSeedPaths, METRICS_PATH, type AreaSeedQuery } from "../src/lib/section-seed";

const ID: GeographyId = "uk:lsoa:E01000001";
const QUERY: AreaSeedQuery = { geographyId: ID, areaId: ID, mode: "demo", release: "preview-2026-09", period: "2026-06", uprn: null };
const AREA = "/api/v1/areas/uk%3Alsoa%3AE01000001";

test("the seed asks for exactly the URLs the area page's hooks read (demo, E01000001)", () => {
  // Captured from the browser before the server seed existed (every section read on load).
  const browser = [
    `${AREA}?metric=price-per-square-metre&period=2026-06&mode=demo&release=preview-2026-09`,
    `${AREA}/market-by-type`, `${AREA}/people`, "/api/v1/health",
    `${AREA}/profile?period=9999-12&mode=demo&release=preview-2026-09`, `${AREA}/flood`,
    `${AREA}/places?mode=demo&release=preview-2026-09`,
    `${AREA}?metric=crime&period=2026-06&mode=demo&release=preview-2026-09`,
    `${AREA}/market`, `${AREA}/civic`, `${AREA}/safety`, `${AREA}/rents`, `${AREA}/rent-trend`, `${AREA}/noise`, `${AREA}/nature`,
    "/api/v1/metrics", `${AREA}/kids`, `${AREA}/schools`, `${AREA}/recent-sales?page=1&pageSize=20&sort=nearest`,
  ];
  assert.deepEqual([...areaSeedPaths(QUERY)].sort(), [...browser].sort());
  assert.deepEqual(areaSeedFollowUps(QUERY, METRICS, false), [`${AREA}?metric=food-hygiene&period=2026-10`]);
  // Real mode adds Home, Location and Health; a moved crime rate adds the Safety line's own read.
  const real = areaSeedPaths({ ...QUERY, mode: "real" });
  for (const part of ["home", "location", "health"]) assert.ok(real.includes(`${AREA}/${part}`), part);
  assert.equal(areaSeedFollowUps({ ...QUERY, mode: "real" }, METRICS, true).length, 2);
  // A chosen home reads its own noise, nature, flood and places.
  assert.ok(areaSeedPaths({ ...QUERY, uprn: "100000000001" }).includes(`${AREA}/noise?uprn=100000000001`));
});

test("the server seed reads each section through its route, trims what the page never reads, shares timelines", async () => {
  const seed = await readAreaPageSeed(QUERY, new Headers());
  for (const path of [...areaSeedPaths(QUERY), `${AREA}?metric=food-hygiene&period=2026-10`]) assert.ok(path in seed, path);
  // Demo has no noise figures: its route answers "not available" (e4b3f45f; a 404 logged a console error).
  assert.deepEqual(seed[`${AREA}/noise`], { available: false });
  // A 404 (an area the preview does not know) is kept as "not here"; a failure would be left to the browser.
  const UNKNOWN: GeographyId = "uk:lsoa:E01999999";
  const unknown = await readAreaPageSeed({ ...QUERY, geographyId: UNKNOWN, areaId: UNKNOWN }, new Headers());
  assert.equal(unknown[`/api/v1/areas/uk%3Alsoa%3AE01999999/market-by-type`], null);
  const metrics = (seed[METRICS_PATH] as { metrics: MetricDefinition[] }).metrics.map((metric) => metric.id);
  assert.deepEqual(metrics.sort(), ["crime", "food-hygiene", "price-per-square-metre"]);
  assert.deepEqual(Object.keys(seed[`${AREA}?metric=food-hygiene&period=2026-10`] as object), ["summary"]);
  const price = seed[`${AREA}?metric=price-per-square-metre&period=2026-06&mode=demo&release=preview-2026-09`] as { priceTimeline: unknown; metricTimeline: unknown };
  const crime = seed[`${AREA}?metric=crime&period=2026-06&mode=demo&release=preview-2026-09`] as { priceTimeline: unknown };
  assert.equal(price.metricTimeline, price.priceTimeline);
  assert.equal(crime.priceTimeline, price.priceTimeline);
  // Tests that mock the browser's reads ask for the client-only page.
  assert.deepEqual(await readAreaPageSeed(QUERY, new Headers({ [SEED_OFF_HEADER]: "off" })), {});
  // Real mode with no evidence API here: fixtures would be refused, so the page reads for itself.
  assert.deepEqual(await readAreaPageSeed({ ...QUERY, mode: "real" }, new Headers()), {});
});

test("scroll-spy: the section whose top reached the line just under the bar", () => {
  const bar = 53;
  // Schools (index 3) just under the bar, or 60 px down with Safety's tail above it.
  assert.equal(sectionInView([-900, -500, -300, 57, 600], bar, 900, false), 3);
  assert.equal(sectionInView([-900, -500, -240, 113, 600], bar, 900, false), 3);
  // Halfway down the view: still the one before.
  assert.equal(sectionInView([-900, -500, -100, 480, 900], bar, 900, false), 2);
  // Above the first section: the first. At the end of the page the last whose top is in the upper part.
  assert.equal(sectionInView([300, 900], 400, 900, false), 0);
  assert.equal(sectionInView([-900, -200, 420], bar, 900, true), 2);
});

const legacy = (value: string, academicYear = "2022/23"): SchoolObservation =>
  ({ kind: "inspection-legacy", measure: "overall-judgement", value, academicYear } as SchoolObservation);

test("Ofsted marks for school rows: the popup's icons, words as the label", () => {
  assert.deepEqual(ofstedMark([legacy("Outstanding")]), { mark: "outstanding", label: "Ofsted: Outstanding (2023)" });
  assert.deepEqual(ofstedMark([legacy("School remains Good")]), { mark: "good", label: "Ofsted: Good (2023)" });
  assert.equal(ofstedMark([legacy("Requires improvement")])?.mark, "requires-improvement");
  assert.equal(ofstedMark([legacy("Inadequate")])?.mark, "inadequate");
  const card = { kind: "inspection-current", measure: "achievement", value: 3, academicYear: "2024/25" } as SchoolObservation;
  assert.deepEqual(ofstedMark([card]), { mark: "report-card", label: "New Ofsted report card" });
  assert.equal(ofstedMark([]), null);
});

test("the Ofsted icon's label is text, never markup (it carries the grade's words from the data)", () => {
  const html = renderToStaticMarkup(createElement(OfstedIcon, { mark: "good", label: "Ofsted: Good <b>&</b>" }));
  assert.match(html, /<title>Ofsted: Good &lt;b&gt;&amp;&lt;\/b&gt;<\/title>/);
  assert.doesNotMatch(html, /<b>/);
});
