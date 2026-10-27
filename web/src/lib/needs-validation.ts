// Validation for "Your basics", step 1 of Find my area (UX-23). Drafts stay strings so an empty
// field never becomes a silent zero in the profile; Continue commits only through this gate.
// Wizard state is ephemeral: the profile keeps numbers. One budget ("up to"): the comfortable
// target the matcher also reads is derived from it (budgetsFor), never asked for.

export type NeedsField = "market" | "budget" | "bedrooms";

export interface NeedsError {
  field: NeedsField;
  message: string;
}

export interface NeedsDrafts {
  budget: string;
  bedrooms: string;
}

export interface NeedsInput extends NeedsDrafts {
  market: string;
}

export const MAX_BEDROOMS = 8;
/** Mirrors RENT_MONTHLY_BUDGET_CEILING in matching.ts / matching.py: rent budgets are monthly. */
const RENT_MONTHLY_CEILING = 20_000;
/** The comfortable price the matcher rewards most, as a share of the "up to" budget. */
export const COMFORTABLE_SHARE = 0.8;

export function validateNeeds(drafts: NeedsInput): NeedsError[] {
  const errors: NeedsError[] = [];
  if (drafts.market !== "buy" && drafts.market !== "rent") {
    errors.push({ field: "market", message: "Choose Buy or Rent." });
  }
  const budget = parseMoney(drafts.budget);
  if (budget === null) {
    errors.push({ field: "budget", message: drafts.market === "rent"
      ? "Enter your monthly budget, for example £2,000."
      : "Enter your budget, for example £600,000." });
  } else if (drafts.market === "rent" && budget > RENT_MONTHLY_CEILING) {
    errors.push({ field: "budget", message: "That looks like a price to buy: enter the rent a month, for example £2,000." });
  }
  if (!isSupportedBedrooms(drafts.bedrooms)) {
    errors.push({ field: "bedrooms", message: `Choose bedrooms from studio to ${MAX_BEDROOMS}.` });
  }
  return errors;
}

/** Leaving the budget field: a typed budget is checked at once; an empty one waits for Continue. */
export function validateBudgetOnBlur(market: NeedsInput["market"], budget: string): NeedsError[] {
  if (budget.trim() === "") return [];
  return validateNeeds({ market, budget, bedrooms: "2" }).filter((error) => error.field === "budget");
}

/** "£650,000", "650000", "650k" → 650000; null for empty, zero or not a number. */
export function parseMoney(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/[£,\s]/g, "");
  if (!text) return null;
  const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]) * (match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/** Digits grouped as the visitor types: "650000" → "650,000" (the £ sits outside the field). */
export function formatMoneyDraft(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  return digits ? Number(digits).toLocaleString("en-GB") : "";
}

/** The profile's two budget fields from the one "up to" budget. */
export function budgetsFor(maximum: number): { targetBudget: number; maximumBudget: number } {
  const step = maximum >= 20_000 ? 1_000 : 10;
  return { maximumBudget: maximum, targetBudget: Math.max(1, Math.round((maximum * COMFORTABLE_SHARE) / step) * step) };
}

function isSupportedBedrooms(raw: string): boolean {
  if (raw.trim() === "") return false;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= MAX_BEDROOMS;
}
