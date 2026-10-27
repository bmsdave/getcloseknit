import { expect, test } from "./fixtures";

// C8: a ranking list says what it shows in one sentence, draws each figure as a satin bar with the figure
// as text, and offers next steps: Add to compare on each row and Compare the top 3.

test("a ranking leads with a one-sentence takeaway and a bar beside each figure", async ({ page }) => {
  await page.goto("/rankings/most-expensive");
  const takeaway = page.getByTestId("ranking-takeaway");
  await expect(takeaway).toHaveText(/^.+ comes first, at £[\d,]+ per m²; .+ is \d+(st|nd|rd|th), at £[\d,]+ per m²\.$/);
  const rows = page.getByTestId("ranking-table").locator("tbody tr");
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  await expect(page.getByTestId("ranking-table").locator(".satin-value-bar svg[aria-hidden='true']")).toHaveCount(count);
  // Colour is never the only cue: each bar has its figure as text beside it.
  await expect(rows.first().locator(".satin-value-bar__value")).toHaveText(/£[\d,]+ per m²/);
  // The first figure's bar is the longest.
  const widths = await rows.locator(".satin-value-bar .satin rect").evaluateAll((rects) =>
    rects.filter((_, index) => index % 3 === 0).map((rect) => Number(rect.getAttribute("width"))));
  expect(widths[0]).toBe(Math.max(...widths));
});

test("Add to compare and Compare the top 3 use the map's comparison", async ({ page }) => {
  await page.goto("/rankings/most-expensive");
  const add = page.getByTestId("ranking-add-to-compare").first();
  await expect(add).toHaveAttribute("aria-pressed", "false");
  await add.click();
  await expect(add).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ranking-status")).toContainText("to compare (1 of 4)");
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("close-knit.compare.v1") ?? "[]"));
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatch(/^uk:lsoa:E01\d{6}$/); // comparison works on neighbourhoods
  await page.getByTestId("ranking-compare-top").click();
  await expect(page.getByTestId("ranking-status")).toContainText(/The top \d are in compare\./);
  await expect(page.locator("[data-testid='ranking-add-to-compare'][aria-pressed='true']")).toHaveCount(3);
  // Open compare is /compare (v3 Fix 22); Like this lives on each area, not on a ranking.
  await expect(page.getByTestId("ranking-open-compare")).toHaveAttribute("href", /^\/compare\?kind=places&ids=/);
  await expect(page.getByTestId("ranking-find-like")).toHaveCount(0);
});

// r3 #26 (CUJ05 step 3): In my budget beside Compare the top 3: My match with the household's own budget.
test("In my budget opens My match with the saved budget", async ({ page }) => {
  await page.goto("/rankings/most-expensive");
  await expect(page.getByTestId("ranking-in-budget")).toHaveAttribute("href", "/?find=budget");
});

// r3 #37 (CUJ04 step 2): a school ranking has On map too: the map's school dots of its phase.
test("a school ranking's On map opens the school dots of its phase", async ({ page }) => {
  await page.goto("/rankings/top-secondary-progress-8");
  await expect(page.getByTestId("ranking-top-on-map")).toHaveAttribute("href", "/?schools=t.s_m.top.10");
});

test("no ranking page scrolls sideways at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/rankings/most-expensive");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const box = await page.getByTestId("ranking-add-to-compare").first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("an MSOA opened from a ranking is the one area page, not a guide (v4.5)", async ({ page }) => {
  await page.goto("/area/msoa/E02000001");
  await expect(page.getByTestId("area-full-page")).toBeVisible();
  await expect(page.getByTestId("area-tiles").locator("li")).toHaveCount(12);
});
