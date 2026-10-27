// Investor numbers for one home: buy-to-let, HMO, refinance (BRRR) and flip.
// Yields, cash flow and the cash needed to buy it. Built on the housing-cost mortgage maths and the stamp duty
// table. Everything is before income tax. Optional costs left blank are
// listed as unknown and left out of the totals — never counted as zero
// without saying so.
import { monthlyMortgagePayment } from "./housing-cost";
import type { Sourced } from "./sourced";
import { calculateStampDuty, type SdltResult } from "./stamp-duty";

export type RepaymentType = "interest-only" | "repayment";

export interface BuyToLetInputs {
  price: number | null;
  deposit: number | null;
  annualInterestRatePct: number | null;
  termYears: number | null;
  repayment: RepaymentType;
  monthlyRent: number | null;
  /** Weeks a year with no tenant paying rent. */
  voidWeeksPerYear: number | null;
  /** Letting agent fee, percent of rent collected. */
  agentFeePct: number | null;
  serviceChargeMonthly: number | null;
  groundRentAnnual: number | null;
  insuranceAnnual: number | null;
  maintenanceMonthly: number | null;
  legalAndSurvey: number | null;
  refurbishment: number | null;
  /** The buyer will own another home after this purchase (5% surcharge). */
  additionalProperty: boolean;
  nonUkResident: boolean;
}

export const EMPTY_BUY_TO_LET: BuyToLetInputs = {
  price: null,
  deposit: null,
  annualInterestRatePct: null,
  termYears: null,
  repayment: "interest-only",
  monthlyRent: null,
  voidWeeksPerYear: null,
  agentFeePct: null,
  serviceChargeMonthly: null,
  groundRentAnnual: null,
  insuranceAnnual: null,
  maintenanceMonthly: null,
  legalAndSurvey: null,
  refurbishment: null,
  additionalProperty: true,
  nonUkResident: false,
};

/**
 * The example the calculator opens with so a result shows before anyone
 * types. Nobody published these: they are our assumptions, labelled as such
 * on the page, and every one is an editable input.
 */
export const BUY_TO_LET_EXAMPLE: Sourced<{
  /** The example rent is this share of the price a year. */
  grossYieldPct: number;
  /** Mortgage rate used when no published rate is at hand. */
  fallbackRatePct: number;
  depositShare: number;
  termYears: number;
  voidWeeksPerYear: number;
  agentFeePct: number;
}> = {
  value: { grossYieldPct: 5.4, fallbackRatePct: 5, depositShare: 0.25, termYears: 25, voidWeeksPerYear: 2, agentFeePct: 12 },
  kind: "assumption",
  source: "Close Knit",
  asOf: "2026-10",
};

export const EXAMPLE_GROSS_YIELD_PCT = BUY_TO_LET_EXAMPLE.value.grossYieldPct;

/**
 * Editable example numbers (BUY_TO_LET_EXAMPLE): a 25% deposit, the latest
 * average 5-year fixed rate, a rent at a 5.4% gross yield (£2,250 a month on
 * £500,000), a 25-year interest-only loan, two empty weeks and a 12% agent
 * fee. Optional costs stay blank and are listed as not counted.
 */
export function exampleBuyToLet(price: number, fixed5Pct: number | null): BuyToLetInputs {
  const example = BUY_TO_LET_EXAMPLE.value;
  return {
    ...EMPTY_BUY_TO_LET,
    price,
    deposit: Math.round((price * example.depositShare) / 1000) * 1000,
    annualInterestRatePct: fixed5Pct !== null && fixed5Pct > 0 ? Math.round(fixed5Pct * 100) / 100 : example.fallbackRatePct,
    termYears: example.termYears,
    monthlyRent: Math.round((price * example.grossYieldPct) / 100 / 12 / 50) * 50,
    voidWeeksPerYear: example.voidWeeksPerYear,
    agentFeePct: example.agentFeePct,
  };
}

export interface BuyToLetResult {
  /** Required inputs still empty; when non-empty the figures below are null. */
  missing: string[];
  /** Optional inputs left blank and therefore left out of the totals. */
  unknowns: string[];
  annualRent: number | null;
  annualRentAfterVoids: number | null;
  annualRunningCosts: number | null;
  netOperatingIncome: number | null;
  grossYieldPct: number | null;
  netYieldPct: number | null;
  loan: number | null;
  loanToValuePct: number | null;
  monthlyMortgage: number | null;
  monthlyCashFlow: number | null;
  annualCashFlow: number | null;
  stampDuty: SdltResult | null;
  cashRequired: number | null;
  cashOnCashPct: number | null;
}

const WEEKS_PER_YEAR = 52;

export function buyToLet(inputs: BuyToLetInputs): BuyToLetResult {
  return computeLet(inputs, 0, optionalUnknowns(inputs));
}

/** The shared let maths; `extraAnnualCosts` is a running cost the plain buy-to-let does not have (an HMO's bills). */
function computeLet(inputs: BuyToLetInputs, extraAnnualCosts: number, unknowns: string[]): BuyToLetResult {
  const missing = requiredMissing(inputs);
  if (missing.length > 0) return emptyResult(missing, unknowns);
  const price = inputs.price as number;
  const deposit = inputs.deposit as number;
  const rate = inputs.annualInterestRatePct as number;
  const monthlyRent = inputs.monthlyRent as number;
  if (deposit > price) return emptyResult(["a deposit no larger than the price"], unknowns);

  const annualRent = monthlyRent * 12;
  const voidWeeks = Math.min(WEEKS_PER_YEAR, inputs.voidWeeksPerYear ?? 0);
  const annualRentAfterVoids = (annualRent * (WEEKS_PER_YEAR - voidWeeks)) / WEEKS_PER_YEAR;
  const annualRunningCosts =
    (annualRentAfterVoids * (inputs.agentFeePct ?? 0)) / 100
    + (inputs.serviceChargeMonthly ?? 0) * 12
    + (inputs.groundRentAnnual ?? 0)
    + (inputs.insuranceAnnual ?? 0)
    + (inputs.maintenanceMonthly ?? 0) * 12
    + extraAnnualCosts;
  const netOperatingIncome = annualRentAfterVoids - annualRunningCosts;

  const loan = price - deposit;
  const monthlyMortgage = mortgagePayment(loan, rate, inputs.termYears, inputs.repayment);
  const annualCashFlow = netOperatingIncome - monthlyMortgage * 12;

  const stampDuty = calculateStampDuty({
    price,
    firstTimeBuyer: false,
    additionalProperty: inputs.additionalProperty,
    nonUkResident: inputs.nonUkResident,
  });
  const cashRequired = deposit + stampDuty.total + (inputs.legalAndSurvey ?? 0) + (inputs.refurbishment ?? 0);

  return {
    missing,
    unknowns,
    annualRent,
    annualRentAfterVoids,
    annualRunningCosts,
    netOperatingIncome,
    grossYieldPct: price > 0 ? (annualRent / price) * 100 : null,
    netYieldPct: price > 0 ? (netOperatingIncome / price) * 100 : null,
    loan,
    loanToValuePct: price > 0 ? (loan / price) * 100 : null,
    monthlyMortgage,
    monthlyCashFlow: annualCashFlow / 12,
    annualCashFlow,
    stampDuty,
    cashRequired,
    cashOnCashPct: cashRequired > 0 ? (annualCashFlow / cashRequired) * 100 : null,
  };
}

/** Interest-only pays just the interest; repayment also pays the loan off over the term. */
export function mortgagePayment(
  loan: number,
  annualRatePct: number,
  termYears: number | null,
  repayment: RepaymentType,
): number {
  if (loan <= 0) return 0;
  if (repayment === "interest-only") return (loan * annualRatePct) / 100 / 12;
  if (termYears === null) throw new Error("a repayment mortgage needs a term");
  return monthlyMortgagePayment(loan, annualRatePct, termYears);
}

function requiredMissing(inputs: BuyToLetInputs): string[] {
  const missing: string[] = [];
  if (inputs.price === null || inputs.price <= 0) missing.push("price");
  if (inputs.deposit === null) missing.push("deposit");
  if (inputs.annualInterestRatePct === null) missing.push("interest rate");
  if (inputs.repayment === "repayment" && (inputs.termYears === null || inputs.termYears <= 0)) missing.push("term");
  if (inputs.monthlyRent === null) missing.push("monthly rent");
  return missing;
}

function optionalUnknowns(inputs: BuyToLetInputs): string[] {
  const labels: [keyof BuyToLetInputs, string][] = [
    ["voidWeeksPerYear", "empty weeks"],
    ["agentFeePct", "letting agent fee"],
    ["serviceChargeMonthly", "service charge"],
    ["groundRentAnnual", "ground rent"],
    ["insuranceAnnual", "insurance"],
    ["maintenanceMonthly", "maintenance"],
    ["legalAndSurvey", "legal and survey fees"],
    ["refurbishment", "refurbishment"],
  ];
  return labels.filter(([key]) => inputs[key] === null).map(([, label]) => label);
}

function emptyResult(missing: string[], unknowns: string[]): BuyToLetResult {
  return {
    missing, unknowns,
    annualRent: null, annualRentAfterVoids: null, annualRunningCosts: null, netOperatingIncome: null,
    grossYieldPct: null, netYieldPct: null, loan: null, loanToValuePct: null, monthlyMortgage: null,
    monthlyCashFlow: null, annualCashFlow: null, stampDuty: null, cashRequired: null, cashOnCashPct: null,
  };
}

// ---------------------------------------------------------------------------
// HMO: one house let by the room.

export interface HmoInputs extends Omit<BuyToLetInputs, "monthlyRent"> {
  rooms: number | null;
  rentPerRoomMonthly: number | null;
  /** Gas, electricity, water, internet and council tax the landlord pays, a month in total. */
  billsMonthly: number | null;
}

export const HMO_EXAMPLE: Sourced<{
  rooms: number;
  /** The example room rent is this share of the borough's one-bedroom rent. */
  roomRentShareOfOneBed: number;
  /** Room rent used when no borough rent is at hand. */
  fallbackRoomRent: number;
  billsMonthly: number;
  voidWeeksPerYear: number;
  agentFeePct: number;
}> = {
  value: { rooms: 5, roomRentShareOfOneBed: 0.5, fallbackRoomRent: 750, billsMonthly: 400, voidWeeksPerYear: 3, agentFeePct: 15 },
  kind: "assumption",
  source: "Close Knit",
  asOf: "2026-10",
};

/**
 * Editable HMO example: five rooms, each at half the borough's one-bedroom rent (£750 when there is none),
 * £400 a month of bills, three empty weeks and a 15% management fee. The mortgage side is the buy-to-let one.
 * An HMO usually needs a licence and fire safety work: enter those under work before letting.
 */
export function exampleHmo(price: number, fixed5Pct: number | null, oneBedRent: number | null): HmoInputs {
  const base = exampleBuyToLet(price, fixed5Pct);
  const example = HMO_EXAMPLE.value;
  const { monthlyRent: _rent, ...costs } = base;
  void _rent;
  return {
    ...costs,
    voidWeeksPerYear: example.voidWeeksPerYear,
    agentFeePct: example.agentFeePct,
    rooms: example.rooms,
    rentPerRoomMonthly: oneBedRent !== null && oneBedRent > 0
      ? Math.round((oneBedRent * example.roomRentShareOfOneBed) / 10) * 10
      : example.fallbackRoomRent,
    billsMonthly: example.billsMonthly,
  };
}

export interface HmoResult extends BuyToLetResult {
  /** The rent of all rooms together, a month. */
  monthlyRent: number | null;
}

export function hmo(inputs: HmoInputs): HmoResult {
  const { rooms, rentPerRoomMonthly, billsMonthly, ...rest } = inputs;
  const roomMissing: string[] = [];
  if (rooms === null || rooms <= 0) roomMissing.push("rooms");
  if (rentPerRoomMonthly === null) roomMissing.push("rent per room");
  const monthlyRent = roomMissing.length === 0 ? (rooms as number) * (rentPerRoomMonthly as number) : null;
  const unknowns = optionalUnknowns({ ...rest, monthlyRent });
  if (billsMonthly === null) unknowns.push("bills");
  const result = computeLet({ ...rest, monthlyRent }, (billsMonthly ?? 0) * 12, unknowns);
  // The shared check names the rent as "monthly rent"; an HMO names its rooms and their rent instead.
  return { ...result, missing: result.missing.flatMap((name) => (name === "monthly rent" ? roomMissing : [name])), monthlyRent };
}

// ---------------------------------------------------------------------------
// BRRR: buy, refurbish, rent, refinance.

export interface BrrrInputs {
  price: number | null;
  refurb: number | null;
  /** What the home is worth once the work is done (a surveyor's figure, not ours). */
  valueAfter: number | null;
  refinanceLtvPct: number | null;
  annualInterestRatePct: number | null;
  monthlyRent: number | null;
  /** Agent, repairs and insurance together, a month. */
  runningCostsMonthly: number | null;
  legalAndSurvey: number | null;
  additionalProperty: boolean;
  nonUkResident: boolean;
}

export const BRRR_EXAMPLE: Sourced<{
  /** The example work costs this share of the price. */
  refurbShare: number;
  /** The example value after work is this multiple of the price. */
  valueAfterMultiple: number;
  refinanceLtvPct: number;
  fallbackRatePct: number;
}> = {
  value: { refurbShare: 0.15, valueAfterMultiple: 1.3, refinanceLtvPct: 75, fallbackRatePct: 5 },
  kind: "assumption",
  source: "Close Knit",
  asOf: "2026-10",
};

/** Editable BRRR example: work at 15% of the price, a value after work of 1.3 times the price, a 75% refinance. */
export function exampleBrrr(price: number, fixed5Pct: number | null, monthlyRent: number | null): BrrrInputs {
  const example = BRRR_EXAMPLE.value;
  const valueAfter = Math.round((price * example.valueAfterMultiple) / 1000) * 1000;
  return {
    price,
    refurb: Math.round((price * example.refurbShare) / 1000) * 1000,
    valueAfter,
    refinanceLtvPct: example.refinanceLtvPct,
    annualInterestRatePct: fixed5Pct !== null && fixed5Pct > 0 ? Math.round(fixed5Pct * 100) / 100 : example.fallbackRatePct,
    monthlyRent: monthlyRent ?? Math.round((valueAfter * BUY_TO_LET_EXAMPLE.value.grossYieldPct) / 100 / 12 / 50) * 50,
    runningCostsMonthly: null,
    legalAndSurvey: null,
    additionalProperty: true,
    nonUkResident: false,
  };
}

export interface BrrrResult {
  missing: string[];
  unknowns: string[];
  stampDuty: SdltResult | null;
  /** Price + stamp duty + work + fees: the cash in before the refinance. */
  totalCost: number | null;
  refinanceLoan: number | null;
  /** Cash still tied up after the refinance; 0 when the refinance returns all of it. */
  moneyLeftIn: number | null;
  /** Cash handed back beyond what went in; 0 unless the refinance pays out more than the cost. */
  cashReleased: number | null;
  monthlyMortgage: number | null;
  cashFlowMonthly: number | null;
  annualCashFlow: number | null;
  /** Yearly cash flow over the money left in; null when nothing is left in (the return has no ratio). */
  roiPct: number | null;
}

export function brrr(inputs: BrrrInputs): BrrrResult {
  const missing: string[] = [];
  if (inputs.price === null || inputs.price <= 0) missing.push("price");
  if (inputs.refurb === null) missing.push("work cost");
  if (inputs.valueAfter === null || inputs.valueAfter <= 0) missing.push("value after work");
  if (inputs.refinanceLtvPct === null) missing.push("refinance loan-to-value");
  if (inputs.annualInterestRatePct === null) missing.push("interest rate");
  if (inputs.monthlyRent === null) missing.push("monthly rent");
  const unknowns: string[] = [];
  if (inputs.runningCostsMonthly === null) unknowns.push("running costs");
  if (inputs.legalAndSurvey === null) unknowns.push("legal and survey fees");
  if (missing.length > 0) {
    return {
      missing, unknowns, stampDuty: null, totalCost: null, refinanceLoan: null, moneyLeftIn: null, cashReleased: null,
      monthlyMortgage: null, cashFlowMonthly: null, annualCashFlow: null, roiPct: null,
    };
  }
  const price = inputs.price as number;
  const stampDuty = calculateStampDuty({
    price, firstTimeBuyer: false, additionalProperty: inputs.additionalProperty, nonUkResident: inputs.nonUkResident,
  });
  const totalCost = price + stampDuty.total + (inputs.refurb as number) + (inputs.legalAndSurvey ?? 0);
  const refinanceLoan = ((inputs.valueAfter as number) * (inputs.refinanceLtvPct as number)) / 100;
  const monthlyMortgage = mortgagePayment(refinanceLoan, inputs.annualInterestRatePct as number, null, "interest-only");
  const cashFlowMonthly = (inputs.monthlyRent as number) - (inputs.runningCostsMonthly ?? 0) - monthlyMortgage;
  const moneyLeftIn = Math.max(0, totalCost - refinanceLoan);
  return {
    missing, unknowns, stampDuty, totalCost, refinanceLoan, moneyLeftIn,
    cashReleased: Math.max(0, refinanceLoan - totalCost),
    monthlyMortgage, cashFlowMonthly, annualCashFlow: cashFlowMonthly * 12,
    roiPct: moneyLeftIn > 0 ? ((cashFlowMonthly * 12) / moneyLeftIn) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// Flip: buy, do the work, sell.

export interface FlipInputs {
  price: number | null;
  refurb: number | null;
  salePrice: number | null;
  /** Months from buying to selling. */
  months: number | null;
  /** Yearly interest on the price and the work, borrowed for the whole time; 0 for cash. */
  financeRatePct: number | null;
  /** Estate agent and legal fees on the sale, percent of the sale price. */
  sellingCostsPct: number | null;
  legalAndSurvey: number | null;
  additionalProperty: boolean;
  nonUkResident: boolean;
}

export const FLIP_EXAMPLE: Sourced<{
  refurbShare: number;
  /** The example sale price is this multiple of the price. */
  salePriceMultiple: number;
  months: number;
  financeRatePct: number;
  sellingCostsPct: number;
}> = {
  value: { refurbShare: 0.15, salePriceMultiple: 1.3, months: 6, financeRatePct: 8, sellingCostsPct: 1.5 },
  kind: "assumption",
  source: "Close Knit",
  asOf: "2026-10",
};

/** Editable flip example: work at 15% of the price, a sale at 1.3 times the price after 6 months, 8% finance, 1.5% selling costs. */
export function exampleFlip(price: number): FlipInputs {
  const example = FLIP_EXAMPLE.value;
  return {
    price,
    refurb: Math.round((price * example.refurbShare) / 1000) * 1000,
    salePrice: Math.round((price * example.salePriceMultiple) / 1000) * 1000,
    months: example.months,
    financeRatePct: example.financeRatePct,
    sellingCostsPct: example.sellingCostsPct,
    legalAndSurvey: null,
    additionalProperty: true,
    nonUkResident: false,
  };
}

export interface FlipResult {
  missing: string[];
  unknowns: string[];
  stampDuty: SdltResult | null;
  financeCost: number | null;
  sellingCosts: number | null;
  /** Price + stamp duty + work + fees + finance: everything spent before the sale. */
  totalCost: number | null;
  profit: number | null;
  /** Profit over the total cost. */
  roiPct: number | null;
  /** The same return scaled to twelve months (simple, not compounded). */
  annualisedRoiPct: number | null;
}

export function flip(inputs: FlipInputs): FlipResult {
  const missing: string[] = [];
  if (inputs.price === null || inputs.price <= 0) missing.push("price");
  if (inputs.refurb === null) missing.push("work cost");
  if (inputs.salePrice === null || inputs.salePrice <= 0) missing.push("sale price");
  if (inputs.months === null || inputs.months <= 0) missing.push("months held");
  if (inputs.financeRatePct === null) missing.push("finance rate");
  const unknowns: string[] = [];
  if (inputs.sellingCostsPct === null) unknowns.push("selling costs");
  if (inputs.legalAndSurvey === null) unknowns.push("legal and survey fees");
  if (missing.length > 0) {
    return {
      missing, unknowns, stampDuty: null, financeCost: null, sellingCosts: null, totalCost: null,
      profit: null, roiPct: null, annualisedRoiPct: null,
    };
  }
  const price = inputs.price as number;
  const refurb = inputs.refurb as number;
  const months = inputs.months as number;
  const stampDuty = calculateStampDuty({
    price, firstTimeBuyer: false, additionalProperty: inputs.additionalProperty, nonUkResident: inputs.nonUkResident,
  });
  const financeCost = ((price + refurb) * (inputs.financeRatePct as number) * months) / 100 / 12;
  const sellingCosts = ((inputs.salePrice as number) * (inputs.sellingCostsPct ?? 0)) / 100;
  const totalCost = price + stampDuty.total + refurb + (inputs.legalAndSurvey ?? 0) + financeCost;
  const profit = (inputs.salePrice as number) - sellingCosts - totalCost;
  const roiPct = (profit / totalCost) * 100;
  return { missing, unknowns, stampDuty, financeCost, sellingCosts, totalCost, profit, roiPct, annualisedRoiPct: (roiPct * 12) / months };
}
