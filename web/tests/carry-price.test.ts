import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { shortPounds, ToolHandoff } from "../src/components/tools-shell";
import type { UserCandidate } from "../src/lib/user-candidates";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { askingPrefill, carryPrice, searchBudgetPrefill } from "../src/lib/tools";

// v4 Task 41: one price carried across stamp duty → buy-to-let → My match → Check a home.

function withLocation(href: string, run: (replaced: string[]) => void) {
  const replaced: string[] = [];
  const location = new URL(href);
  (globalThis as Record<string, unknown>).window = {
    location: { get href() { return location.href; } },
    history: { state: null, replaceState: (_state: unknown, _title: string, url: string) => {
      replaced.push(url);
      const next = new URL(url, location.href);
      location.search = next.search;
    } },
  };
  try {
    run(replaced);
  } finally {
    delete (globalThis as Record<string, unknown>).window;
  }
}

test("carryPrice keeps ?price in the address as it is typed, and only when it changes", () => {
  withLocation("https://site.test/tools/stamp-duty", (replaced) => {
    carryPrice(500_000);
    carryPrice(500_000);
    carryPrice(525_000.4);
    carryPrice(null);
    assert.deepEqual(replaced, ["/tools/stamp-duty?price=500000", "/tools/stamp-duty?price=525000", "/tools/stamp-duty"]);
  });
  withLocation("https://site.test/tools/investor?price=500000&from=stamp+duty", (replaced) => {
    carryPrice(500_000);
    assert.deepEqual(replaced, []);
    carryPrice(450_000);
    assert.deepEqual(replaced, ["/tools/investor?price=450000"]);
  });
});

test("stamp duty hands the same price to buy-to-let, the areas it buys in and Check a home", () => {
  const html = renderToStaticMarkup(createElement(ToolHandoff, { price: 500_000, from: null, current: "stamp-duty" }));
  assert.match(html, /Next with £500k/);
  assert.match(html, /href="\/tools\/investor\?price=500000&amp;from=stamp\+duty"/);
  assert.match(html, /Buy-to-let with £500k/);
  assert.match(html, /Areas this buys in/);
  assert.match(html, /href="\/tools\/check-a-home\?price=500000"/);
  const investor = renderToStaticMarkup(createElement(ToolHandoff, { price: 500_000, from: "stamp duty", current: "investor" }));
  assert.doesNotMatch(investor, /Buy-to-let with/);
  assert.equal(shortPounds(1_250_000), "£1.25m");
  assert.equal(shortPounds(612_500), "£612.5k");
});

test("My match carries its budget to buy into Check a home; an unset or renting search carries none", () => {
  assert.equal(searchBudgetPrefill(DEFAULT_PROFILE), null);
  const own = { ...structuredClone(DEFAULT_PROFILE), maximumBudget: 480_000 };
  assert.deepEqual(searchBudgetPrefill(own), { price: 480_000, from: "your budget" });
  assert.equal(searchBudgetPrefill({ ...own, market: "rent" }), null);
});

test("a saved listing's asking price prefills Check a home", () => {
  const sale = { address: { value: "1 Example Street" }, asking: { value: { kind: "sale", amount: 600_000, unit: "gbp-total" } } };
  assert.deepEqual(askingPrefill(sale as unknown as UserCandidate), { price: 600_000, from: "1 Example Street" });
  const rent = { address: { value: "2 Example Street" }, asking: { value: { kind: "rent", amount: 2_000, unit: "gbp-per-month" } } };
  assert.equal(askingPrefill(rent as unknown as UserCandidate), null);
  assert.equal(askingPrefill({ address: { value: "3" }, asking: null } as unknown as UserCandidate), null);
  assert.equal(askingPrefill(undefined), null);
});
