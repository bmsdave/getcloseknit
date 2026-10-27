import { expect, test } from "./fixtures";

import { encodeBrief } from "../src/lib/brief-model";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { encodeSharedShortlist, type SavedShortlist } from "../src/lib/saved-shortlists";

// /brief (review #10, C1/C7): no fragment explains what a brief is and starts Find my area; an
// agent's #brief= link lands on My match grouped by budget, like the match panel; a saved
// shortlist's #shortlist= link shows its decision brief straight away.

test("/brief on its own explains the brief and starts Find my area, never an error", async ({ page }) => {
  const response = await page.goto("/brief");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your decision brief");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByTestId("brief-explainer")).toBeVisible();
  await expect(page.getByText(/incomplete/i)).toHaveCount(0);
  const start = page.getByRole("link", { name: "Start Find my area" });
  await expect(start).toHaveAttribute("href", "/?layer=personal-match");
  await start.click();
  // The map compiles on first use in dev: allow it the time a cold start takes.
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "personal-match", { timeout: 30_000 });
});

test("an agent's brief link lands on My match with its budget and criteria, and the ten", async ({ page }) => {
  const fragment = encodeBrief({
    areas: ["uk:lsoa:E01000002", "uk:lsoa:E01000003"], budget: [400000, 450000], market: "buy", bedrooms: 2,
    propertyType: "any", criteria: ["price", "safety"], destinations: [],
  });
  await page.goto(`/brief${fragment}`);
  await expect(page).toHaveURL(/layer=personal-match/, { timeout: 30_000 });
  // v4 Task 21c/21d: one list in priority order (the budget and what matters), then the ten by score.
  await expect(page.locator('[data-testid="match-item"][data-id="affordability"]')).toContainText("Budget ≤", { timeout: 20_000 });
  await expect(page.locator('[data-testid="match-item"][data-id="range:crime"]')).toBeAttached();
  await expect(page.getByTestId("match-results")).toBeAttached();
});

test("a saved shortlist's link shows its decision brief straight away", async ({ page }) => {
  const shortlist: SavedShortlist = {
    schemaVersion: "saved-shortlist.v1", id: "s1", name: "Test move", createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z", candidates: ["uk:lsoa:E01000002", "uk:lsoa:E01000003"], candidateNames: {},
    profile: { ...structuredClone(DEFAULT_PROFILE), maximumBudget: 600000 }, mode: "demo", release: "demo-fixture-pack", evidence: [],
  };
  // A link whose sender ticked the budget (v4 Task 38 leaves it out by default), opened on another device:
  // the Shared brief (v4.4), named by its areas, with "the" limit rather than "your".
  await page.goto(`/brief${encodeSharedShortlist(shortlist, { includeBudget: true })}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("North London preview vs South Bank preview");
  await expect(page.getByTestId("brief-header")).toContainText("Shared brief · Test move");
  const preview = page.getByTestId("decision-brief-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId("brief-verdict")).toHaveCount(2);
  await expect(preview.getByTestId("brief-verdict").first()).toContainText(/the £600k limit/);
  await expect(page.getByRole("button", { name: "Preview decision brief" })).toHaveCount(0);
});

test("a broken shortlist link says so plainly and offers the way in", async ({ page }) => {
  await page.goto("/brief#shortlist=v1.broken");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This shortlist link can't be read.");
  await expect(page.getByRole("link", { name: "Start Find my area" })).toBeVisible();
});
