// AE-19: optional total-housing-cost worksheet. A comparison tool over
// profile/area inputs — not mortgage advice or a lending decision.
import type { PreferenceProfile } from "./contracts";

// "assumed": a labelled default the household has not confirmed (e.g. the London average service charge).
export type CostProvenance = "official" | "entered" | "estimated" | "assumed" | "unknown";
export type WorksheetTenure = "buy" | "rent";
export type CostCadence = "monthly" | "annual" | "one-off";

export interface CostAssumptions {
  price: number | null;
  deposit: number | null;
  annualInterestRatePct: number | null;
  termYears: number | null;
  monthlyRent: number | null;
  serviceChargeMonthly: number | null;
  groundRentAnnual: number | null;
  maintenanceMonthly: number | null;
  councilTaxMonthly: number | null;
  utilitiesMonthly: number | null;
  movingCosts: number | null;
  rentalUpfront: number | null;
}

export const EMPTY_ASSUMPTIONS: CostAssumptions = {
  price: null,
  deposit: null,
  annualInterestRatePct: null,
  termYears: null,
  monthlyRent: null,
  serviceChargeMonthly: null,
  groundRentAnnual: null,
  maintenanceMonthly: null,
  councilTaxMonthly: null,
  utilitiesMonthly: null,
  movingCosts: null,
  rentalUpfront: null,
};

export interface CostLine {
  id: string;
  label: string;
  cadence: CostCadence;
  monthlyAmount: number | null;
  oneOffAmount: number | null;
  provenance: CostProvenance;
}

export interface StatutoryVersion {
  instrument: string;
  jurisdiction: string;
  effectiveDate: string;
  detail: string;
}

export const STATUTORY_VERSIONS: StatutoryVersion[] = [
  {
    instrument: "sdlt-residential-nil-rate",
    jurisdiction: "england",
    effectiveDate: "2022-09-23",
    detail: "nil-rate threshold £250,000",
  },
  {
    instrument: "sdlt-residential-nil-rate",
    jurisdiction: "england",
    effectiveDate: "2025-04-01",
    detail: "nil-rate threshold £125,000",
  },
  {
    instrument: "tenant-fees-act",
    jurisdiction: "england",
    effectiveDate: "2019-06-01",
    detail: "upfront letting fees banned; deposits capped",
  },
  {
    instrument: "sdlt-non-resident-surcharge",
    jurisdiction: "england",
    effectiveDate: "2021-04-01",
    detail: "+2 percentage points on each band for buyers who are not UK resident",
  },
  {
    instrument: "sdlt-additional-dwelling-surcharge",
    jurisdiction: "england",
    effectiveDate: "2024-10-31",
    detail: "5% surcharge when buying an additional home",
  },
  {
    instrument: "renters-rights-act",
    jurisdiction: "england",
    effectiveDate: "2026-05-01",
    detail: "no accepting offers above the advertised rent; at most one month's rent in advance",
  },
];

export const COMPARISON_DISCLAIMER =
  "A comparison tool for weighing housing scenarios side by side. " +
  "It is not mortgage advice, a lending decision, or a promise of investment returns.";

export interface WorksheetResult {
  tenure: WorksheetTenure;
  lines: CostLine[];
  missing: string[];
  unknowns: string[];
  monthlyTotal: number;
  annualOngoingTotal: number;
  oneOffTotal: number;
  firstYearTotal: number;
  upfrontTotal: number | null;
  statutory: StatutoryVersion | null;
}

export interface BudgetComparison {
  kind: "monthly" | "upfront";
  reference: number;
  total: number | null;
  remaining: number | null;
  overBudget: boolean;
}

export function monthlyMortgagePayment(principal: number, annualRatePct: number, termYears: number): number {
  if (!(principal > 0)) throw new Error("loan principal must be positive");
  if (!(termYears > 0)) throw new Error("loan term must be positive");
  if (!(annualRatePct >= 0)) throw new Error("interest rate cannot be negative");
  const months = Math.round(termYears * 12);
  if (annualRatePct === 0) return principal / months;
  const rate = annualRatePct / 100 / 12;
  return (principal * rate) / (1 - (1 + rate) ** -months);
}

export function statutoryVersionFor(
  instrument: string,
  jurisdiction: string,
  onDate: string,
): StatutoryVersion | null {
  const applicable = STATUTORY_VERSIONS.filter((version) =>
    version.instrument === instrument
    && version.jurisdiction === jurisdiction
    && version.effectiveDate <= onDate);
  applicable.sort((left, right) => (left.effectiveDate < right.effectiveDate ? 1 : -1));
  return applicable[0] ?? null;
}

export function buildCostWorksheet(
  tenure: WorksheetTenure,
  assumptions: CostAssumptions,
  onDate: string = new Date().toISOString().slice(0, 10),
): WorksheetResult {
  const missing: string[] = [];
  const lines: CostLine[] =
    tenure === "buy" ? buyLines(assumptions, missing) : rentLines(assumptions, missing);
  const monthlyTotal = sumMonthly(lines);
  const oneOffTotal = sumOneOff(lines);
  return {
    tenure,
    lines,
    missing,
    unknowns: lines.filter((line) => isUnknown(line)).map((line) => line.label),
    monthlyTotal,
    annualOngoingTotal: monthlyTotal * 12,
    oneOffTotal,
    firstYearTotal: monthlyTotal * 12 + oneOffTotal,
    upfrontTotal: upfrontKnown(tenure, assumptions, oneOffTotal),
    statutory: statutoryVersionFor(
      tenure === "buy" ? "sdlt-residential-nil-rate" : "tenant-fees-act", "england", onDate),
  };
}

/** "£708,000" for a money input; empty when there is no figure. */
export function moneyInputText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : `£${Math.round(value).toLocaleString("en-GB")}`;
}

/** Reads "£708,000", "708k" or "708000" back as pounds; null when empty or not a number. */
export function parseMoneyInput(text: string): number | null {
  const clean = text.replace(/[£,\s]/g, "").toLowerCase();
  if (clean === "") return null;
  const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(clean);
  if (!match) return null;
  const scale = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  return Math.round(Number(match[1]) * scale);
}

/**
 * One plain line against the household's budget: a buyer's price against
 * their maximum ("£58k over your £650k max"), a renter's monthly total
 * against their monthly budget ("£120 a month under your £2,000 budget").
 * Null until there is a figure to compare.
 */
export function budgetSentence(profile: PreferenceProfile, tenure: WorksheetTenure, assumptions: CostAssumptions, monthlyTotal: number): { text: string; over: boolean } | null {
  const short = (value: number) => value >= 10_000
    ? (value >= 1_000_000 ? `£${Number((value / 1_000_000).toFixed(2))}m` : `£${Math.round(value / 1000)}k`)
    : `£${Math.round(value).toLocaleString("en-GB")}`;
  if (tenure === "buy") {
    if (assumptions.price === null) return null;
    const gap = assumptions.price - profile.maximumBudget;
    if (Math.abs(gap) < 500) return { text: `At your ${short(profile.maximumBudget)} max`, over: false };
    return { text: `${short(Math.abs(gap))} ${gap > 0 ? "over" : "under"} your ${short(profile.maximumBudget)} max`, over: gap > 0 };
  }
  if (monthlyTotal <= 0) return null;
  const gap = monthlyTotal - profile.targetBudget;
  if (Math.abs(gap) < 1) return { text: `At your ${short(profile.targetBudget)} a month budget`, over: false };
  return { text: `${short(Math.abs(gap))} a month ${gap > 0 ? "over" : "under"} your ${short(profile.targetBudget)} budget`, over: gap > 0 };
}

export function compareToBudget(profile: PreferenceProfile, result: WorksheetResult): BudgetComparison {
  if (result.tenure === "rent") return monthlyComparison(profile.targetBudget, result.monthlyTotal);
  return upfrontComparison(profile.maximumBudget, result.upfrontTotal);
}

function monthlyComparison(reference: number, total: number): BudgetComparison {
  return { kind: "monthly", reference, total, remaining: reference - total, overBudget: total > reference };
}

function upfrontComparison(reference: number, total: number | null): BudgetComparison {
  if (total === null) return { kind: "upfront", reference, total, remaining: null, overBudget: false };
  return {
    kind: "upfront", reference, total,
    remaining: reference - total, overBudget: total > reference,
  };
}

function buyLines(assumptions: CostAssumptions, missing: string[]): CostLine[] {
  return [
    mortgageLine(assumptions, missing),
    monthlyLine("service-charge", "Service charge", assumptions.serviceChargeMonthly),
    annualLine("ground-rent", "Ground rent", assumptions.groundRentAnnual),
    monthlyLine("maintenance", "Maintenance allowance", assumptions.maintenanceMonthly),
    monthlyLine("council-tax", "Council tax", assumptions.councilTaxMonthly),
    monthlyLine("utilities", "Utilities", assumptions.utilitiesMonthly),
    oneOffLine("moving-costs", "Moving costs", assumptions.movingCosts),
  ];
}

function rentLines(assumptions: CostAssumptions, missing: string[]): CostLine[] {
  if (assumptions.monthlyRent === null) missing.push("monthly rent");
  return [
    monthlyLine("monthly-rent", "Monthly rent", assumptions.monthlyRent),
    monthlyLine("maintenance", "Maintenance allowance", assumptions.maintenanceMonthly),
    monthlyLine("council-tax", "Council tax", assumptions.councilTaxMonthly),
    monthlyLine("utilities", "Utilities", assumptions.utilitiesMonthly),
    oneOffLine("moving-costs", "Moving costs", assumptions.movingCosts),
    oneOffLine("rental-upfront", "Rental upfront costs", assumptions.rentalUpfront),
  ];
}

function mortgageLine(assumptions: CostAssumptions, missing: string[]): CostLine {
  const { price, deposit, annualInterestRatePct, termYears } = assumptions;
  if (price === null) missing.push("price");
  if (deposit === null) missing.push("deposit");
  if (annualInterestRatePct === null) missing.push("interest rate");
  if (termYears === null) missing.push("term");
  const ready = price !== null && deposit !== null
    && annualInterestRatePct !== null && termYears !== null;
  if (!ready) return unknownLine("mortgage", "Mortgage payment", "monthly");
  const principal = price - deposit;
  if (principal <= 0) {
    return { id: "mortgage", label: "Mortgage payment", cadence: "monthly", monthlyAmount: 0, oneOffAmount: null, provenance: "estimated" };
  }
  return {
    id: "mortgage", label: "Mortgage payment", cadence: "monthly",
    monthlyAmount: monthlyMortgagePayment(principal, annualInterestRatePct, termYears),
    oneOffAmount: null, provenance: "estimated",
  };
}

function monthlyLine(id: string, label: string, value: number | null): CostLine {
  if (value === null) return unknownLine(id, label, "monthly");
  return { id, label, cadence: "monthly", monthlyAmount: value, oneOffAmount: null, provenance: "entered" };
}

function annualLine(id: string, label: string, value: number | null): CostLine {
  if (value === null) return unknownLine(id, label, "annual");
  return { id, label, cadence: "annual", monthlyAmount: value / 12, oneOffAmount: null, provenance: "entered" };
}

function oneOffLine(id: string, label: string, value: number | null): CostLine {
  if (value === null) return unknownLine(id, label, "one-off");
  return { id, label, cadence: "one-off", monthlyAmount: null, oneOffAmount: value, provenance: "entered" };
}

function unknownLine(id: string, label: string, cadence: CostCadence): CostLine {
  return { id, label, cadence, monthlyAmount: null, oneOffAmount: null, provenance: "unknown" };
}

function isUnknown(line: CostLine): boolean {
  return line.monthlyAmount === null && line.oneOffAmount === null;
}

function sumMonthly(lines: CostLine[]): number {
  return lines.reduce((total, line) => total + (line.monthlyAmount ?? 0), 0);
}

function sumOneOff(lines: CostLine[]): number {
  return lines.reduce((total, line) => total + (line.oneOffAmount ?? 0), 0);
}

function upfrontKnown(tenure: WorksheetTenure, assumptions: CostAssumptions, oneOffTotal: number): number | null {
  if (tenure !== "buy" || assumptions.price === null) return null;
  return assumptions.price + oneOffTotal;
}
