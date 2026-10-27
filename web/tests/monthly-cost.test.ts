import assert from "node:assert/strict";
import test from "node:test";

import { monthlyMortgagePayment } from "../src/lib/housing-cost";
import {
  buildMonthlyCost, LONDON_SERVICE_CHARGE_ANNUAL, monthlyTravelcard, tenancyDeposit, typicalBand, zoneReach,
  type MonthlyCostInput,
} from "../src/lib/monthly-cost";

const BUY: MonthlyCostInput = {
  market: "buy", bedrooms: 2, propertyType: "flat", price: 600_000, monthlyRent: null,
  councilTax: { band: "D", annual: 2_100, picked: false, financialYear: "2026-27" },
  mortgageRate: { ratePct: 4.92, month: "2026-08" }, zone: "2/3", travelsByTransit: true, firstTimeBuyer: false,
};
const RENT: MonthlyCostInput = { ...BUY, market: "rent", price: null, monthlyRent: 2_232 };

const line = (cost: ReturnType<typeof buildMonthlyCost>, id: string) => cost.lines.find((entry) => entry.id === id)!;

test("Travelcard: 3.84 × the 7-day price rounded up to 10p; boundary stations count as the lower zone", () => {
  assert.equal(monthlyTravelcard(2), 171.7); // £44.70 × 3.84 = £171.648
  assert.equal(monthlyTravelcard(6), 313.4); // £81.60 × 3.84 = £313.344
  assert.equal(zoneReach("1"), 2);
  assert.equal(zoneReach("2/3"), 2);
  assert.equal(zoneReach("4"), 4);
  assert.equal(zoneReach("9"), null);
  assert.equal(zoneReach(null), null);
});

test("buying a flat: mortgage, service charge, council tax and travel, each with its source", () => {
  const cost = buildMonthlyCost(BUY);
  assert.deepEqual(cost.lines.map((entry) => [entry.id, entry.source]), [
    ["mortgage", "estimated"], ["service-charge", "assumed"], ["council-tax", "assumed"], ["travel", "estimated"],
  ]);
  assert.equal(line(cost, "mortgage").monthly, monthlyMortgagePayment(450_000, 4.92, 25));
  assert.equal(line(cost, "service-charge").monthly, LONDON_SERVICE_CHARGE_ANNUAL / 12);
  assert.equal(line(cost, "council-tax").monthly, 175);
  assert.equal(line(cost, "travel").monthly, 171.7);
  assert.ok(cost.complete);
  const total = cost.lines.reduce((sum, entry) => sum + (entry.monthly ?? 0), 0);
  assert.equal(cost.monthlyTotal, total);
  assert.ok(cost.notIncluded.includes("ground rent"));
  assert.equal(cost.referencing, null);
});

test("buying upfront: a 25% deposit and stamp duty, with first-time buyer relief when asked", () => {
  const standard = buildMonthlyCost(BUY);
  assert.deepEqual(standard.upfront.map((entry) => [entry.id, entry.amount]), [["deposit", 150_000], ["stamp-duty", 20_000]]);
  assert.equal(standard.upfrontTotal, 170_000);
  const first = buildMonthlyCost({ ...BUY, price: 450_000, firstTimeBuyer: true });
  assert.equal(first.upfront[1].amount, 7_500); // 0% to £300k, 5% on the next £150k
  assert.match(first.upfront[1].note, /First-time buyer relief/);
});

test("a house has no service charge; a picked band is official", () => {
  const cost = buildMonthlyCost({ ...BUY, propertyType: "house", councilTax: { ...BUY.councilTax!, picked: true } });
  assert.equal(cost.lines.find((entry) => entry.id === "service-charge"), undefined);
  assert.equal(line(cost, "council-tax").source, "official");
});

test("unknown inputs stay unknown, never zero", () => {
  const cost = buildMonthlyCost({ ...BUY, price: null, councilTax: null, zone: null });
  assert.equal(line(cost, "mortgage").monthly, null);
  assert.equal(line(cost, "mortgage").source, "unknown");
  assert.equal(line(cost, "council-tax").source, "unknown");
  assert.equal(line(cost, "travel").source, "unknown");
  assert.equal(cost.complete, false);
  assert.deepEqual(cost.upfront, []);
});

test("walking or cycling to every place counts no fares, as a stated assumption", () => {
  const travel = line(buildMonthlyCost({ ...BUY, travelsByTransit: false }), "travel");
  assert.equal(travel.monthly, 0);
  assert.equal(travel.source, "assumed");
  assert.doesNotMatch(travel.note, /walked|cycled/); // any non-transit mode, not only walking or cycling
});

test("renting: the borough rent, a 30× referencing check and the Renters' Rights Act upfront limits", () => {
  const cost = buildMonthlyCost(RENT);
  assert.deepEqual(cost.lines.map((entry) => entry.id), ["rent", "council-tax", "travel"]);
  assert.equal(line(cost, "rent").monthly, 2_232);
  assert.equal(line(cost, "rent").source, "estimated");
  assert.deepEqual(cost.referencing, { incomeNeeded: 66_960, guarantorIncomeNeeded: 80_352 });
  assert.deepEqual(cost.upfront.map((entry) => [entry.id, entry.amount]), [["first-month", 2_232], ["deposit", 2_575]]);
  const studio = buildMonthlyCost({ ...RENT, monthlyRent: null });
  assert.equal(line(studio, "rent").source, "unknown");
  assert.equal(studio.referencing, null);
});

test("tenancy deposit: five weeks, six from £50,000 a year", () => {
  assert.equal(tenancyDeposit(2_000), 2_307);
  assert.equal(tenancyDeposit(5_000), 6_923);
  const deposit = buildMonthlyCost({ ...RENT, monthlyRent: 5_000 }).upfront.find((entry) => entry.id === "deposit")!;
  assert.match(deposit.note, /six weeks/);
});

test("typical council tax band grows with bedrooms", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 6].map(typicalBand), ["C", "C", "D", "E", "F", "F"]);
});
