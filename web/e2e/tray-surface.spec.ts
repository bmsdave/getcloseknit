import { expect, test, type Page } from "./fixtures";
import { continueToReview, seedClassicSearch } from "./wizard";
import { openMatchBuilder } from "./top-bar";
import { smallText } from "./target-size";

// Contract 4: the comparison tray is an opaque --panel-solid surface (ranking
// rows never show through it) with text at 12px or more, in Day and Night.
async function trayWithOne(page: Page) {
  await seedClassicSearch(page);
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  await page.getByTestId("match-ranking").getByRole("checkbox", { name: /^Compare / }).nth(0).click();
  const tray = page.getByTestId("comparison-tray");
  await expect(tray.getByTestId("comparison-chip")).toHaveCount(1);
  return tray;
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`tray is opaque with 12px text (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 844 });
    const tray = await trayWithOne(page);
    const surface = await tray.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--panel-solid)";
      element.append(probe);
      const panel = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, panel, shadow: style.boxShadow };
    });
    // rgb() with no alpha channel means alpha 1.
    expect(surface.background).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(surface.background).toBe(surface.panel);
    expect(surface.shadow).toContain("-8px");
    const small = (await smallText(page)).filter((line) => line.includes("comparison-tray"));
    expect(small).toEqual([]);
  });
}
