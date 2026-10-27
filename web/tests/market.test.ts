import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarketView, RecentSalesTable } from "../src/components/market-section";
import {
  basisSentence,
  boxPlot,
  formatPoundsShort,
  lineChart,
  niceTicks,
  perSquareFoot,
  readAreaMarket,
  readRecentSales,
  recentSalesPath,
  type AreaMarketResponse,
} from "../src/lib/market";
import { fixtureAreaMarket, fixtureRecentSales } from "../src/lib/market-fixture";

const BOX = { width: 340, height: 190, left: 46, right: 10, top: 10, bottom: 24 };

test("square feet and short money", () => {
  assert.equal(Math.round(perSquareFoot(10_763.9)!), 1000);
  assert.equal(perSquareFoot(null), null);
  assert.equal(formatPoundsShort(1_250_000), "£1.3m");
  assert.equal(formatPoundsShort(450_000), "£450k");
  assert.equal(formatPoundsShort(950), "£950");
});

test("nice ticks cover the range with round steps", () => {
  assert.deepEqual(niceTicks(310_000, 940_000), [250_000, 500_000, 750_000, 1_000_000]);
  assert.deepEqual(niceTicks(5, 5), [5]);
  const ticks = niceTicks(412, 1033);
  assert.ok(ticks[0] <= 412 && ticks.at(-1)! >= 1033);
});

test("line chart shares one scale and breaks lines at gaps", () => {
  const geometry = lineChart([
    { key: "F", values: [100, 200, null, 400] },
    { key: "T", values: [null, null, null, null] },
  ], 4, BOX);
  assert.ok(geometry);
  assert.equal(geometry.lines.length, 1, "an empty series draws nothing");
  assert.equal((geometry.lines[0].path.match(/M/g) ?? []).length, 2, "the gap starts a new segment");
  assert.equal(geometry.xs[0], BOX.left);
  assert.equal(geometry.xs[3], BOX.width - BOX.right);
  const top = geometry.ticks.at(-1)!;
  assert.ok(geometry.lines[0].points[2].y >= top.y);
  assert.equal(lineChart([{ key: "F", values: [null] }], 1, BOX), null);
});

test("box plot keeps only types with the full spread", () => {
  const market = fixtureAreaMarket("uk:lsoa:E01000003")!;
  const plot = boxPlot(market.byType, BOX, 34);
  assert.ok(plot);
  assert.deepEqual(plot.rows.map((row) => row.key), ["T", "F"]);
  for (const row of plot.rows) assert.ok(row.p5 <= row.p25 && row.p25 <= row.median && row.median <= row.p75 && row.p75 <= row.p95);
});

test("demo market: a thin area widens to its MSOA and says so", () => {
  const own = fixtureAreaMarket("uk:lsoa:E01000001")!;
  assert.equal(own.basis!.widened, false);
  const widened = fixtureAreaMarket("uk:lsoa:E01000002")!;
  assert.equal(widened.basis!.carrier, "msoa");
  assert.match(basisSentence(widened.basis!, widened.summary!.sales), /Fewer than 10 homes sold here/);
  assert.equal(widened.trend.length, 6);
  assert.ok(widened.trend.every((series) => series.points.length === 11));
  assert.equal(fixtureAreaMarket("uk:lsoa:E01999999"), null);
});

test("readers reject wrong schemas and demo numbers in real mode", () => {
  const market = fixtureAreaMarket("uk:lsoa:E01000001");
  assert.ok(readAreaMarket(market, "demo"));
  assert.equal(readAreaMarket(market, "real"), null);
  assert.equal(readAreaMarket({ schemaVersion: "other" }, "demo"), null);
  const list = fixtureRecentSales("uk:lsoa:E01000001", 1, 20, "nearest");
  assert.ok(readRecentSales(list, "demo"));
  assert.equal(readRecentSales(list, "real"), null);
});

test("demo recent sales page and sort", () => {
  const first = fixtureRecentSales("uk:lsoa:E01000001", 1, 20, "nearest")!;
  const second = fixtureRecentSales("uk:lsoa:E01000001", 2, 20, "nearest")!;
  assert.equal(first.sales.length, 20);
  assert.notEqual(first.sales[0].transactionId, second.sales[0].transactionId);
  assert.ok(first.sales[0].distanceMetres! <= first.sales[1].distanceMetres!);
  const newest = fixtureRecentSales("uk:lsoa:E01000001", 1, 20, "newest")!;
  assert.ok(newest.sales[0].date >= newest.sales[1].date);
  assert.equal(recentSalesPath("uk:lsoa:E01000001", 2, "newest"),
    "/api/v1/areas/uk%3Alsoa%3AE01000001/recent-sales?page=2&pageSize=20&sort=newest");
});

test("the section renders tiles, tables, two trend charts and a box plot", () => {
  const html = renderToStaticMarkup(createElement(MarketView, { market: fixtureAreaMarket("uk:lsoa:E01000002")! }));
  assert.match(html, /data-testid="market-basis"[^>]*>Fewer than 10 homes/);
  assert.match(html, /data-testid="market-trend-price"/);
  assert.match(html, /data-testid="market-trend-sqft"/);
  assert.match(html, /data-testid="market-spread"/);
  // Three charts (two trends, one box plot); knitted parts inside them are decorative svgs.
  assert.equal((html.match(/<svg[^>]*role="img"/g) ?? []).length, 3);
  // Each trend line is a yarn thread ending in a dot at the latest point.
  assert.match(html, /class="market-line" data-series="[^"]+"><g [^>]*class="yarn"/);
  assert.match(html, /class="dot"[^>]*aria-hidden="true"/);
  assert.match(html, /No detached or other homes sold|No other homes sold/);
  // Middle half as a range on the scale, typical price by type as bars.
  assert.match(html, /class="chart chart-scale" role="img" aria-label="Middle half sold for £[\d.]+[km] to £[\d.]+[km], typical £/);
  assert.match(html, /class="chart-scale__track" data-range="\d+-\d+"/);
  assert.match(html, /class="chart chart-bars" role="img" aria-label="Typical sale price by type of home: [^"]*Terraced · \d+ sales £/);
  assert.match(html, /Show as table/);
});

test("recent sales show five rows and a Show all button when collapsed", () => {
  const list = fixtureRecentSales("uk:lsoa:E01000001", 1, 20, "nearest")!;
  const html = renderToStaticMarkup(createElement(RecentSalesTable, { list, sort: "nearest", onSort: () => {}, onPage: () => {}, collapsed: true }));
  assert.equal((html.match(/<tr>/g) ?? []).length, 1 + 5);
  assert.match(html, new RegExp(`Show all ${list.total}`));
  assert.doesNotMatch(html, /market-pager|aria-pressed/);
});

test("missing values read unknown, never zero", () => {
  const market: AreaMarketResponse = {
    ...fixtureAreaMarket("uk:lsoa:E01000001")!,
    summary: { propertyType: "all", sales: 4, medianPrice: null, p5: null, p25: null, p75: null, p95: null,
      minPrice: null, maxPrice: null, pricePerSquareMetreSales: 0, medianPricePerSquareMetre: null },
  };
  const html = renderToStaticMarkup(createElement(MarketView, { market }));
  assert.match(html, /data-testid="market-median"><span class="market-unknown">unknown<\/span>/);
  assert.match(html, /data-testid="market-range"><span class="market-unknown">unknown/);
  // The range scale gives way to "Unknown" text, never an empty chart.
  assert.match(html, /class="chart-unknown" data-unknown="">Unknown/);
  assert.doesNotMatch(html, /data-range=/);
  assert.doesNotMatch(html, /data-testid="market-median">£0/);
});

test("recent sales table shows the page window", () => {
  const list = fixtureRecentSales("uk:lsoa:E01000001", 2, 20, "nearest")!;
  const html = renderToStaticMarkup(createElement(RecentSalesTable, { list, sort: "nearest", onSort: () => {}, onPage: () => {} }));
  assert.match(html, new RegExp(`21–${Math.min(40, list.total)} of ${list.total}`));
  assert.match(html, /aria-pressed="true"[^>]*>Nearest/);
  assert.match(html, /Leasehold|Freehold/);
});
