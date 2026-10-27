import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SectorDistributionChart, SectorIndexChart } from "../src/components/sector-charts";
import { searchOptions, sectorResults } from "../src/lib/postcode-search";
import {
  boxGeometry, distributionDomain, formatPpmRange, formatRate, histogramBars, indexChart, linearScale, niceDomain, niceStep, outlinePath,
  rangeBar, readSector, readSectorList, returnsRows, sectorFromParam, sectorHeadline, sectorOfPostcode,
  sectorPath, sectorQuery, sectorTitle, sharedRange,
} from "../src/lib/sector";
import { DEMO_SECTOR, demoSector, demoSectorList } from "../src/lib/sector-fixture";
import { sitemapPaths } from "../src/lib/seo";

const value = DEMO_SECTOR.value;

// ---- The contract fixture -------------------------------------------------------------------

test("the fixture has the contract's shape: envelope around sector, distribution, index, returns, nearby, streets", () => {
  assert.deepEqual(Object.keys(DEMO_SECTOR).sort(),
    ["caveats", "confidence", "dataMode", "evidence", "productReleaseId", "schemaVersion", "sources", "value"]);
  assert.deepEqual(Object.keys(value).sort(), ["distribution", "index", "nearby", "returns", "sector", "streets"]);
  assert.deepEqual(Object.keys(value.sector).sort(), ["borough", "code", "district", "geometry", "name", "postcodeCount", "slug"]);
  assert.equal(value.sector.slug, "W5-1");
  assert.deepEqual(value.index?.series.map((entry) => entry.zone), ["sector", "district", "borough-house", "borough-flat"]);
  assert.equal(value.nearby.filter((row) => row.isSelf).length, 1);
  // nearby sorted by p50, dearest first (unknown last); streets by sales, at most 12.
  const p50s = value.nearby.map((row) => row.p50 ?? -1);
  assert.deepEqual(p50s, [...p50s].sort((a, b) => b - a));
  assert.ok(value.streets.length <= 12);
  assert.deepEqual(value.streets.map((street) => street.sales), [...value.streets.map((street) => street.sales)].sort((a, b) => b - a));
});

test("the fixture carries aggregates only: no per-home price, £/m², address or UPRN field anywhere", () => {
  const text = JSON.stringify(DEMO_SECTOR);
  for (const field of ["uprn", "addressId", "address", "displayAddress", "price\"", "pricePerSquareMetre", "estimate", "valuation"]) {
    assert.ok(!text.includes(`"${field.replace(/"$/, "")}"`), `fixture has a ${field} field`);
  }
});

test("each distribution's buckets add up to its sales and run edge to edge", () => {
  for (const distribution of [value.distribution?.sector, value.distribution?.district]) {
    assert.ok(distribution);
    assert.equal(distribution.buckets.length, 20);
    assert.equal(distribution.buckets.reduce((sum, bucket) => sum + bucket.count, 0), distribution.sales);
    distribution.buckets.slice(1).forEach((bucket, index) => assert.equal(bucket.from, distribution.buckets[index].to));
  }
});

// ---- Codes, slugs and links -----------------------------------------------------------------

test("sector slugs parse in any case and spelling; anything else is not a sector", () => {
  for (const param of ["W5-1", "w5-1", "W5 1", "W5%201", "w5+1", "W5_1"]) {
    assert.deepEqual(sectorFromParam(param), { code: "W5 1", slug: "W5-1" }, param);
  }
  assert.deepEqual(sectorFromParam("SW1A-2"), { code: "SW1A 2", slug: "SW1A-2" });
  for (const param of ["W51", "W5", "W5-12", "W5 1AA", "%", "5W-1"]) assert.equal(sectorFromParam(param), null, param);
  assert.equal(sectorPath("W5 1"), "/sector/W5-1");
});

test("a postcode's sector and a search query's sector", () => {
  assert.equal(sectorOfPostcode("W5 1AA"), "W5 1");
  assert.equal(sectorOfPostcode("sw1a2aa"), "SW1A 2");
  assert.equal(sectorOfPostcode("not a postcode"), null);
  assert.equal(sectorQuery(" w5 1 "), "W5 1");
  assert.equal(sectorQuery("W5-1"), "W5 1");
  assert.equal(sectorQuery("W51"), null);
  assert.equal(sectorQuery("W5 1AA"), null);
  assert.equal(sectorTitle({ code: "W5 1", name: "Ealing Broadway" }), "W5 1 · Ealing Broadway");
  assert.equal(sectorTitle({ code: "W5 9", name: null }), "W5 9");
});

// ---- Reading the API ------------------------------------------------------------------------

test("readSector unwraps the envelope, accepts the bare value and rejects a payload with no sector", () => {
  assert.equal(readSector(DEMO_SECTOR)?.sector.code, "W5 1");
  assert.equal(readSector(value)?.sector.slug, "W5-1");
  assert.equal(readSector({ error: "not-found" }), null);
  assert.equal(readSector(null), null);
  const sparse = readSector({ value: { sector: { ...value.sector, geometry: null }, distribution: null } });
  assert.deepEqual([sparse?.returns, sparse?.nearby, sparse?.streets, sparse?.index], [[], [], [], null]);
});

test("readSectorList reads a bare list or an envelope and drops malformed rows", () => {
  const rows = [{ code: "W5 1", slug: "W5-1", name: "Ealing Broadway" }, { code: "W5 2", slug: "W5-2" }, { name: "no code" }];
  const expected = [{ code: "W5 1", slug: "W5-1", name: "Ealing Broadway" }, { code: "W5 2", slug: "W5-2", name: null }];
  assert.deepEqual(readSectorList(rows), expected);
  assert.deepEqual(readSectorList({ value: rows }), expected);
  assert.deepEqual(readSectorList({ error: "x" }), []);
});

test("demo lookups: W5 1 by slug in any case, the list by prefix", () => {
  assert.equal(demoSector("w5-1"), DEMO_SECTOR);
  assert.equal(demoSector("W5-2"), null);
  assert.deepEqual(demoSectorList("w5 1").map((item) => item.code), ["W5 1"]);
  assert.ok(demoSectorList("W5").length >= 4);
});

// ---- Scales ---------------------------------------------------------------------------------

test("linear scale maps the domain onto the range; a zero-width domain maps to the middle", () => {
  const x = linearScale([0, 100], [10, 210]);
  assert.equal(x(0), 10);
  assert.equal(x(50), 110);
  assert.equal(x(100), 210);
  assert.deepEqual(x.domain, [0, 100]);
  assert.equal(linearScale([5, 5], [0, 40])(5), 20);
});

test("nice steps are 1, 2 or 5 × 10ⁿ and the nice domain holds every value", () => {
  assert.equal(niceStep(7200, 4), 2000);
  assert.equal(niceStep(230, 4), 100);
  assert.equal(niceStep(0), 1);
  const { domain, ticks } = niceDomain(5200, 12_400, 4);
  assert.deepEqual(domain, [4000, 14_000]);
  assert.deepEqual(ticks, [4000, 6000, 8000, 10_000, 12_000, 14_000]);
  assert.deepEqual(niceDomain(7, 7), { domain: [6, 8], ticks: [7] });
});

test("nearby rows share one scale from the lowest p25 to the highest p75; unknown rows get no bar", () => {
  const range = sharedRange(value.nearby);
  assert.ok(range);
  assert.ok(range.domain[0] <= 6120 && range.domain[1] >= 9710);
  const self = rangeBar(value.nearby[1], range.domain);
  assert.ok(self && self.from > 0 && self.to < 1 && self.median !== null && self.median > self.from && self.median < self.to);
  assert.equal(rangeBar(value.nearby[5], range.domain), null);
  assert.equal(sharedRange([{ p25: null, p75: null }]), null);
});

test("the histogram domain spans the sector's buckets and the district's whiskers", () => {
  const sector = value.distribution!.sector!;
  const district = value.distribution!.district!;
  assert.deepEqual(distributionDomain(sector, district), [5200, 12_400]);
  assert.deepEqual(distributionDomain(sector, null), [5200, 12_400]);
  const wide = { ...district, p09: 4000, p91: 13_000 };
  assert.deepEqual(distributionDomain(sector, wide), [4000, 13_000]);
});

test("histogram bars sit on their bucket edges, the tallest at full height", () => {
  const sector = value.distribution!.sector!;
  const x = linearScale([5200, 12_400], [0, 720]);
  const bars = histogramBars(sector.buckets, x, 100, 2);
  assert.equal(bars.length, 20);
  assert.equal(bars[0].x, 1);
  assert.equal(bars[0].width, 34);
  assert.equal(Math.max(...bars.map((bar) => bar.height)), 100);
  assert.equal(bars.find((bar) => bar.count === 10)?.height, 50);
  assert.ok(histogramBars([], x, 100).length === 0);
});

test("box strip positions follow p09 < p25 < p50 < p75 < p91", () => {
  const box = boxGeometry(value.distribution!.sector!, linearScale([5000, 12_000], [0, 700]));
  assert.deepEqual(Object.fromEntries(Object.entries(box).map(([key, at]) => [key, Math.round(at * 100) / 100])), { whiskerFrom: 142, whiskerTo: 535, boxFrom: 231, boxTo: 418, median: 324 });
});

// ---- Index chart ----------------------------------------------------------------------------

const BOX = { width: 600, height: 240, left: 40, right: 10, top: 10, bottom: 20 };

test("index lines: nominal and real per zone, a null year breaks the line, the end dot on the last real year", () => {
  const chart = indexChart(value.index!.series, ["sector", "district", "borough-house"], BOX);
  assert.ok(chart);
  assert.deepEqual(chart.lines.map((line) => line.zone), ["sector", "district", "borough-house"]);
  const sector = chart.lines[0];
  assert.equal(sector.nominal.length, 2, "2007 has too few sales: two runs");
  assert.equal(sector.real.length, 2);
  assert.equal(chart.lines[1].real.length, 1);
  assert.deepEqual([sector.end?.year, sector.end?.value, sector.end?.x], [2025, 171.9, 590]);
  assert.ok(!JSON.stringify(chart).includes("NaN"));
  assert.deepEqual(chart.xTicks.map((tick) => tick.year), [2005, 2010, 2015, 2020, 2025]);
  assert.ok(chart.yTicks[0].value <= 100 && chart.yTicks.at(-1)!.value >= 300.8);
});

test("index chart is null with fewer than two known years, and skips zones the API did not send", () => {
  const one = [{ zone: "sector" as const, points: [{ year: 2004, nominal: 100, real: 100, sales: 30 }, { year: 2005, nominal: null, real: null, sales: 3 }] }];
  assert.equal(indexChart(one, ["sector"], BOX), null);
  const partial = indexChart(value.index!.series.slice(0, 1), ["sector", "district", "borough-flat"], BOX);
  assert.deepEqual(partial?.lines.map((line) => line.zone), ["sector"]);
});

// ---- Returns and headline -------------------------------------------------------------------

test("rates are signed percents with one decimal; null is a dash", () => {
  assert.equal(formatRate(0.0488), "+4.9%");
  assert.equal(formatRate(-0.01), "−1.0%");
  assert.equal(formatRate(0.00004), "0.0%");
  assert.equal(formatRate(1.7826), "+178.3%");
  assert.equal(formatRate(null), "—");
  assert.equal(formatRate(Number.NaN), "—");
  assert.equal(formatPpmRange(7314, 9180), "£7,310–£9,180/m²");
});

test("returns table: a row per horizon, sector and district side by side, missing cells null", () => {
  const rows = returnsRows(value.returns);
  assert.deepEqual(rows.map((row) => row.years), [1, 5, 10, 20]);
  assert.deepEqual(rows[0], { years: 1, sector: { nominal: "+7.7%", real: "+4.9%" }, district: { nominal: "+7.1%", real: "+4.4%" } });
  const sectorOnly = returnsRows(value.returns.filter((row) => row.zone === "sector" && row.years !== 20));
  assert.deepEqual(sectorOnly.map((row) => [row.years, row.district]), [[1, null], [5, null], [10, null]]);
  assert.deepEqual(returnsRows([]), []);
});

test("headline: median, sales and last year's real change; all null when suppressed", () => {
  assert.deepEqual(sectorHeadline(value), { median: 8240, sales: 130, realChange: 0.0488, periodEnd: "2026-07-01" });
  const suppressed = { ...value, distribution: { periodEnd: "2026-07-01", sector: null, district: null }, returns: [] };
  assert.deepEqual(sectorHeadline(suppressed), { median: null, sales: null, realChange: null, periodEnd: "2026-07-01" });
  assert.equal(sectorHeadline({ ...value, distribution: null }).periodEnd, null);
});

// ---- Mini map -------------------------------------------------------------------------------

test("the outline fits its box, closes every ring and is null without geometry", () => {
  const d = outlinePath(value.sector.geometry, 120, 96, 6);
  assert.ok(d && d.startsWith("M") && d.endsWith("Z"));
  const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  assert.ok(numbers.every((n) => n >= 0 && n <= 120), d);
  assert.equal(outlinePath(null, 120, 96), null);
  const multi = outlinePath({ type: "MultiPolygon", coordinates: [value.sector.geometry!.coordinates as number[][][], [[[-0.29, 51.51], [-0.289, 51.51], [-0.289, 51.511], [-0.29, 51.51]]]] }, 120, 96);
  assert.equal(multi?.match(/M/g)?.length, 2);
});

// ---- Search and sitemap ---------------------------------------------------------------------

test("a confirmed sector leads the search box, as its page; an unconfirmed one is never offered", () => {
  const rows = sectorResults("W5 1", [{ code: "W5 1", slug: "W5-1", name: "Ealing Broadway" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].href, "/sector/W5-1");
  assert.match(rows[0].label, /^W5 1 · Ealing Broadway/);
  assert.deepEqual(sectorResults("W5 1", [{ code: "W5 2", slug: "W5-2", name: null }]), []);
  const options = searchOptions("W5 1", rows);
  assert.deepEqual(options, rows);
});

test("sitemap: one page per postcode sector", () => {
  const paths = sitemapPaths([], [], [], ["W5 1", "SW1A 2"]);
  assert.ok(paths.includes("/sector/W5-1") && paths.includes("/sector/SW1A-2"));
});

// ---- Charts render --------------------------------------------------------------------------

test("charts render their labels as text, with the district strip only when the district is known", () => {
  const sector = value.distribution!.sector!;
  const html = renderToStaticMarkup(createElement(SectorDistributionChart, {
    code: "W5 1", district: "W5", sector, districtDistribution: value.distribution!.district, label: "W5 1 £/m²",
  }));
  assert.match(html, /data-testid="sector-strip-sector"/);
  assert.match(html, /data-testid="sector-strip-district"/);
  assert.match(html, /£8k/);
  const alone = renderToStaticMarkup(createElement(SectorDistributionChart, {
    code: "W5 1", district: "W5", sector, districtDistribution: null, label: "W5 1 £/m²",
  }));
  assert.doesNotMatch(alone, /sector-strip-district/);
  const index = renderToStaticMarkup(createElement(SectorIndexChart, {
    code: "W5 1", district: "W5", borough: "Ealing", base: 2004, series: value.index!.series,
  }));
  assert.match(index, /Houses in Ealing/);
  assert.match(index, /data-zone="borough-house"/);
  assert.doesNotMatch(index, /data-zone="borough-flat"/);
  assert.match(index, /After inflation \(CPIH\)/);
});
