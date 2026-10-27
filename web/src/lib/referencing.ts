// Wave 1 / feature 4: a renter's referencing check. Letting agents commonly
// ask for gross annual income of about 30 times the monthly rent, and about
// 36 times from a guarantor. The rule is widespread but not measured, and
// each agent sets its own threshold: this is a self-check, never a
// referencing decision.
import type { PreferenceProfile } from "./contracts";
import { statutoryVersionFor, type StatutoryVersion } from "./housing-cost";
import { RENT_MONTHLY_BUDGET_CEILING } from "./matching";
import { type Sourced, sourceLabel } from "./sourced";

/** Yearly income as a multiple of the monthly rent: a typical agent rule (research 2026-10 §3), not law. */
export const REFERENCING_RULE: Sourced<{ tenant: number; guarantor: number }> = {
  value: { tenant: 30, guarantor: 36 },
  kind: "practice",
  source: "Close Knit research",
  asOf: "2026-10",
};
export const TENANT_INCOME_MULTIPLE = REFERENCING_RULE.value.tenant;
export const GUARANTOR_INCOME_MULTIPLE = REFERENCING_RULE.value.guarantor;

export const REFERENCING_DISCLAIMER =
  `A self-check against a common agent rule of thumb (about ${TENANT_INCOME_MULTIPLE}× the monthly rent, or ` +
  `${GUARANTOR_INCOME_MULTIPLE}× for a guarantor): a ${sourceLabel(REFERENCING_RULE)}. ` +
  "Agents and landlords set their own thresholds; this is not a referencing decision.";

export const RENTERS_RIGHTS_SOURCE_URL = "https://www.london.gov.uk/renters-rights";

export const RENTERS_RIGHTS_EXPLAINER = [
  "Since 1 May 2026 (Renters' Rights Act) rent must be advertised as one figure, and landlords and agents " +
    "may not ask for or accept offers above it.",
  "No rent can be taken before the tenancy is agreed; between signing and moving in, at most one month's " +
    "rent can be asked for in advance.",
  "Paying several months up front can no longer make up an income shortfall, and older advice about " +
    "bidding above the asking rent is out of date.",
];

export const NO_UK_CREDIT_HISTORY_NOTES = [
  "Without a UK credit history, referencing may not be able to score you on income alone.",
  `A UK-based guarantor, usually checked against about ${GUARANTOR_INCOME_MULTIPLE}× the monthly rent, can stand behind the tenancy.`,
  "Rent guarantor services act as a paid guarantor for renters who have none; ask the agent whether they accept one.",
  "A letter from your employer confirming salary and start date helps when payslips are not yet available.",
];

export interface ReferencingInput {
  monthlyRent: number | null;
  incomes: Array<number | null>;
  guarantorIncome: number | null;
  noUkCreditHistory: boolean;
}

export interface ReferencingResult {
  requiredIncome: number | null;
  householdIncome: number;
  shortfall: number | null;
  meetsIncome: boolean | null;
  requiredGuarantorIncome: number | null;
  guarantorMeets: boolean | null;
  notes: string[];
  statutory: StatutoryVersion | null;
}

export function requiredAnnualIncome(monthlyRent: number, multiple: number = TENANT_INCOME_MULTIPLE): number {
  if (!(monthlyRent > 0)) throw new Error("monthly rent must be positive");
  return monthlyRent * multiple;
}

export function householdIncome(incomes: Array<number | null>): number {
  return incomes.reduce<number>((total, income) => total + (income !== null && income > 0 ? income : 0), 0);
}

// The rent target only seeds the check when it reads as a monthly figure;
// an annual-scale or empty budget leaves the rent for the user to enter.
export function defaultMonthlyRent(profile: PreferenceProfile): number | null {
  if (profile.market !== "rent") return null;
  const target = profile.targetBudget;
  return target > 0 && target <= RENT_MONTHLY_BUDGET_CEILING ? target : null;
}

export function assessReferencing(
  input: ReferencingInput,
  onDate: string = new Date().toISOString().slice(0, 10),
): ReferencingResult {
  const income = householdIncome(input.incomes);
  const rent = input.monthlyRent !== null && input.monthlyRent > 0 ? input.monthlyRent : null;
  const required = rent === null ? null : requiredAnnualIncome(rent);
  const requiredGuarantor = rent === null ? null : requiredAnnualIncome(rent, GUARANTOR_INCOME_MULTIPLE);
  const guarantor = input.guarantorIncome !== null && input.guarantorIncome > 0 ? input.guarantorIncome : null;
  return {
    requiredIncome: required,
    householdIncome: income,
    shortfall: required === null ? null : Math.max(0, required - income),
    meetsIncome: required === null ? null : income >= required,
    requiredGuarantorIncome: requiredGuarantor,
    guarantorMeets: requiredGuarantor === null || guarantor === null ? null : guarantor >= requiredGuarantor,
    notes: input.noUkCreditHistory ? NO_UK_CREDIT_HISTORY_NOTES : [],
    statutory: statutoryVersionFor("renters-rights-act", "england", onDate),
  };
}
