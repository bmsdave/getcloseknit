import { expect, test, type Page } from "./fixtures";
import { continueToReview, seedClassicSearch } from "./wizard";
import { openMatchBuilder } from "./top-bar";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

async function openMatches(page: Page) {
  await seedClassicSearch(page);
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  await expect(page.getByTestId("match-ranking")).toContainText("match");
}

// UX-53: exports and saved items contain the same finalists visible in
// comparison — shortlist saving and brief generation stay aligned with the
// compared areas, current profile, mode, and release.
test("shortlist and brief contain the compared finalists", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openMatches(page);
  await page.getByRole("checkbox", { name: "Compare North London preview" }).click();
  await page.getByRole("checkbox", { name: "Compare South Bank preview" }).click();
  const tray = page.getByTestId("comparison-tray");
  await expect(tray).toContainText("2 of 4 selected");

  // The tray names both finalists; its Compare opens /compare with them (v3 Fix 22: no dialog).
  await tray.locator(".tray-areas > summary").click();
  for (const name of ["North London preview", "South Bank preview"]) {
    await expect(tray.getByTestId("comparison-chip").filter({ hasText: name })).toHaveCount(1);
  }
  await tray.locator(".tray-areas > summary").click();
  await expect(tray.getByRole("link", { name: "Compare areas" })).toHaveAttribute("href", /^\/compare\?kind=places&ids=/);

  // The brief previews the same finalists on the current release (behind "Saved areas & costs").
  await page.getByTestId("saved-areas-costs").locator(":scope > summary").click();
  await page.getByRole("button", { name: "Preview decision brief" }).click();
  const preview = page.getByTestId("decision-brief-preview");
  await expect(preview).toContainText("North London preview");
  await expect(preview).toContainText("South Bank preview");
  await expect(preview.getByTestId("brief-release")).toContainText("Release preview-open-data-2026-09");

  // Saving keeps the same finalists with mode and release.
  await page.getByLabel("Shortlist name").fill("UX-53 finalists");
  await page.getByRole("button", { name: /Save shortlist \(2 compared\)/ }).click();
  const saved = page.getByTestId("saved-shortlists");
  await expect(saved).toContainText("UX-53 finalists");
  // G38: the row reads "2 areas · Saved …"; the finalists themselves are in the stored shortlist.
  await expect(saved.getByTestId("shortlist-row").first()).toContainText("2 areas · Saved");
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("close-knit.saved-shortlists.v1") ?? "[]"));
  expect(Object.values(stored[0].candidateNames)).toEqual(["North London preview", "South Bank preview"]);
  // The release id is kept, behind the row's Details (the row itself reads in plain words).
  await expect(saved).not.toContainText("preview-2026-09");

  // Removing one finalist realigns the next save with the tray.
  await tray.locator(".tray-areas > summary").click();
  await tray.getByTestId("comparison-chip").nth(0).getByRole("button").click();
  await expect(tray).toContainText("1 of 4 selected");
  await page.getByLabel("Shortlist name").fill("UX-53 single");
  await page.getByRole("button", { name: /Save shortlist \(1 compared\)/ }).click();
  await expect(saved).toContainText("UX-53 single");
  const single = await page.evaluate(() => JSON.parse(window.localStorage.getItem("close-knit.saved-shortlists.v1") ?? "[]"));
  const entry = single.find((shortlist: { name: string }) => shortlist.name === "UX-53 single");
  expect(entry.candidates).toHaveLength(1);
  await expect(saved.getByTestId("shortlist-row").first()).toContainText("1 area · Saved");
});
