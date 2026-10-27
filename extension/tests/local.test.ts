import assert from "node:assert/strict";
import test from "node:test";

import type { ResultItem } from "../src/adapters/results/types";
import {
  badgesRequestBody, cardRequestBody, costsBlock, daysOnMarket, enrichCard, leaseFlag, monthlyRepayment, onMarketValue,
  priceStoryBlock, requestHeaders, stampDuty, withDaysChip,
} from "../src/local";
import { DEFAULT_BUYER } from "../src/settings";
import type { Card, CardBlock, ListingFacts } from "../src/types";

const FACTS: ListingFacts = {
  portal: "rightmove", listingId: "123", url: "https://www.rightmove.co.uk/properties/123", address: "Elm Road, London NW6",
  lat: 51.54, lng: -0.19, postcode: "NW6 1AA", market: "buy", askingPrice: 500_000, bedrooms: 2, floorAreaSqm: 70,
  tenure: "leasehold", propertyType: "flat", councilTaxBand: "D", serviceChargeYearly: 2400, groundRentYearly: 250,
  leaseYearsRemaining: 72, epcRating: "C", listedOn: "2026-10-01",
  priceChanges: [{ date: "2026-10-05", price: 520_000 }, { date: "2026-10-12", price: 500_000 }],
  firstSeen: { date: "2026-10-03", price: 520_000 },
  buyer: DEFAULT_BUYER,
};
const TODAY = "2026-10-18";
const SECRET_FIELDS = ["councilTaxBand", "serviceChargeYearly", "groundRentYearly", "leaseYearsRemaining", "epcRating",
  "listedOn", "priceChanges", "firstSeen", "buyer", "address", "tenure"];

test("the listing-card request carries only the allowed fields", () => {
  const body = JSON.parse(cardRequestBody(FACTS, { v: 1 }));
  assert.deepEqual(Object.keys(body).sort(), ["askingPrice", "bedrooms", "floorAreaSqm", "lat", "listingId", "lng", "market",
    "portal", "postcode", "profile", "propertyType", "url", "v"]);
  for (const field of SECRET_FIELDS) assert.equal(field in body, false, field);
});

test("the listing-badges request drops listedOn and anything else outside the allowed fields", () => {
  const item = { listingId: "9", url: "https://www.zoopla.co.uk/for-sale/details/9", lat: 51.5, lng: -0.1, postcode: null,
    market: "buy", askingPrice: 400_000, bedrooms: 1, propertyType: "flat", listedOn: "2026-10-10", extra: "x" } as unknown as ResultItem;
  const body = JSON.parse(badgesRequestBody("zoopla", [item], null));
  assert.deepEqual(Object.keys(body.items[0]).sort(), ["askingPrice", "bedrooms", "lat", "listingId", "lng", "market",
    "postcode", "propertyType", "url"]);
  assert.equal(body.portal, "zoopla");
});

test("analytics off adds a plain header; on adds nothing", () => {
  assert.equal(requestHeaders(true)["x-close-knit-analytics"], undefined);
  assert.equal(requestHeaders(false)["x-close-knit-analytics"], "off");
});

test("stamp duty and the mortgage match the server's port", () => {
  assert.equal(stampDuty(500_000), 15_000);
  assert.equal(stampDuty(500_000, true), 10_000);
  assert.equal(stampDuty(600_000, true), 20_000); // over the first-time limit: standard rates
  assert.equal(stampDuty(500_000, false, true), 40_000);
  assert.equal(stampDuty(120_000), 0);
  assert.ok(Math.abs(monthlyRepayment(450_000, 4.5, 30) - 2280.1) < 1);
  assert.equal(monthlyRepayment(120_000, 0, 10), 1000);
});

test("monthly cost: the user's mortgage, council tax from the server's bands, service charge and ground rent from the page", () => {
  const costs = costsBlock(FACTS, DEFAULT_BUYER, { type: "costs", chips: ["Inside ULEZ"], councilTaxByBand: { D: 160.5 } } as never)!;
  const mortgage = Math.round(monthlyRepayment(450_000, 4.5, 30));
  assert.deepEqual(costs.parts, [{ label: "Mortgage", amount: mortgage }, { label: "Council tax", amount: 161 },
    { label: "Service charge", amount: 200 }, { label: "Ground rent", amount: 21 }]);
  assert.equal(costs.monthly, mortgage + 161 + 200 + 21);
  assert.deepEqual(costs.upfront, [{ label: "Deposit", amount: 50_000 }, { label: "Stamp duty", amount: 15_000 }]);
  assert.deepEqual(costs.chips, ["Inside ULEZ"]);
  // No band on the server, or renting: no council tax / no costs.
  assert.equal(costsBlock(FACTS, DEFAULT_BUYER, null)!.parts.some((p) => p.label === "Council tax"), false);
  assert.equal(costsBlock({ ...FACTS, market: "rent" }, DEFAULT_BUYER), null);
  // The user's own assumptions.
  const ftb = costsBlock(FACTS, { ...DEFAULT_BUYER, depositPct: 20, firstTime: true })!;
  assert.deepEqual(ftb.upfront, [{ label: "Deposit", amount: 100_000 }, { label: "Stamp duty", amount: 10_000 }]);
});

test("price story: days on the market and the change since the first known price", () => {
  assert.equal(daysOnMarket("2026-10-01", TODAY), 17);
  assert.equal(daysOnMarket("2026-10-20", TODAY), null);
  assert.equal(daysOnMarket(null, TODAY), null);
  const story = priceStoryBlock(FACTS, { firstSeen: FACTS.firstSeen!, priceChanges: FACTS.priceChanges! }, TODAY)!;
  assert.equal(story.daysOnMarket, 17);
  assert.equal(story.listedOn, "2026-10-01");
  assert.equal(story.text, "On the market 17 days. Price changed 2 times, last on 12 Oct 2026. Down £20,000 since you first saw it on 3 Oct 2026.");
  assert.equal(onMarketValue(FACTS, story), "17 days · down £20,000");
  assert.equal(priceStoryBlock({ ...FACTS, listedOn: null }, { firstSeen: null, priceChanges: [] }, TODAY), null);
});

test("lease flag under 80 years only", () => {
  assert.equal(leaseFlag(72)?.tone, "bad");
  assert.match(leaseFlag(72)!.text, /^Lease has 72 years left/);
  assert.equal(leaseFlag(80), null);
  assert.equal(leaseFlag(null), null);
});

test("enrichCard fills the price, the money, the sections and the flags from local facts", () => {
  const server: Card = { v: 1, status: "ok", blocks: [
    { type: "header", title: "Kilburn" },
    { type: "summary", groups: [
      { title: "The price", only: true, rows: [{ label: "Vs sales", value: "Upper middle of 12 flat sales", tone: "neutral" }] },
      { title: "Before you offer", only: true, rows: [{ label: "Planning", value: "40 in 2 years", tone: "neutral" }] },
    ], pills: [] },
    { type: "costs", monthly: 1, parts: [], upfront: [], assumptions: DEFAULT_BUYER, chips: [], councilTaxByBand: { D: 150 } } as CardBlock,
    { type: "flags", items: [{ text: "In a conservation area", tone: "neutral" }] },
    { type: "sections", columns: [{ title: "This home", rows: [{ label: "Type", value: "Flat" }] },
      { title: "Costs", rows: [{ label: "Each month", value: "£1" }] },
      { title: "Before you offer", rows: [{ label: "Asking price", value: "Upper middle" }, { label: "Planning", value: "40" }] }] },
    { type: "actions", items: [] },
  ] };
  const card = enrichCard(server, FACTS, { firstSeen: FACTS.firstSeen!, priceChanges: FACTS.priceChanges!, buyer: DEFAULT_BUYER, today: TODAY });
  const types = card.blocks.map((b) => b.type);
  assert.deepEqual(types, ["header", "summary", "flags", "sections", "priceStory", "costs", "actions"]);
  const summary = card.blocks[1] as Extract<CardBlock, { type: "summary" }>;
  assert.deepEqual(summary.groups.map((g) => g.title), ["The price", "The money", "Before you offer"]);
  assert.deepEqual(summary.groups[0].rows.at(-1), { label: "On the market", value: "17 days · down £20,000", tone: "neutral" });
  assert.match(summary.groups[1].rows[0].value, /all in$/);
  assert.equal(summary.groups[1].rows[2].value, "£150 a month (band D)");
  const flags = card.blocks[2] as Extract<CardBlock, { type: "flags" }>;
  assert.match(flags.items[0].text, /^Lease has 72 years/);
  const sections = card.blocks[3] as Extract<CardBlock, { type: "sections" }>;
  assert.deepEqual(sections.columns[0].rows.map((r) => r.label), ["Type", "Tenure", "Lease", "EPC", "Council tax"]);
  assert.equal(sections.columns[1].rows[0].label, "Each month");
  assert.notEqual(sections.columns[1].rows[0].value, "£1");
  assert.deepEqual(sections.columns[2].rows.map((r) => r.label), ["Asking price", "On the market", "Price changes", "Planning"]);
  // Error cards pass through untouched.
  const error: Card = { v: 1, status: "error", blocks: [] };
  assert.equal(enrichCard(error, FACTS, { firstSeen: null, priceChanges: [], buyer: DEFAULT_BUYER, today: TODAY }), error);
});

test("enrichCard adds the money group and asks when the server sent neither; approximate points get their footnote", () => {
  const server: Card = { v: 1, status: "ok", blocks: [{ type: "header", title: "Area" },
    { type: "summary", groups: [], pills: [{ label: "Safety", value: "7/10", band: 4 }] }] };
  const facts: ListingFacts = { ...FACTS, tenure: "unknown", councilTaxBand: null, epcRating: null, leaseYearsRemaining: null,
    listedOn: null, locationApproximate: true };
  const card = enrichCard(server, facts, { firstSeen: null, priceChanges: [], buyer: DEFAULT_BUYER, today: TODAY });
  const summary = card.blocks.find((b) => b.type === "summary") as Extract<CardBlock, { type: "summary" }>;
  assert.deepEqual(summary.groups.map((g) => g.title), ["The money"]);
  assert.equal(summary.groups[0].rows[2].value, "Band not listed: ask");
  assert.ok(card.blocks.some((b) => b.type === "footnote" && /^Approximate location/.test(b.text as string)));
});

test("the results line gets its days chip here, before the area's trend", () => {
  const chips = [{ kind: "price", text: "Upper middle", band: null }, { kind: "trend", text: "+9.6% 1y", band: null }];
  assert.deepEqual(withDaysChip(chips, "2026-10-06", TODAY)!.map((c) => c.text), ["Upper middle", "12d on market", "+9.6% 1y"]);
  assert.equal(withDaysChip(chips, null, TODAY), chips);
  assert.equal(withDaysChip(null, "2026-10-06", TODAY), null);
});
