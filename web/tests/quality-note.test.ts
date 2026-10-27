import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QualityNote } from "../src/components/evidence-panel";
import type { AreaSummary } from "../src/lib/contracts";

const base: AreaSummary = {
  geographyId: "uk:lsoa:E01001759", metricId: "price-per-square-metre", period: "2026-06", value: 7000,
  regionPercentile: 40, countryPercentile: null, sampleCount: 3, quality: "fallback", sourceVersion: "v1", carrier: "msoa",
};
const note = (summary: AreaSummary) => renderToStaticMarkup(createElement(QualityNote, { summary, isCrime: false }));

test("a fallback names its carrier and its sample", () => {
  const html = note({ ...base, carrierGeographyId: "uk:msoa:E02000360", carrierName: "Barnsbury · N1", carrierSampleCount: 41 });
  assert.match(html, /shown for Barnsbury · N1 from 41 matched sales/);
});

test("a stored carrier id without a name reads as the wider area, never null", () => {
  const html = note({ ...base, carrierGeographyId: "uk:msoa:E02000360", carrierName: null });
  assert.match(html, /shown for the wider neighbourhood from 3 matched sales/);
  assert.doesNotMatch(html, /null/);
});
