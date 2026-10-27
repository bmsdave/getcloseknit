import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CouncilTaxBandsView } from "../src/components/council-tax-bands";
import { METRIC_IDS } from "../src/lib/contracts";
import { bandsVersusLondon, councilTaxPath, demoCouncilTax, readCouncilTax, typicalBillWords, type AreaCouncilTaxResponse } from "../src/lib/council-tax";
import { getMetric } from "../src/lib/fixtures";
import { metricGuidePath } from "../src/lib/guide-routes";
import { findTopic } from "../src/lib/map-topics";

const SHARES = [0, 10, 60, 80, 220, 170, 220, 40];
const BODY: AreaCouncilTaxResponse = {
  schemaVersion: "area-council-tax.v1", productReleaseId: "rel-1", dataMode: "release", confidence: "high", evidence: [],
  value: {
    geographyId: "uk:lsoa:E01000842", period: "2025-03", homes: 800, mostCommon: "E", medianBand: "F", meanBand: 5.63, regionPercentile: 93,
    bands: (["A", "B", "C", "D", "E", "F", "G", "H"] as const).map((band, index) => ({ band, homes: SHARES[index], share: SHARES[index] / 800 })),
    borough: { id: "uk:lad:E09000007", name: "Camden" },
    typicalBill: { band: "F", amount: 3189, bandD: 2207.55, financialYear: "2026-27" },
    sourceVersions: ["src-voa-ctsop-2025", "src-mhclg-2026-27"],
  },
  sources: [{ release: "src-voa-ctsop-2025", sourceUrl: "https://www.gov.uk/", licence: "OGL-3.0", attribution: "Valuation Office Agency, Council Tax: stock of properties 2025." }],
  caveats: ["Homes on the VOA valuation list at 31 March 2025, rounded by VOA to the nearest 10."],
};

const render = (body: AreaCouncilTaxResponse | null) => renderToStaticMarkup(createElement(CouncilTaxBandsView, { body }));

test("the card shows the most common band, the typical bill and a bar per band", () => {
  const html = render(BODY);
  assert.match(html, /Most homes: <strong>Band E<\/strong>/);
  assert.match(html, /Typical bill <strong>£3,189 a year · Band F<\/strong>/);
  assert.match(html, /aria-label="Homes by council tax band: A 0%, B 1%, C 8%, D 10%, E 28%, F 21%, G 28%, H 5%"/);
  assert.match(html, /Higher bands than 93% of London areas/);
  assert.match(html, /Valuation Office Agency/);
});

test("nothing loaded draws nothing; no Band D drops only the bill", () => {
  assert.equal(render(null), "");
  assert.equal(render(demoCouncilTax()), "");
  const html = render({ ...BODY, value: { ...BODY.value!, typicalBill: null, regionPercentile: null } });
  assert.match(html, /Band E/);
  assert.doesNotMatch(html, /Typical bill|London areas/);
});

test("outside London the bands rank reads the API's region", () => {
  const html = render({ ...BODY, rankScope: { code: "E12000002", name: "North West" } });
  assert.match(html, /of North West areas/);
  assert.doesNotMatch(html, /London areas/);
});

test("words and payload reader", () => {
  assert.equal(typicalBillWords(BODY.value!), "£3,189 a year · Band F");
  assert.equal(bandsVersusLondon(20), "Lower bands than 80% of London areas");
  assert.equal(bandsVersusLondon(null), null);
  assert.equal(bandsVersusLondon(6, "North West"), "Lower bands than 94% of North West areas");
  assert.equal(readCouncilTax(BODY), BODY);
  assert.equal(readCouncilTax({ schemaVersion: "area-home.v1", caveats: [] }), null);
  assert.equal(councilTaxPath("uk:lsoa:E01000842"), "/api/v1/areas/uk%3Alsoa%3AE01000842/council-tax");
});

test("the mean band is a Cost map layer, so My match can range on it", () => {
  assert.ok((METRIC_IDS as readonly string[]).includes("council-tax-band-mean"));
  const topic = findTopic("council-tax-band-mean");
  assert.equal(topic?.group, "cost");
  assert.equal(topic?.label, "Council tax band");
  const metric = getMetric("council-tax-band-mean");
  assert.equal(metric.unit, "band");
  assert.equal(metric.provenance.licence, "OGL-3.0");
  assert.equal(metricGuidePath("council-tax-band-mean"), "/guide/local-government");
});
