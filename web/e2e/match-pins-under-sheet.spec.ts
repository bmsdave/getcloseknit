import { expect, test } from "./fixtures";

import { seedSearch } from "./wizard";

// Hotfix: My match's numbered pins (z-index 40 − rank, match-overlays.tsx) stay in the map's own stacking
// context (.map-canvas isolation), under the phone sheet, the legend and the map controls.
test("phone: rank pins stay under the full sheet", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone sheet");
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  const sheet = page.getByTestId("match-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("match-map-area").first()).toBeAttached();
  const handle = sheet.getByTestId("map-sheet-handle");
  await handle.focus();
  for (let step = 0; step < 3 && (await sheet.getAttribute("data-snap")) !== "full"; step += 1) await page.keyboard.press("ArrowUp");
  await expect(sheet).toHaveAttribute("data-snap", "full");

  // Every pin whose centre lies inside the sheet is hidden by it: the sheet, not the pin, is on top there.
  await expect.poll(() => page.evaluate(() => {
    const frame = document.querySelector('[data-testid="match-sheet"]')!.getBoundingClientRect();
    const pins = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="match-map-area"]'));
    const inside = pins.map((pin) => pin.getBoundingClientRect())
      .map((box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 }))
      .filter(({ x, y }) => x > frame.left && x < frame.right && y > frame.top && y < frame.bottom);
    const onTop = inside.filter(({ x, y }) => document.elementFromPoint(x, y)?.closest(".maplibregl-marker"));
    return { inside: inside.length > 0, onTop: onTop.length };
  })).toEqual({ inside: true, onTop: 0 });
});
