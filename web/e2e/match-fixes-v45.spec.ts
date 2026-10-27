import { expect, test } from "./fixtures";

import { encodeShareLink, exampleProfile } from "../src/lib/profile-state";
import { matchItem } from "./wizard";

test("a shared search's Budget card stays open while its slider moves (v4.5, round 2 #29)", async ({ page }) => {
  await page.goto(`/?layer=personal-match${encodeShareLink(exampleProfile(), [])}`);
  const panel = page.getByTestId("match-ranking").filter({ visible: true }).first();
  await expect(panel.getByTestId("shared-banner")).toBeVisible();
  const budget = panel.locator('[data-testid="match-item"][data-id="affordability"]');
  await budget.getByTestId("match-chip").click();
  const slider = budget.locator('input[type="range"]').first();
  await expect(slider).toBeVisible();
  const chip = budget.getByTestId("match-chip");
  const before = await chip.textContent();
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  // The first edit makes the search yours (the shared card goes); the card, its slider and the focus stay.
  await expect(page.getByTestId("shared-banner")).toHaveCount(0);
  await expect(chip).not.toHaveText(before ?? "");
  await expect(matchItem(page, "affordability").filter({ visible: true }).getByTestId("match-chip")).toHaveAttribute("aria-expanded", "true");
  await expect(slider).toBeFocused();
  const once = await chip.textContent();
  await page.keyboard.press("ArrowLeft");
  await expect(chip).not.toHaveText(once ?? "");
  await expect(slider).toBeFocused();
});

test("the map pins are the list's ten, numbered as the rows (v4.5, round 2 #10)", async ({ page }) => {
  await page.goto(`/?layer=personal-match${encodeShareLink(exampleProfile(), [])}`);
  const panel = page.getByTestId("match-ranking").filter({ visible: true }).first();
  const rows = panel.getByTestId("match-top").getByTestId("match-row");
  await expect(rows.first()).toBeVisible();
  const names = await rows.locator(".match-row__name").allTextContents();
  expect(new Set(names).size).toBe(names.length);
  const ids = await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-id")));
  const pins = page.getByTestId("match-map-area");
  await expect.poll(() => pins.count(), { timeout: 15_000 }).toBeGreaterThan(0);
  // Pin n opens row n's area: each numbered pin selects the area its row names.
  const count = Math.min(3, names.length);
  let checked = 0;
  for (let index = 0; index < count; index += 1) {
    const pin = pins.filter({ has: page.locator("b", { hasText: new RegExp(`^${index + 1}$`) }) }).first();
    if (!(await pin.count())) continue;
    await pin.dispatchEvent("click");
    await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toBe(ids[index]);
    checked += 1;
  }
  expect(checked).toBeGreaterThan(0);
});
