import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_BUY_TO_LET, brrr, buyToLet, exampleBuyToLet, exampleFlip, exampleHmo, exampleBrrr, flip, hmo, mortgagePayment,
  type BrrrInputs, type BuyToLetInputs, type FlipInputs, type HmoInputs,
} from "../src/lib/investor";

test("the example numbers give a result on first load, with optional costs listed as not counted", () => {
  const example = exampleBuyToLet(500_000, 4.78);
  assert.equal(example.deposit, 125_000);
  assert.equal(example.annualInterestRatePct, 4.78);
  assert.equal(example.monthlyRent, 2_250);
  assert.equal(example.termYears, 25);
  const result = buyToLet(example);
  assert.deepEqual(result.missing, []);
  assert.ok(result.monthlyCashFlow !== null);
  assert.ok(result.unknowns.length > 0);
  assert.equal(exampleBuyToLet(500_000, null).annualInterestRatePct, 5);
});

const FLAT: BuyToLetInputs = {
  ...EMPTY_BUY_TO_LET,
  price: 250_000,
  deposit: 62_500,
  annualInterestRatePct: 5,
  termYears: 25,
  repayment: "interest-only",
  monthlyRent: 1_250,
  voidWeeksPerYear: 2,
  agentFeePct: 10,
  serviceChargeMonthly: 0,
  groundRentAnnual: 0,
  insuranceAnnual: 300,
  maintenanceMonthly: 50,
  legalAndSurvey: 2_000,
  refurbishment: 0,
  additionalProperty: true,
  nonUkResident: false,
};

const near = (actual: number | null, expected: number, tolerance = 0.01) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < tolerance, `expected ≈${expected}, got ${actual}`);

test("worked example: £250,000 flat let at £1,250 a month, interest-only at 5%", () => {
  const result = buyToLet(FLAT);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unknowns, []);
  // Rent 1,250 × 12 = 15,000; gross yield 15,000 / 250,000 = 6%.
  assert.equal(result.annualRent, 15_000);
  near(result.grossYieldPct, 6);
  // Two empty weeks: 15,000 × 50/52 = 14,423.08.
  near(result.annualRentAfterVoids, 14_423.08);
  // Costs: agent 10% of 14,423.08 (1,442.31) + insurance 300 + maintenance 50 × 12 (600) = 2,342.31.
  near(result.annualRunningCosts, 2_342.31);
  // Net income 14,423.08 − 2,342.31 = 12,080.77; net yield 12,080.77 / 250,000 = 4.83%.
  near(result.netOperatingIncome, 12_080.77);
  near(result.netYieldPct, 4.8323);
  // Loan 187,500 (75% LTV); interest-only 187,500 × 5% / 12 = 781.25 a month.
  assert.equal(result.loan, 187_500);
  assert.equal(result.loanToValuePct, 75);
  assert.equal(result.monthlyMortgage, 781.25);
  // Cash flow 12,080.77 − 781.25 × 12 (9,375) = 2,705.77 a year, 225.48 a month.
  near(result.annualCashFlow, 2_705.77);
  near(result.monthlyCashFlow, 225.48);
  // Stamp duty with the 5% surcharge: 5% × 125,000 + 7% × 125,000 = 15,000.
  assert.equal(result.stampDuty?.total, 15_000);
  // Cash in: deposit 62,500 + stamp duty 15,000 + legal 2,000 = 79,500; return 2,705.77 / 79,500 = 3.40%.
  assert.equal(result.cashRequired, 79_500);
  near(result.cashOnCashPct, 3.4035);
});

test("a repayment mortgage costs more each month and cuts cash flow", () => {
  // £187,500 at 5% over 25 years: 187,500 × r / (1 − (1 + r)^−300), r = 0.05/12 → ≈ £1,096.11.
  const result = buyToLet({ ...FLAT, repayment: "repayment" });
  near(result.monthlyMortgage, 1_096.11, 0.05);
  near(result.annualCashFlow, 12_080.77 - 1_096.11 * 12, 0.6);
});

test("a buyer with no other home skips the surcharge: stamp duty £2,500", () => {
  // Standard rates: 2% × 125,000 = 2,500.
  const result = buyToLet({ ...FLAT, additionalProperty: false });
  assert.equal(result.stampDuty?.total, 2_500);
  assert.equal(result.cashRequired, 62_500 + 2_500 + 2_000);
});

test("negative cash flow stays negative", () => {
  // Rent 800 × 12 = 9,600; after voids 9,230.77; costs 923.08 + 300 + 600 = 1,823.08;
  // net 7,407.69 − mortgage 9,375 = −1,967.31.
  const result = buyToLet({ ...FLAT, monthlyRent: 800 });
  near(result.annualCashFlow, -1_967.31);
  assert.ok((result.cashOnCashPct ?? 0) < 0);
});

test("a cash purchase has no mortgage", () => {
  const result = buyToLet({ ...FLAT, deposit: 250_000 });
  assert.equal(result.loan, 0);
  assert.equal(result.monthlyMortgage, 0);
  near(result.annualCashFlow, 12_080.77);
});

test("blank optional costs are listed as unknown and left out of the totals", () => {
  const result = buyToLet({ ...FLAT, insuranceAnnual: null, maintenanceMonthly: null, legalAndSurvey: null });
  assert.deepEqual(result.unknowns, ["insurance", "maintenance", "legal and survey fees"]);
  near(result.annualRunningCosts, 1_442.31);
  assert.equal(result.cashRequired, 62_500 + 15_000);
});

test("missing required inputs give no figures, not zeros", () => {
  const result = buyToLet({ ...FLAT, price: null, monthlyRent: null });
  assert.deepEqual(result.missing, ["price", "monthly rent"]);
  assert.equal(result.grossYieldPct, null);
  assert.equal(result.annualCashFlow, null);
  assert.equal(result.cashRequired, null);
  assert.deepEqual(buyToLet({ ...FLAT, repayment: "repayment", termYears: null }).missing, ["term"]);
  assert.deepEqual(buyToLet({ ...FLAT, deposit: 300_000 }).missing, ["a deposit no larger than the price"]);
});

test("mortgagePayment: interest-only is loan × rate / 12; repayment reuses the housing-cost formula", () => {
  assert.equal(mortgagePayment(120_000, 6, null, "interest-only"), 600);
  assert.equal(mortgagePayment(120_000, 0, 10, "repayment"), 1_000);
  assert.equal(mortgagePayment(0, 5, 25, "repayment"), 0);
  assert.throws(() => mortgagePayment(1_000, 5, null, "repayment"), /term/);
});

const { monthlyRent: _flatRent, ...FLAT_COSTS } = FLAT;
void _flatRent;
const HMO: HmoInputs = {
  ...FLAT_COSTS,
  price: 300_000,
  deposit: 75_000,
  rooms: 5,
  rentPerRoomMonthly: 600,
  billsMonthly: 400,
  agentFeePct: 10,
  insuranceAnnual: 600,
  maintenanceMonthly: 100,
};

test("hmo: five rooms at £600 on a £300,000 house, interest-only at 5%", () => {
  const result = hmo(HMO);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unknowns, []);
  // Rent 5 × 600 × 12 = 36,000; gross yield 36,000 / 300,000 = 12%.
  assert.equal(result.annualRent, 36_000);
  near(result.grossYieldPct, 12);
  // Two empty weeks: 36,000 × 50/52 = 34,615.38.
  near(result.annualRentAfterVoids, 34_615.38);
  // Costs: agent 10% (3,461.54) + insurance 600 + repairs 100 × 12 (1,200) + bills 400 × 12 (4,800) = 10,061.54.
  near(result.annualRunningCosts, 10_061.54);
  // Net 34,615.38 − 10,061.54 = 24,553.85; net yield 24,553.85 / 300,000 = 8.185%.
  near(result.netOperatingIncome, 24_553.85);
  near(result.netYieldPct, 8.1846);
  // Loan 225,000; interest-only 225,000 × 5% / 12 = 937.50 a month (11,250 a year).
  assert.equal(result.monthlyMortgage, 937.5);
  near(result.annualCashFlow, 13_303.85);
  near(result.monthlyCashFlow, 1_108.65);
  // Stamp duty with the surcharge: 5% × 125,000 + 7% × 125,000 + 10% × 50,000 = 20,000.
  assert.equal(result.stampDuty?.total, 20_000);
  // Cash in: 75,000 + 20,000 + 2,000 legal = 97,000; 13,303.85 / 97,000 = 13.72%.
  assert.equal(result.cashRequired, 97_000);
  near(result.cashOnCashPct, 13.7153);
});

test("hmo: bills left blank are listed as not counted, and no rooms means no figures", () => {
  const blank = hmo({ ...HMO, billsMonthly: null });
  assert.deepEqual(blank.unknowns, ["bills"]);
  near(blank.annualRunningCosts, 5_261.54);
  assert.deepEqual(hmo({ ...HMO, rooms: null, rentPerRoomMonthly: null }).missing, ["rooms", "rent per room"]);
});

const BRRR: BrrrInputs = {
  price: 200_000,
  refurb: 30_000,
  valueAfter: 300_000,
  refinanceLtvPct: 75,
  annualInterestRatePct: 5,
  monthlyRent: 1_500,
  runningCostsMonthly: 0,
  legalAndSurvey: 0,
  additionalProperty: true,
  nonUkResident: false,
};

test("brrr: £200,000 + £30,000 of work, valued at £300,000, refinanced at 75% and let at £1,500", () => {
  const result = brrr(BRRR);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unknowns, []);
  // Stamp duty with the surcharge: 5% × 125,000 + 7% × 75,000 = 11,500.
  assert.equal(result.stampDuty?.total, 11_500);
  // Cash in before the refinance: 200,000 + 11,500 + 30,000 = 241,500.
  assert.equal(result.totalCost, 241_500);
  // New mortgage 75% × 300,000 = 225,000, so 241,500 − 225,000 = 16,500 stays in.
  assert.equal(result.refinanceLoan, 225_000);
  assert.equal(result.moneyLeftIn, 16_500);
  assert.equal(result.cashReleased, 0);
  // Interest-only 225,000 × 5% / 12 = 937.50; cash flow 1,500 − 937.50 = 562.50 a month, 6,750 a year.
  assert.equal(result.monthlyMortgage, 937.5);
  assert.equal(result.cashFlowMonthly, 562.5);
  assert.equal(result.annualCashFlow, 6_750);
  // 6,750 / 16,500 = 40.91% a year on the money left in.
  near(result.roiPct, 40.9091);
});

test("brrr: a refinance that returns all the cash has no money left in and no ratio", () => {
  const result = brrr({ ...BRRR, valueAfter: 400_000 });
  // 75% × 400,000 = 300,000 against 241,500 in: 58,500 comes back.
  assert.equal(result.moneyLeftIn, 0);
  assert.equal(result.cashReleased, 58_500);
  assert.equal(result.roiPct, null);
  assert.equal(result.cashFlowMonthly, 1_500 - 1_250);
});

test("brrr: blank costs are listed as not counted", () => {
  const result = brrr({ ...BRRR, runningCostsMonthly: null, legalAndSurvey: null });
  assert.deepEqual(result.unknowns, ["running costs", "legal and survey fees"]);
  assert.equal(result.moneyLeftIn, 16_500);
  assert.deepEqual(brrr({ ...BRRR, valueAfter: null }).missing, ["value after work"]);
});

const FLIP: FlipInputs = {
  price: 200_000,
  refurb: 30_000,
  salePrice: 300_000,
  months: 6,
  financeRatePct: 8,
  sellingCostsPct: 1.5,
  legalAndSurvey: 0,
  additionalProperty: true,
  nonUkResident: false,
};

test("flip: buy at £200,000, £30,000 of work, sell at £300,000 after six months on 8% finance", () => {
  const result = flip(FLIP);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unknowns, []);
  assert.equal(result.stampDuty?.total, 11_500);
  // Finance 8% a year on (200,000 + 30,000) for six months = 9,200; selling 1.5% × 300,000 = 4,500.
  assert.equal(result.financeCost, 9_200);
  assert.equal(result.sellingCosts, 4_500);
  // Cost in: 200,000 + 11,500 + 30,000 + 9,200 = 250,700.
  assert.equal(result.totalCost, 250_700);
  // Profit 300,000 − 4,500 − 250,700 = 44,800; 44,800 / 250,700 = 17.87%, 35.74% a year.
  assert.equal(result.profit, 44_800);
  near(result.roiPct, 17.8699);
  near(result.annualisedRoiPct, 35.7399);
});

test("flip: a loss stays negative, blank costs are listed, missing months gives no figures", () => {
  const loss = flip({ ...FLIP, salePrice: 250_000, sellingCostsPct: null });
  assert.deepEqual(loss.unknowns, ["selling costs"]);
  // 250,000 − 250,700 = −700.
  assert.equal(loss.profit, -700);
  assert.deepEqual(flip({ ...FLIP, months: null }).missing, ["months held"]);
  assert.deepEqual(flip({ ...FLIP, months: 0 }).missing, ["months held"]);
});

test("the examples open each tab with figures", () => {
  assert.deepEqual(hmo(exampleHmo(300_000, 5, 1_800)).missing, []);
  assert.deepEqual(brrr(exampleBrrr(200_000, 5, 1_900)).missing, []);
  assert.deepEqual(flip(exampleFlip(200_000)).missing, []);
  assert.equal(exampleHmo(300_000, null, null).rentPerRoomMonthly, 750);
});
