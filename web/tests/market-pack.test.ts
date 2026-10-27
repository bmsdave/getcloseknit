import assert from "node:assert/strict";
import test from "node:test";

import type { AreaEvidencePack } from "../src/lib/contracts";
import { getAreaPack } from "../src/lib/fixtures";
import { buildMarketPack, leaseholdText, medianText, renderPackMarkdown } from "../src/lib/market-pack";

function preview(address?: string): AreaEvidencePack {
  const pack = getAreaPack("uk:lsoa:E01000001", address);
  assert.ok(pack && pack !== "address-outside");
  return pack;
}

const GENERATED = "2026-10-05T12:00:00.000Z";

test("medians and the premium are withheld under 10 sales", () => {
  assert.match(medianText("New-build", { medianPricePerSquareMetre: null, sampleSize: 6 }, 36), /not shown.*10 standard sales.*\(6 here\)/);
  assert.match(medianText("Resale", { medianPricePerSquareMetre: 10_500, sampleSize: 9 }, 36), /not shown/);
  assert.match(medianText("Resale", { medianPricePerSquareMetre: 10_500, sampleSize: 40 }, 36), /£10,500\/m² \(£975\/sq ft\) across 40/);
  const doc = buildMarketPack(preview(), { generatedAt: GENERATED });
  const market = doc.sections.find((section) => section.id === "market");
  assert.ok(market?.lines.some((line) => /New-build premium not shown/.test(line.text) && line.kind === "unknown"));
});

test("the leasehold figure is labelled as a share of sales", () => {
  assert.match(leaseholdText(0.625, 24), /share of sales, not of homes/);
  assert.match(leaseholdText(null, 0), /not available/);
});

test("every factual line cites a source release with a safe link", () => {
  const doc = buildMarketPack(preview("uk:addr:a1b2c3d4e5f6"), { generatedAt: GENERATED, demo: true });
  const facts = doc.sections.flatMap((section) => section.lines).filter((line) => line.kind === "fact" && !/state-funded schools within/.test(line.text));
  assert.ok(facts.length > 5);
  for (const line of facts) assert.ok(line.source, line.text);
  assert.ok(doc.sources.every((source) => source.url === null || source.url.startsWith("https://")));
  assert.deepEqual(doc.sections.map((section) => section.id), ["market", "nearby", "crime", "noise", "schools", "limits"]);
});

test("unsafe source URLs are dropped, not linked", () => {
  const pack = { ...preview(), sources: preview().sources.map((source) => ({ ...source, sourceUrl: "javascript:alert(1)" })) };
  const doc = buildMarketPack(pack, { generatedAt: GENERATED });
  assert.ok(doc.sources.every((source) => source.url === null));
  assert.doesNotMatch(renderPackMarkdown(doc), /javascript:/);
});

test("markdown carries the release, citations and no per-sale rows", () => {
  const markdown = renderPackMarkdown(buildMarketPack(preview("uk:addr:a1b2c3d4e5f6"), { generatedAt: GENERATED, demo: true }));
  assert.match(markdown, /^# Area evidence pack: Westminster preview LSOA/);
  assert.match(markdown, /Release demo-fixture-pack · Preview data, not for decisions\./);
  assert.match(markdown, /## Same building and street/);
  assert.match(markdown, /Same building: 2 other sales in 10 years; median not shown/);
  assert.match(markdown, /\[HM Land Registry Price Paid Data, preview-hmlr-ppd, observed 2026-10-05\]\(https:/);
  assert.doesNotMatch(markdown, /610,000|valuation of/i);
});

test("a pack without market depth says so", () => {
  const pack = preview();
  const doc = buildMarketPack({ ...pack, market: { ...pack.market, available: false, periodEnd: null } }, { generatedAt: GENERATED });
  assert.match(doc.sections[0].lines[0].text, /not published for this area/);
});

test("the pack opens with its conclusions; leasehold stays a share of sales", () => {
  const doc = buildMarketPack(preview(), { generatedAt: GENERATED });
  assert.deepEqual(doc.summary, [
    "Price: resale homes sold for a median £10,500/m²; +2.5% over the last year.",
    "Market: 24 standard sales in 12 months, 63% of them leasehold.",
    "Crime: 56.0 recorded crimes per 1,000 residents, about average for London.",
    "Noise: 43% of homes at 55 dB or more from road or rail.",
    "Schools: 2 state-funded within 1.5 km; nearest Preview Primary School (350 m).",
  ]);
  assert.match(renderPackMarkdown(doc), /## In short\n\n- Price: resale homes/);
  const pack = preview();
  const thin = buildMarketPack({ ...pack, market: { ...pack.market, resale: { medianPricePerSquareMetre: 9_000, sampleSize: 4 } } }, { generatedAt: GENERATED });
  assert.match(thin.summary[0], /too few sales with a floor area/);
});

test("the preview refuses an address outside the area", () => {
  assert.equal(getAreaPack("uk:lsoa:E01000001", "uk:addr:000000000000"), "address-outside");
  // A preview address (in E01000001) is outside every other preview area.
  assert.equal(getAreaPack("uk:lsoa:E01000002", "uk:addr:a1b2c3d4e5f6"), "address-outside");
  assert.equal(getAreaPack("uk:lsoa:E01999999"), null);
});

// The sitemap lists /pack for every neighbourhood: each preview LSOA has one, under its own id and name.
test("every preview neighbourhood has a pack", () => {
  const pack = getAreaPack("uk:lsoa:E01000002");
  assert.ok(pack && pack !== "address-outside");
  assert.equal(pack.geographyId, "uk:lsoa:E01000002");
  assert.equal(pack.name, "North London preview LSOA");
});
