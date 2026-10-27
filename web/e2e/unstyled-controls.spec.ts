import { expect, test, type Page } from "./fixtures";
import { openEvidenceSection, openScaleSettings } from "./evidence";
import { continueToReview } from "./wizard";
import { openMapSettings, openMatchBuilder, openTopMenu } from "./top-bar";

// A button that no rule styles falls back to the browser's own look (grey
// face, 2px outset border) and reads as broken next to the themed controls.
// Walk the main views and name every visible button still drawn that way.
async function unstyledButtons(page: Page) {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const element of document.querySelectorAll("button, input[type='button'], input[type='submit']")) {
      const html = element as HTMLElement;
      if (html.getClientRects().length === 0) continue;
      const style = getComputedStyle(html);
      if (style.borderTopStyle === "outset" || style.borderTopStyle === "inset") {
        const name = (html.getAttribute("aria-label") ?? html.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 44);
        bad.push(`<${html.tagName.toLowerCase()}> ${name}`);
      }
    }
    return bad;
  });
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "computed styles do not depend on the device profile");
});

test("home, appearance menu and wizard have no browser-default buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  expect(await unstyledButtons(page)).toEqual([]);

  await openTopMenu(page);
  expect(await unstyledButtons(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await openMapSettings(page);
  await page.getByTestId("appearance-toggle").click();
  expect(await unstyledButtons(page)).toEqual([]);
  // Escape folds Colours, then Map settings.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await openScaleSettings(page);
  expect(await unstyledButtons(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await openMatchBuilder(page);
  await expect(page.getByTestId("match-list")).toBeVisible();
  expect(await unstyledButtons(page)).toEqual([]);
  await continueToReview(page);
  expect(await unstyledButtons(page)).toEqual([]);
  await expect(page.getByTestId("match-ranking")).toContainText("match");
  expect(await unstyledButtons(page)).toEqual([]);

  // Three areas ticked: the tray (count, names, Clear, Compare) is styled too.
  const boxes = page.getByTestId("match-ranking").getByRole("checkbox", { name: /^Compare / });
  for (const index of [0, 1, 2]) await boxes.nth(index).click();
  await page.getByTestId("comparison-tray").locator(".tray-areas > summary").click();
  expect(await unstyledButtons(page), "three areas in the tray").toEqual([]);
});

test("the brief and every section of the full page have no browser-default buttons", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  // The brief, then every section of the full page, the planning fold and the home's tools.
  expect(await unstyledButtons(page), "brief").toEqual([]);
  for (const name of ["Price", "Getting around", "Safety", "Schools", "Local places", "Environment", "Homes", "People", "Living costs", "Planning"] as const) {
    await openEvidenceSection(page, name);
    expect(await unstyledButtons(page), name).toEqual([]);
  }
  await openEvidenceSection(page, "Price");
  await page.getByTestId("market-recent").locator(":scope > summary").click();
  expect(await unstyledButtons(page), "recent sales open").toEqual([]);
});

test("a chosen home's cards on the full page have no browser-default buttons", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await openEvidenceSection(page, "Homes sold nearby");
  await expect(page.getByTestId("property-history")).toBeVisible();
  await openEvidenceSection(page, "Plan & check");
  await expect(page.getByTestId("viewing-checklist")).toBeVisible();
  expect(await unstyledButtons(page), "home").toEqual([]);
});
