import assert from "node:assert/strict";
import test from "node:test";

import { formatEstimate, formatMoney, formatPerArea } from "../src/lib/money-format";

test("money is rounded the way people say it", () => {
  assert.equal(formatMoney(1_834_000), "£1.83m");
  assert.equal(formatMoney(1_800_000), "£1.8m");
  assert.equal(formatMoney(2_000_000), "£2m");
  assert.equal(formatMoney(999_600), "£1m");
  assert.equal(formatMoney(682_400), "£682k");
  assert.equal(formatMoney(10_000), "£10k");
  assert.equal(formatMoney(9_450), "£9,450");
  assert.equal(formatMoney(-45_200), "−£45k");
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(Number.NaN), "—");
});

test("estimates carry a tilde", () => {
  assert.equal(formatEstimate(682_400), "~£682k");
  assert.equal(formatEstimate(1_834_000), "~£1.83m");
});

test("price per m² rounds to £10, per sq ft to £1", () => {
  assert.equal(formatPerArea(12_783), "£12,780/m²");
  assert.equal(formatPerArea(12_785), "£12,790/m²");
  assert.equal(formatPerArea(761.4, "/sqft"), "£761/sqft");
  assert.equal(formatPerArea(null), "—");
});
