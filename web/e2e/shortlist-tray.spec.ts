import { expect, test, type Page } from "./fixtures";

import { seedSearch } from "./wizard";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): the tray's Needs · Shortlist · Compare · Brief steps are one of them, so the
// stages test turns them on; the layout tests read the default page (the tray and its Compare only).
const extrasOn = (page: Page) => page.addInitScript(() => {
  for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on");
});

// #10: once an area is ticked, a tray sticks to the bottom of the results — where you are
// (Needs ✓ · Shortlist · Compare · Brief) and Compare (the one primary, to /compare) — and the
// ticked areas survive a reload.

const COMPARE_KEY = "close-knit.compare.v1";

async function openResults(page: Page) {
  await seedSearch(page);
  await page.goto("/?layer=personal-match");
  await expect(page.getByTestId("match-ranking").getByRole("checkbox", { name: /^Compare / }).first()).toBeVisible();
}

function tray(page: Page) {
  return page.getByTestId("comparison-tray");
}

test("ticking shows the tray, steps through the stages and opens the brief", async ({ page }) => {
  await extrasOn(page);
  await openResults(page);
  const boxes = page.getByTestId("match-ranking").getByRole("checkbox", { name: /^Compare / });
  await expect(tray(page)).not.toBeInViewport();
  await expect(page.getByTestId("compare-hint")).toHaveText("Tick to compare");
  await boxes.nth(0).click();
  await expect(page.getByTestId("compare-hint")).toHaveCount(0);
  await expect(tray(page)).toBeInViewport();
  await expect(tray(page)).toContainText("1 area");
  const stages = tray(page).getByRole("list", { name: "Your progress" });
  await expect(stages).toContainText("Needs");
  await expect(stages.locator("[aria-current='step']")).toHaveText("Shortlist");
  await expect(tray(page).getByRole("button", { name: "Compare areas" })).toBeDisabled();

  await boxes.nth(1).click();
  await expect(tray(page)).toContainText("2 areas");
  await expect(stages.locator("[aria-current='step']")).toHaveText("Compare");
  // v3 Fix 22: Compare opens /compare, whose Brief is the one way to the brief (no dialogs here).
  const compare = tray(page).getByRole("link", { name: "Compare areas" });
  await expect(compare).toHaveAttribute("href", /^\/compare\?kind=places&ids=/);
  await expect(tray(page).getByRole("button", { name: "Make my brief" })).toHaveCount(0);
  await compare.click();
  await expect(page.getByTestId("compare-page")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("compare-brief")).toHaveAttribute("href", /^\/brief#shortlist=v1\./);
});

test("the compared areas survive a reload", async ({ page }) => {
  await openResults(page);
  await page.getByRole("checkbox", { name: "Compare North London preview" }).click();
  await page.getByRole("checkbox", { name: "Compare South Bank preview" }).click();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), COMPARE_KEY))
    .toBe(JSON.stringify(["uk:lsoa:E01000002", "uk:lsoa:E01000003"]));
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Compare North London preview" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("checkbox", { name: "Compare South Bank preview" })).toHaveAttribute("aria-checked", "true");
  await expect(tray(page)).toContainText("2 areas");
});

for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`at ${size.width}px (${colorScheme}) nothing hides behind the tray at the end of the list`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme });
      await page.addInitScript((key) => window.localStorage.setItem(key, JSON.stringify(["uk:lsoa:E01000002", "uk:lsoa:E01000003"])), COMPARE_KEY);
      await openResults(page);
      await expect(tray(page).getByRole("link", { name: "Compare areas" })).toBeVisible();
      // A phone's My match sheet scrolls at full height (v4 Task 13): raise it to read to the end of the list.
      if (size.width < 800) {
        const sheet = page.getByTestId("match-sheet");
        await sheet.getByTestId("map-sheet-handle").focus();
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");
        await expect(sheet).toHaveAttribute("data-snap", "full");
      }
      const layout = await page.getByTestId("match-ranking").evaluate((panel) => {
        const dock = panel.querySelector<HTMLElement>("[data-testid='comparison-tray']")!;
        let scroller = panel.parentElement;
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
        scroller!.scrollTop = scroller!.scrollHeight;
        const focusable = [...panel.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary")]
          .filter((node) => !dock.contains(node) && node.checkVisibility());
        const last = focusable[focusable.length - 1].getBoundingClientRect();
        // Only one primary on screen: the tray's Compare.
        const primaries = [...document.querySelectorAll<HTMLElement>("button, a")].filter((node) => node.getClientRects().length > 0
          && getComputedStyle(node, "::after").borderStyle === "dashed"
          && getComputedStyle(node).backgroundColor === getComputedStyle(dock.querySelector(".tray-compare")!).backgroundColor);
        return { lastBottom: last.bottom, trayTop: dock.getBoundingClientRect().top, trayHeight: scroller!.style.getPropertyValue("--tray-h"),
          primaries: primaries.map((node) => node.textContent?.trim()) };
      });
      expect(layout.lastBottom).toBeLessThanOrEqual(layout.trayTop + 0.5);
      expect(layout.trayHeight).toMatch(/^\d+px$/);
      expect(layout.primaries).toEqual(["Compare"]);
    });
  }
}

test("areas added from an area page wait for a search", async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, JSON.stringify(["uk:lsoa:E01000002"])), COMPARE_KEY);
  await page.goto("/?layer=personal-match");
  await expect(page.getByTestId("compare-waiting")).toHaveText("1 area to compare: add your budget.");
});
