import { expect, test } from "./fixtures";

import { seedSearch } from "./wizard";

// A result row is rank | name and why | score | ♡ | 44px tick: a long place name in the "why" line
// ("#1 Waterloo preview station 15′") wraps inside the row, so the tick never leaves the panel and the
// sheet never scrolls sideways.

const LONG_PLACE = [{
  id: "p1", label: "Waterloo preview station", target: { kind: "point", latitude: 51.5031, longitude: -0.1132 },
  mode: "transit", targetMinutes: 25, weight: 3, must: false,
}];

for (const width of [320, 390, 1440]) {
  test(`at ${width}px every tick stays inside the panel`, async ({ browser, baseURL }) => {
    const mobile = width < 768;
    const context = await browser.newContext({ baseURL, viewport: { width, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    await seedSearch(page, { places: LONG_PLACE });
    await page.goto("/?layer=personal-match");
    await expect(page.locator('[data-testid="match-item"][data-id^="place:"]')).toContainText("Waterloo preview station");
    await expect(page.getByTestId("match-top").getByTestId("match-row").first()).toBeAttached();
    const fit = await page.evaluate(() => {
      const panel = document.querySelector(".match-panel")!.getBoundingClientRect();
      const ticks = [...document.querySelectorAll(".match-rows .compare-toggle")].map((tick) => tick.getBoundingClientRect().right);
      const scroller = document.querySelector<HTMLElement>(".dock-area, .match-sheet .map-sheet__body");
      return { panelRight: panel.right, ticks, overflow: scroller ? scroller.scrollWidth - scroller.clientWidth : 0 };
    });
    expect(fit.ticks.length).toBeGreaterThan(0);
    for (const right of fit.ticks) expect(right).toBeLessThanOrEqual(fit.panelRight);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
}
