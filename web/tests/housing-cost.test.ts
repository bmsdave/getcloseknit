import assert from "node:assert/strict";
import test from "node:test";

import type { PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { HELP } from "../src/lib/help-texts";
import {
  COMPARISON_DISCLAIMER,
  budgetSentence,
  buildCostWorksheet,
  compareToBudget,
  moneyInputText,
  monthlyMortgagePayment,
  parseMoneyInput,
  statutoryVersionFor,
  type CostAssumptions,
} from "../src/lib/housing-cost";

test("the budget line compares the price with the maximum, never a negative 'remaining' figure", () => {
  const profile = { ...DEFAULT_PROFILE, market: "buy", maximumBudget: 650_000, targetBudget: 500_000 } as PreferenceProfile;
  const empty = { price: null, deposit: null, annualInterestRatePct: null, termYears: null, monthlyRent: null, serviceChargeMonthly: null,
    groundRentAnnual: null, maintenanceMonthly: null, councilTaxMonthly: null, utilitiesMonthly: null, movingCosts: null, rentalUpfront: null };
  assert.deepEqual(budgetSentence(profile, "buy", { ...empty, price: 708_000 }, 0), { text: "£58k over your £650k max", over: true });
  assert.deepEqual(budgetSentence(profile, "buy", { ...empty, price: 600_000 }, 0), { text: "£50k under your £650k max", over: false });
  assert.equal(budgetSentence(profile, "buy", empty, 0), null);
  const renter = { ...profile, market: "rent", targetBudget: 2_000 } as PreferenceProfile;
  assert.deepEqual(budgetSentence(renter, "rent", empty, 2_120), { text: "£120 a month over your £2,000 budget", over: true });
});

test("money inputs read £708,000 and parse back", () => {
  assert.equal(moneyInputText(708_000), "£708,000");
  assert.equal(moneyInputText(null), "");
  assert.equal(parseMoneyInput("£708,000"), 708_000);
  assert.equal(parseMoneyInput("708k"), 708_000);
  assert.equal(parseMoneyInput("1.2m"), 1_200_000);
  assert.equal(parseMoneyInput(""), null);
  assert.equal(parseMoneyInput("abc"), null);
});

const BUY_BASE: CostAssumptions = {
  price: 400_000,
  deposit: 160_000,
  annualInterestRatePct: 5,
  termYears: 25,
  monthlyRent: null,
  serviceChargeMonthly: 150,
  groundRentAnnual: 240,
  maintenanceMonthly: 100,
  councilTaxMonthly: 140,
  utilitiesMonthly: 120,
  movingCosts: 3_000,
  rentalUpfront: null,
};

test("zero interest divides the loan evenly across the term", () => {
  assert.equal(monthlyMortgagePayment(120_000, 0, 10), 1_000);
});

test("worked example: £240,000 at 5% over 25 years is about £1,403.02/month", () => {
  // Hand check: r = 0.05/12, n = 300; M = 240000*r/(1-(1+r)^-300).
  // (1+r)^300 ≈ 3.4677, so M ≈ 1000/0.7116 ≈ 1403.02 (cross-checked in Python).
  const actual = monthlyMortgagePayment(240_000, 5, 25);
  assert.ok(Math.abs(actual - 1403.02) < 0.05, `expected ≈1403.02, got ${actual}`);
});

test("worked example: £150,000 at 3% over 20 years is about £831.90/month", () => {
  // Hand check: r = 0.0025, n = 240; (1+r)^240 ≈ 1.8208,
  // M = 375/(1-1/1.8208) ≈ 375/0.4508 ≈ 831.90.
  const actual = monthlyMortgagePayment(150_000, 3, 20);
  assert.ok(Math.abs(actual - 831.9) < 0.05, `expected ≈831.90, got ${actual}`);
});

test("missing mandatory purchase inputs are listed and the mortgage stays unknown", () => {
  const result = buildCostWorksheet("buy", { ...BUY_BASE, price: null, annualInterestRatePct: null });
  assert.ok(result.missing.includes("price"));
  assert.ok(result.missing.includes("interest rate"));
  const mortgage = result.lines.find((line) => line.id === "mortgage")!;
  assert.equal(mortgage.monthlyAmount, null);
  assert.equal(mortgage.provenance, "unknown");
});

test("missing mandatory rental input is listed", () => {
  const result = buildCostWorksheet("rent", { ...BUY_BASE, monthlyRent: null });
  assert.ok(result.missing.includes("monthly rent"));
});

test("a higher rate raises the payment on the same loan", () => {
  const cheap = monthlyMortgagePayment(240_000, 3, 25);
  const pricey = monthlyMortgagePayment(240_000, 6, 25);
  assert.ok(pricey > cheap, `6% (${pricey}) should exceed 3% (${cheap})`);
  const base = buildCostWorksheet("buy", BUY_BASE);
  const raised = buildCostWorksheet("buy", { ...BUY_BASE, annualInterestRatePct: 6 });
  assert.ok(raised.monthlyTotal > base.monthlyTotal);
});

test("invalid loan terms throw instead of inventing a payment", () => {
  assert.throws(() => monthlyMortgagePayment(240_000, -1, 25));
  assert.throws(() => monthlyMortgagePayment(240_000, 5, 0));
  assert.throws(() => monthlyMortgagePayment(0, 5, 25));
});

test("buy and rent tenures use different cost lines", () => {
  const buy = buildCostWorksheet("buy", BUY_BASE);
  const rent = buildCostWorksheet("rent", { ...BUY_BASE, monthlyRent: 1_800 });
  assert.ok(buy.lines.some((line) => line.id === "mortgage"));
  assert.ok(!buy.lines.some((line) => line.id === "monthly-rent"));
  assert.ok(!buy.lines.some((line) => line.id === "rental-upfront"));
  assert.ok(rent.lines.some((line) => line.id === "monthly-rent"));
  assert.ok(rent.lines.some((line) => line.id === "rental-upfront"));
  assert.ok(!rent.lines.some((line) => line.id === "mortgage"));
  assert.ok(!rent.lines.some((line) => line.id === "service-charge"));
  assert.ok(!rent.lines.some((line) => line.id === "ground-rent"));
});

test("monthly and annual figures convert consistently", () => {
  const result = buildCostWorksheet("buy", BUY_BASE);
  const groundRent = result.lines.find((line) => line.id === "ground-rent")!;
  assert.equal(groundRent.monthlyAmount, 20);
  assert.equal(result.annualOngoingTotal, result.monthlyTotal * 12);
  assert.equal(result.firstYearTotal, result.annualOngoingTotal + result.oneOffTotal);
  assert.equal(result.oneOffTotal, 3_000);
});

test("an unknown service charge stays unknown and never defaults to zero", () => {
  const result = buildCostWorksheet("buy", { ...BUY_BASE, serviceChargeMonthly: null });
  const service = result.lines.find((line) => line.id === "service-charge")!;
  assert.equal(service.monthlyAmount, null);
  assert.equal(service.provenance, "unknown");
  assert.notEqual(service.monthlyAmount, 0);
  assert.ok(result.unknowns.includes("Service charge"));
  const withCharge = buildCostWorksheet("buy", BUY_BASE);
  assert.equal(withCharge.monthlyTotal, result.monthlyTotal + 150);
});

test("statutory figures are versioned by effective date and jurisdiction", () => {
  const before = statutoryVersionFor("sdlt-residential-nil-rate", "england", "2023-06-01");
  assert.equal(before?.detail, "nil-rate threshold £250,000");
  const after = statutoryVersionFor("sdlt-residential-nil-rate", "england", "2025-06-01");
  assert.equal(after?.detail, "nil-rate threshold £125,000");
  assert.equal(statutoryVersionFor("sdlt-residential-nil-rate", "wales", "2025-06-01"), null);
  assert.equal(
    statutoryVersionFor("tenant-fees-act", "england", "2025-06-01")?.effectiveDate,
    "2019-06-01",
  );
});

test("remaining budget reuses the affordability profile, with no second store", () => {
  const profile: PreferenceProfile = { ...structuredClone(DEFAULT_PROFILE), market: "rent", targetBudget: 2_000 };
  const before = compareToBudget(profile, buildCostWorksheet("rent", { ...BUY_BASE, monthlyRent: 1_500 }));
  const after = compareToBudget(
    profile,
    buildCostWorksheet("rent", { ...BUY_BASE, monthlyRent: 1_500, utilitiesMonthly: 320 }),
  );
  assert.equal(typeof before.total, "number");
  assert.equal(typeof after.total, "number");
  assert.equal(typeof before.remaining, "number");
  assert.equal(typeof after.remaining, "number");
  assert.equal(before.remaining, 2_000 - before.total!);
  assert.ok(after.total! > before.total!);
  assert.ok(after.remaining! < before.remaining!);
});

test("the worksheet frames comparison, never advice", () => {
  assert.match(COMPARISON_DISCLAIMER, /comparison tool/i);
  assert.match(COMPARISON_DISCLAIMER, /not mortgage advice/i);
  assert.match(COMPARISON_DISCLAIMER, /investment returns/i);
  // The worksheet shows this framing behind its (?): the bubble must keep it.
  assert.match(HELP["cost-comparison"].short, /not mortgage advice/i);
  assert.match(HELP["cost-comparison"].short, /investment returns/i);
});
