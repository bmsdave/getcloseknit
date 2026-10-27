import { expect, test } from "./fixtures";
import { openEvidenceSection, openHelp } from "./evidence";

test("planning context opens a proposal, follows its source, and checks currency", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await openEvidenceSection(page, "Planning");

  const planning = page.getByTestId("planning-context");
  await expect(planning).toBeVisible();
  await expect(planning).toContainText("Planning Data");

  await expect(planning.getByTestId("planning-results")).toContainText("26/01024/FULL");
  await expect(planning.getByTestId("planning-withdrawn-note")).toContainText("1 withdrawn");

  await planning.getByRole("button", { name: "Open 26/01024/FULL" }).click();
  const detail = planning.getByTestId("planning-proposal-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("planned");
  await expect(detail).toContainText("awaiting decision");
  await expect(detail).toContainText("westminster-conservation-area");

  await planning.getByRole("button", { name: /Check whether this entry is current/ }).click();
  await expect(planning.getByTestId("planning-currency")).toContainText("current");

  const sourceToggle = planning.getByTestId("planning-source-toggle");
  await expect(sourceToggle).toHaveAttribute("aria-expanded", "false");
  await expect(planning.getByTestId("planning-source-detail")).toHaveCount(0);
  await sourceToggle.click();
  await expect(sourceToggle).toHaveAttribute("aria-expanded", "true");
  const source = planning.getByTestId("planning-source-detail");
  await expect(source).toBeVisible();
  await expect(source).toContainText("Ministry of Housing");
  await expect(planning.getByTestId("planning-source-link")).toHaveAttribute(
    "href", /westminster\.gov\.uk.*26\/01024\/FULL/,
  );
  await sourceToggle.click();
  await expect(planning.getByTestId("planning-source-detail")).toHaveCount(0);

  await expect(planning.getByText(/no development/i)).toHaveCount(0);
  await expect(planning.getByText(/no planning risk/i)).toHaveCount(0);
  await expect(planning.getByText(/no risk/i)).toHaveCount(0);
  await expect(await openHelp(planning, "planning records", "planning-records")).toContainText("no planning-risk score");
});

test("stale and unverified entries fail honestly, and empty searches name the covered dataset", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000002");
  await openEvidenceSection(page, "Planning");

  const planning = page.getByTestId("planning-context");
  await expect(planning.getByTestId("planning-results")).toContainText("2026/0123/P");

  await planning.getByRole("button", { name: "Open 2025/4412/P" }).click();
  await planning.getByRole("button", { name: /Check whether this entry is current/ }).click();
  await expect(planning.getByTestId("planning-currency")).toContainText("stale");

  await planning.getByRole("button", { name: "Open 2026/0455/P" }).click();
  await planning.getByRole("button", { name: /Check whether this entry is current/ }).click();
  await expect(planning.getByTestId("planning-currency")).toContainText("unverified");

  await planning.getByTestId("planning-stage").selectOption("completed");
  await expect(planning.getByTestId("planning-empty")).toContainText(
    "No records were returned in the covered dataset",
  );
  await expect(planning.getByTestId("planning-empty")).not.toContainText("no development");
});

test("a borough outside the pilot reports unknown, never absent", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await openEvidenceSection(page, "Planning");

  const planning = page.getByTestId("planning-context");
  await planning.getByTestId("planning-borough").selectOption("E09000028");

  await expect(planning.getByTestId("planning-coverage")).toContainText("outside the pilot");
  await expect(planning.getByTestId("planning-coverage")).toContainText("unknown here, not absent");
  await expect(planning.getByTestId("planning-results")).toHaveCount(0);
});

test("changing areas resets the borough override so no stale records linger", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await openEvidenceSection(page, "Planning");

  const planning = page.getByTestId("planning-context");
  await expect(planning.getByTestId("planning-borough")).toHaveValue("E09000033");
  await expect(planning.getByTestId("planning-results")).toContainText("26/01024/FULL");

  // Override to another borough: its records replace the area's own.
  await planning.getByTestId("planning-borough").selectOption("E09000007");
  await expect(planning.getByTestId("planning-results")).toContainText("2025/4412/P");
  await expect(planning.getByTestId("planning-results")).not.toContainText("26/01024/FULL");

  // Another area's page drops the override: coverage follows the new area.
  await page.goto("/area/lsoa/E01000003");
  await openEvidenceSection(page, "Planning");
  await expect(planning.getByTestId("planning-borough")).toHaveValue("E09000028");
  await expect(planning.getByTestId("planning-coverage")).toContainText("outside the pilot");
  await expect(planning.getByTestId("planning-results")).toHaveCount(0);
  await expect(planning).not.toContainText("2025/4412/P");
});

// Imports for the infographic checks below sit here, not at the top, so the
// line numbers pinned in tests/failure-classification.test.ts stay put.
import { longParagraphs } from "./text-density";

test("applications show as a stage strip above the list, with no long paragraphs", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await openEvidenceSection(page, "Planning");
  const planning = page.getByTestId("planning-context");
  await expect(planning.getByRole("img", {
    name: "Applications by stage: 1 planned, 1 approved, 1 completed, 1 withdrawn left out",
  })).toBeInViewport();
  await expect(planning.getByTestId("planning-results").getByRole("button").first()).toHaveAccessibleName("Open 26/01024/FULL");
  expect(await longParagraphs(page)).toEqual([]);

  await planning.getByTestId("planning-borough").selectOption("E09000028");
  expect(await longParagraphs(page)).toEqual([]);
});
