import { expect, test } from "./fixtures";
import { openMatchBuilder } from "./top-bar";
import { continueToReview } from "./wizard";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

// My match › "Schools you would consider" (under the ten) holds the pilot.
test("admissions pilot: switch school and year, open guidance, record a question", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  await page.getByTestId("refine-schools").locator("summary").click();

  const pilot = page.getByTestId("admissions-pilot");
  await expect(pilot).toBeVisible();

  await expect(pilot.getByTestId("admission-cutoff")).toContainText("2025/26");
  await expect(pilot.getByTestId("admission-cutoff")).toContainText("850 m");

  await pilot.getByLabel("Admission year").selectOption("2023/24");
  await expect(pilot.getByTestId("admission-cutoff")).toContainText("920 m");
  await expect(pilot.getByTestId("admission-cutoff")).not.toContainText("850 m");

  await pilot.getByLabel("Admission school").selectOption("100002");
  await expect(pilot.getByTestId("admission-cutoff")).toContainText("2025/26 not published");
  await pilot.getByLabel("Admission year").selectOption("2024/25");
  await expect(pilot.getByTestId("admission-cutoff")).toContainText("sibling");
  await expect(pilot.getByTestId("admission-cutoff")).toContainText("2,100 m");

  await pilot.getByRole("button", { name: "Show authority guidance" }).click();
  const guidance = pilot.getByTestId("authority-guidance");
  await expect(guidance).toBeVisible();
  await expect(guidance).toContainText("Sibling priority");
  await expect(guidance.getByRole("link", { name: /Authority guidance/ }))
    .toHaveAttribute("href", "https://www.camden.gov.uk/school-admissions");

  await expect(pilot).toContainText("A home distance alone is insufficient");
  await expect(pilot.getByText(/guaranteed/i)).toHaveCount(0);
  await expect(pilot).toContainText("inside the admissions pilot");

  await pilot.getByLabel("New admissions question").fill("What counts as sibling priority?");
  await pilot.getByRole("button", { name: "Add admissions question" }).click();
  await expect(pilot).toContainText("What counts as sibling priority?");
  await expect(pilot).toContainText("No child details are collected");
  await pilot.getByLabel("Mark admissions question 1 answered").check();
  await expect(pilot).toContainText("(answered)");
});
