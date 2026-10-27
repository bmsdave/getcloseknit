import { expect, type Locator, type Page } from "./fixtures";

import { openMatchBuilder } from "./top-bar";

// Shared My match steps for specs that need a search (v4 Task 21c: no wizard). My match opens on its list: Budget
// (focused), Travel to, What matters. A budget typed and confirmed is enough for a ranking.

export const PROFILE_KEY = "close-knit.preference-profile.v1";
export const E2E_BUDGET = "650000";

/** My match's list (the search): in the side panel on a desktop, in its own sheet on a phone. */
export function findMyArea(page: Page): Locator {
  return page.getByTestId("match-list");
}

/**
 * Opens My match when it is not open and, with no budget yet, types one and confirms it, so the ranking shows.
 * (The name is kept from the two-step wizard, whose "What matters" step this used to reach.)
 */
export async function continueToReview(page: Page): Promise<void> {
  if (!(await findMyArea(page).isVisible())) await openMatchBuilder(page);
  const start = findMyArea(page).getByTestId("match-budget-start");
  if (await start.isVisible()) await typeBudget(page, E2E_BUDGET);
  await expect(findMyArea(page).getByTestId("areas-left")).toBeVisible();
}

/** The search set, then the ranking shown. */
export async function showAreas(page: Page): Promise<void> {
  await continueToReview(page);
  await expect(page.getByTestId("match-results")).toBeVisible();
}

/** A filled-in search saved before the page loads, so the results show instead of the three start rows. */
export async function seedSearch(page: Page, profile: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: PROFILE_KEY, value: { ...SEEDED_SEARCH, ...profile } },
  );
}

/**
 * The search the comparison specs were written against (budget £500k to £650k; budget, crime, commute
 * and schools at 3 of 5), saved before the page loads so their figures still hold.
 */
export async function seedClassicSearch(page: Page): Promise<void> {
  await seedSearch(page, CLASSIC_SEARCH);
}

export const SEEDED_SEARCH = {
  schemaVersion: "preference-profile.v1",
  market: "buy",
  targetBudget: 520000,
  maximumBudget: 650000,
  bedrooms: 2,
  forecastHorizon: "1y",
  factors: [
    { factorId: "affordability", weight: 3, direction: "target-range", minimumUtility: null, maximumUtility: null },
    { factorId: "crime", weight: 3, direction: "lower", minimumUtility: null, maximumUtility: null },
    { factorId: "station-access", weight: 0, direction: "lower", minimumUtility: null, maximumUtility: null },
  ],
  commuteDestinations: [],
  school: {
    phases: ["primary"], characteristics: [],
    facetWeights: { progress: 3, attainment: 2, attendance: 1 },
    shortlistUrns: [], desiredSchoolCount: 3,
  },
  analyticsConsent: false,
};

const factor = (factorId: string, weight: number, direction: string) =>
  ({ factorId, weight, direction, minimumUtility: null, maximumUtility: null });

export const CLASSIC_SEARCH = {
  ...SEEDED_SEARCH,
  targetBudget: 500000,
  factors: [
    factor("affordability", 3, "target-range"), factor("market-level", 0, "lower"), factor("growth-outlook", 0, "higher"),
    factor("crime", 3, "lower"), factor("commute", 3, "lower"), factor("schools", 3, "higher"), factor("station-access", 0, "lower"),
  ],
};

/** A criterion's row in the list by its id (affordability, range:crime, place:<id>, zone). */
export function matchItem(page: Page, id: string): Locator {
  return page.locator(`[data-testid="match-item"][data-id="${id}"]`);
}

/** Types a maximum budget (the start row's field, or the budget card's) and confirms it. */
export async function typeBudget(page: Page, value: string): Promise<void> {
  const start = findMyArea(page).getByTestId("match-budget-start");
  if (!(await start.isVisible())) {
    const card = page.getByTestId("match-card-affordability");
    if (!(await card.isVisible())) await matchItem(page, "affordability").getByTestId("match-chip").click();
  }
  const field = findMyArea(page).getByTestId("budget-max").first();
  const item = matchItem(page, "affordability");
  const before = (await item.count()) ? await item.textContent() : null;
  // The budget already says this (My match's starting budget, say): confirming it changes nothing to wait for.
  const pounds = (text: string) => {
    const figure = text.replace(/[£,\s]/g, "");
    return /k$/i.test(figure) ? Number(figure.slice(0, -1)) * 1_000 : Number(figure);
  };
  const same = pounds(await field.inputValue({ timeout: 1_000 }).catch(() => "")) === pounds(value);
  const taken = async () => (await item.isVisible()) && (before === null || same || (await item.textContent()) !== before);
  // Retried: a field filled before hydration is reset by it (the server-rendered input takes no React change).
  await expect(async () => {
    // A budget the list took on a try that timed out: the start row's field has gone with it.
    if (!(await taken())) {
      await field.fill(value, { timeout: 5_000 });
      // The field also takes the budget by itself after a 900 ms pause, and the start row's field goes: the key
      // goes to the page, not to a field that may no longer be there.
      await page.keyboard.press("Enter");
    }
    await expect(item).toBeVisible({ timeout: 1_000 });
    if (before !== null && !same) await expect(item).not.toHaveText(before, { timeout: 1_000 });
  }).toPass();
}

/** Travel to: a station or address picked from the search (35 min by transit by default). */
export async function addTravel(page: Page, query: string, option: RegExp): Promise<void> {
  const another = findMyArea(page).getByTestId("travel-another");
  if (await another.isVisible()) await another.click();
  await findMyArea(page).getByTestId("travel-to").fill(query);
  await findMyArea(page).getByTestId("travel-options").getByRole("button", { name: option }).click();
}

/** Opens "What matters › Any layer…" (every Layers item as a criterion), where the old wizard had "More options". */
export async function openMoreOptions(page: Page): Promise<void> {
  const button = findMyArea(page).getByTestId("chip-any-layer");
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(findMyArea(page).getByTestId("any-layer-menu")).toBeVisible();
}

/** Adds a "What matters" chip (safer-streets, good-schools, quiet-streets, parks-nearby …). */
export async function addChip(page: Page, chip: string): Promise<void> {
  await findMyArea(page).getByTestId(`chip-${chip}`).click();
}
