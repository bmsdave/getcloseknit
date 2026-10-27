import { expect, test, type Locator } from "./fixtures";
import { openMatchBuilder } from "./top-bar";
import { continueToReview, openMoreOptions } from "./wizard";

// UX-31: onboarding carries no total-cost inputs. The worksheet calculation
// module stays unit-covered (housing-cost.test.ts) for property diligence.
// UX-32: onboarding asks no property-specific lease questions. The leasehold
// model stays unit-covered (leasehold.test.ts) for property diligence.
const COST_LABELS = [
  "Price (£)",
  "Deposit (£)",
  "Interest rate (%/year)",
  "Term (years)",
  "Service charge (£/month)",
  // Ground rent (£/year) lives in the leasehold checklist — UX-32 scope.
  "Maintenance (£/month)",
  "Council tax (£/month)",
  "Utilities (£/month)",
  "Moving costs (£ one-off)",
  "Monthly rent (£/month)",
  "Rental upfront (£ one-off)",
];

const LEASE_LABELS = [
  "Recorded transaction tenure",
  "Lease expiry date",
  "Lease expiry as of",
  "Service charge (£/year)",
  "Ground rent (£/year)",
  "Major works notice",
  "New diligence question",
];

async function expectNoCostInputs(dialog: Locator) {
  for (const label of COST_LABELS) {
    await expect(dialog.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  await expect(dialog.getByTestId("cost-monthly-total")).toHaveCount(0);
  await expect(dialog.getByTestId("cost-remaining-budget")).toHaveCount(0);
}

async function expectNoLeaseInputs(dialog: Locator) {
  for (const label of LEASE_LABELS) {
    await expect(dialog.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  await expect(dialog.getByTestId("diligence-brief")).toHaveCount(0);
}

test("wizard exposes no total-cost inputs in either tenure or any stage", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  const dialog = page.getByTestId("match-list");

  for (const market of ["Buy", "Rent"] as const) {
    await dialog.getByRole("group", { name: "Buy or rent" }).getByRole("button", { name: market }).click();
    await expectNoCostInputs(dialog);
  }

  await dialog.getByRole("group", { name: "Buy or rent" }).getByRole("button", { name: "Buy" }).click();
  await continueToReview(page);
  await openMoreOptions(page);
  await expectNoCostInputs(dialog);
});

test("wizard asks no property-specific lease questions", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  const dialog = page.getByTestId("match-list");
  await expectNoLeaseInputs(dialog);

  await continueToReview(page);
  await openMoreOptions(page);
  await expectNoLeaseInputs(dialog);
});
