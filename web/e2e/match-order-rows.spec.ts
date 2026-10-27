import { expect, test, type Page } from "./fixtures";

import { addChip, matchItem, typeBudget } from "./wizard";

// Board "My match · Your order rows": each criterion is one row card whose open body is its lower half (one open at a
// time), ≡ reorders with a slide (drag or ↑ ↓), and × on the right removes at once with Undo in the toast.

/** The ids of the list's criteria in order (Musts first). */
async function order(page: Page): Promise<string[]> {
  return page.getByTestId("match-item").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-id") ?? ""));
}

async function threeCriteria(page: Page): Promise<void> {
  await page.goto("/?layer=personal-match");
  await typeBudget(page, "650k");
  await addChip(page, "safer-streets");
  await addChip(page, "good-schools");
  await addChip(page, "quiet-streets");
  await expect(matchItem(page, "range:noise").getByTestId("match-item-rank")).toHaveText("#3");
}

test("a row opens in place: its body is the row's lower half, one at a time; the header closes it", async ({ page, isMobile }) => {
  await threeCriteria(page);
  const crime = matchItem(page, "range:crime");
  const schools = matchItem(page, "range:schools");
  await crime.getByTestId("match-chip").click();
  // The body renders inside the row (the locator is chained from it) and the row is the one bordered card.
  const body = crime.getByTestId("match-card-range:crime");
  await expect(body).toBeVisible();
  await expect(crime.getByTestId("match-chip")).toHaveAttribute("aria-expanded", "true");
  await expect(body.getByTestId("match-card-must")).toBeVisible();
  // Fine-tune › sits in the body too (phones hide it by CSS, match-list.css).
  if (!isMobile) await expect(body.getByTestId("fine-tune")).toBeVisible();
  expect(await body.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe("0px");
  expect(await crime.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
  // The old card × is gone; the row's × is on the right of the header.
  await expect(page.getByTestId("match-card-remove")).toHaveCount(0);
  const [removeBox, chipBox] = await Promise.all([crime.getByTestId("match-item-remove").boundingBox(), crime.getByTestId("match-chip").boundingBox()]);
  expect(removeBox!.x).toBeGreaterThan(chipBox!.x + chipBox!.width - 1);
  expect(removeBox!.width).toBeGreaterThanOrEqual(44);
  // One open at a time: the next header closes the first.
  await schools.getByTestId("match-chip").click();
  await expect(crime.getByTestId("match-card-range:crime")).toHaveCount(0);
  await expect(schools.getByTestId("match-card-range:schools")).toBeVisible();
  // The open header closes its own body.
  await schools.getByTestId("match-chip").click();
  await expect(schools.getByTestId("match-card-range:schools")).toHaveCount(0);
  await expect(schools.getByTestId("match-chip")).toHaveAttribute("aria-expanded", "false");
});

test("↑ ↓ on ≡ reorders the ranked rows; the moved rows slide (none with reduced motion)", async ({ page }) => {
  await threeCriteria(page);
  const noise = matchItem(page, "range:noise");
  const handle = noise.locator(".match-item__handle");
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(noise.getByTestId("match-item-rank")).toHaveText("#2");
  await expect(page.getByTestId("map-toast-text")).toHaveText("Quiet streets now #2 · top 10 re-sorted");
  await expect(handle).toBeFocused();
  // FLIP: the row that moved carries the slide's transition until the next settle.
  expect(await noise.evaluate((node) => node.style.transition)).toContain("transform 180ms");
  await page.keyboard.press("ArrowUp");
  await expect(noise.getByTestId("match-item-rank")).toHaveText("#1");
  expect(await order(page)).toEqual(["affordability", "range:noise", "range:crime", "range:schools"]);
  await page.keyboard.press("ArrowDown");
  await expect(noise.getByTestId("match-item-rank")).toHaveText("#2");
  // Reduced motion: rows jump into place.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await expect(noise.getByTestId("match-item-rank")).toHaveText("#3");
  expect(await noise.evaluate((node) => node.style.transition)).toBe("none");
});

test("a mouse drag lifts the row and follows the pointer; the drop settles into the new place", async ({ page, isMobile }) => {
  test.skip(isMobile, "a mouse drag; phones long-press");
  await threeCriteria(page);
  const noise = matchItem(page, "range:noise");
  const handle = noise.locator(".match-item__handle");
  const target = await matchItem(page, "range:crime").boundingBox();
  const from = await handle.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2, from!.y - 20, { steps: 4 });
  await expect(noise).toHaveClass(/match-item--dragging/);
  expect(await noise.evaluate((node) => node.style.transform)).toMatch(/^translateY\(-?\d+px\) scale\(1\.02\)$/);
  await page.mouse.move(from!.x + from!.width / 2, target!.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect(noise.getByTestId("match-item-rank")).toHaveText("#1");
  await expect(noise).not.toHaveClass(/match-item--dragging/);
  // The drop's settle: an ease-out transition, then no transform left behind.
  expect(await noise.evaluate((node) => node.style.transition)).toContain("200ms ease-out");
  await expect.poll(() => noise.evaluate((node) => node.style.transform)).toBe("");
  await expect(page.getByTestId("map-toast-text")).toHaveText("Quiet streets now #1 · top 10 re-sorted");
});

test("× removes the row at once; Undo in the toast puts it back where it was", async ({ page }) => {
  await threeCriteria(page);
  const schools = matchItem(page, "range:schools");
  await schools.getByTestId("match-chip").click();
  await expect(schools.getByTestId("match-card-range:schools")).toBeVisible();
  await schools.getByTestId("match-item-remove").click();
  await expect(schools).toHaveCount(0);
  await expect(page.getByTestId("match-card-range:schools")).toHaveCount(0);
  expect(await order(page)).toEqual(["affordability", "range:crime", "range:noise"]);
  await expect(matchItem(page, "range:noise").getByTestId("match-item-rank")).toHaveText("#2");
  const toast = page.getByTestId("map-toast");
  await expect(toast.getByTestId("map-toast-text")).toHaveText("Removed");
  await toast.getByTestId("map-toast-action").click();
  await expect(schools).toBeVisible();
  expect(await order(page)).toEqual(["affordability", "range:crime", "range:schools", "range:noise"]);
  await expect(schools.getByTestId("match-item-rank")).toHaveText("#2");
  await expect(schools.getByTestId("match-chip")).toHaveAttribute("aria-expanded", "false");
  await expect(toast).toHaveCount(0);
});
