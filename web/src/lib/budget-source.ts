/**
 * Where the search's budget came from (CUJ06 / CUJ11): a tool's "Areas this buys in →" price is the budget
 * as the household saw it in the tool, so its chip reads "Budget ≤ £500k · from Tools" until the budget is changed.
 * The criterion itself stays the contract's (`{ kind: "budget", must }`, api match_model.FIELDS): the source is kept
 * on this device for this visit only, matched on the budget it set.
 */

const KEY = "close-knit.budget-from-tools";

interface Carried { target: number; maximum: number }

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Remember that a tool set this budget. */
export function markToolBudget(target: number, maximum: number): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ target, maximum } satisfies Carried));
  } catch {
    // Storage full or blocked: the chip reads as a typed budget.
  }
}

/** True while the profile's budget is still the one a tool carried in. */
export function budgetFromTools(profile: { targetBudget: number; maximumBudget: number }): boolean {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return false;
    const carried = JSON.parse(raw) as Partial<Carried>;
    return carried.target === profile.targetBudget && carried.maximum === profile.maximumBudget;
  } catch {
    return false;
  }
}
