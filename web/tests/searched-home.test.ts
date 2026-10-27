import assert from "node:assert/strict";
import test from "node:test";

import type { AreaMarketResponse, MarketTypeStats } from "../src/lib/market";
import { areaPriceRanges, parseSearchedHome } from "../src/lib/searched-home";

test("the searched home comes only from a plain address", () => {
  assert.deepEqual(parseSearchedHome({ address: " 120  Valley Road ", near: "118-122" }), { address: "120 Valley Road" });
  assert.deepEqual(parseSearchedHome({ address: ["Flat 2, 120a Valley Road"] }), { address: "Flat 2, 120a Valley Road" });
  for (const address of [undefined, "", "12", "<b>120</b> Road", "120 Valley Road ".repeat(10)]) {
    assert.equal(parseSearchedHome({ address }), null, String(address));
  }
});

test("area price ranges: the middle half by type, only from enough sales", () => {
  const stats = (propertyType: MarketTypeStats["propertyType"], sales: number, p25: number | null, p75: number | null) =>
    ({ propertyType, sales, p25, p75, medianPrice: null, p5: null, p95: null, minPrice: null, maxPrice: null,
       pricePerSquareMetreSales: 0, medianPricePerSquareMetre: null }) as MarketTypeStats;
  const market = { available: true, byType: [
    stats("all", 40, 400_000, 900_000), stats("F", 30, 400_000, 600_000), stats("T", 4, 800_000, 1_000_000),
    stats("S", 6, null, null), stats("D", 5, 1_200_000, 1_600_000),
  ] } as AreaMarketResponse;
  assert.deepEqual(areaPriceRanges(market), [
    { label: "Flat", sales: 30, low: 400_000, high: 600_000 },
    { label: "Detached", sales: 5, low: 1_200_000, high: 1_600_000 },
  ]);
  assert.deepEqual(areaPriceRanges(null), []);
  assert.deepEqual(areaPriceRanges({ ...market, available: false }), []);
});
