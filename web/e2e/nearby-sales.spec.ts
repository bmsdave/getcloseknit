import { expect, test } from "./fixtures";
import { openEvidenceSection } from "./evidence";

// Wave 1 / feature 3: other homes' sales in the building and on the street —
// prices without a per-sale floor area; the median £/m² only from 5 sales.
test("an address shows nearby sales without per-sale floor area", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("Sample Street");
  await page.getByRole("option", { name: /10 Sample Street/ }).click();
  await openEvidenceSection(page, "Homes sold nearby");

  const nearby = page.getByTestId("nearby-sales");
  await expect(nearby.getByTestId("nearby-building")).toContainText("610,000");
  await expect(nearby.getByTestId("nearby-building-median")).toContainText("not shown");
  await expect(nearby.getByTestId("nearby-street-median")).toContainText("£10,500/m²");
  await expect(nearby).not.toContainText("Floor area");
});

// The long leasehold form became a short note plus the agent questions; the
// lease band, service charge share and building-safety rules stay unit-tested
// (tests/leasehold.test.ts).
test("leasehold context: a short note and the lease questions to ask the agent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("Sample Street");
  await page.getByRole("option", { name: /10 Sample Street/ }).click();
  const panel = await openEvidenceSection(page, "Plan & check");
  await expect(panel.getByTestId("leasehold-note")).toContainText("independent solicitor or conveyancer");
  await expect(panel.getByTestId("leasehold-note").getByRole("link", { name: /GOV\.UK/ })).toHaveAttribute("href", /gov\.uk/);
  const questions = panel.getByTestId("viewing-checklist");
  await expect(questions).toContainText("years are left on the lease");
  await expect(questions).toContainText("major works");
  await expect(panel.getByLabel("Lease expiry date", { exact: true })).toHaveCount(0);
});
