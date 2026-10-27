import { expect, test } from "./fixtures";

import type { PreferenceProfile } from "../src/lib/contracts";
import { encodeSharedProfile } from "../src/lib/profile-state";
import { PROFILE_KEY, SEEDED_SEARCH } from "./wizard";

// v4 Task 22: a #profile= link that cannot be read in full opens what it can, with a toast; never a blank panel.

function base64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

test("a partly broken link opens what it can and says how much was skipped", async ({ page }) => {
  const shared = { ...SEEDED_SEARCH, targetBudget: 480000, maximumBudget: 600000 } as unknown as PreferenceProfile;
  const packed = JSON.parse(Buffer.from(encodeSharedProfile(shared).slice("#profile=v1.".length), "base64url").toString("utf8")) as unknown[];
  (packed[5] as unknown[]).push([99, 3, 0, null, null], "nonsense"); // two factors no one can read
  await page.goto(`/?layer=personal-match#profile=v1.${base64(packed)}`);
  await expect(page.getByTestId("map-toast-text")).toHaveText("Part of this link couldn't be opened · 2 criteria skipped");
  // What parsed is on screen: the sender's budget.
  await expect(page.getByTestId("match-ranking").getByTestId("shared-banner")).toContainText("Buy up to £600k");
  expect(await page.evaluate((key) => window.localStorage.getItem(key), PROFILE_KEY)).toBeNull();
});

test("an unreadable link says so and opens a usable My match, not a blank panel", async ({ page }) => {
  const full = encodeSharedProfile(SEEDED_SEARCH as unknown as PreferenceProfile);
  for (const fragment of [full.slice(0, full.length - 25), "#profile=v1.@@not-a-link@@"]) {
    await page.goto("about:blank"); // a new hash on the same page would not load it again
    await page.goto(`/?layer=personal-match${fragment}`);
    await expect(page.getByTestId("map-toast-text")).toHaveText("This link couldn't be opened · Start fresh");
    await expect(page.getByTestId("shared-banner")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /My match/ }).first()).toBeVisible();
    // v4 Task 22.4: nothing of the household's own yet, so My match shows its three start rows (21c).
    await expect(page.getByTestId("match-budget-start")).toBeVisible();
    await expect(page.getByTestId("match-travel")).toBeVisible();
    await expect(page.getByTestId("what-matters")).toBeVisible();
  }
});
