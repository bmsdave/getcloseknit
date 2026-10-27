import { expect, test } from "./fixtures";
import { openAreaPage } from "./evidence";

// Printing the full area page: every section is always open, so the paper
// carries them all; a small close knit header, and no nav, links bar, tab
// chips, footer links or toggle buttons; web links carry their address after
// them, as in the evidence pack.
test("a printed area page shows every section, a small header, no nav or next steps, and link addresses", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  const full = await openAreaPage(page);
  const sections = full.locator("section.area-section");
  await expect(sections).toHaveCount(10);
  await expect(full.getByTestId("school-phases")).toBeVisible();
  await expect(full.getByTestId("area-tiles")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  for (let index = 0; index < 10; index += 1) await expect(sections.nth(index)).toBeVisible();
  // A small close knit mark heads the paper; the nav, Map link, tab chips and footer links stay off it.
  await expect(full.getByTestId("site-header").getByRole("link", { name: /close knit/ })).toBeVisible();
  for (const hidden of [full.getByRole("navigation", { name: "Site" }), full.getByRole("link", { name: "Back to the map", exact: true }),
    full.getByTestId("area-save-actions"), full.getByRole("navigation", { name: "Area links" }),
    full.getByTestId("area-tabs"), full.getByTestId("area-footer"),
    full.getByTestId("breadcrumbs"), full.getByTestId("page-tailor"), full.getByTestId("whats-next"),
    full.locator(".help-tip__button").first(), full.locator("button[aria-pressed]").first()]) {
    await expect(hidden).toBeHidden();
  }
  const link = full.locator('a[href^="http"]:visible').first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(await link.evaluate((node) => getComputedStyle(node, "::after").content)).toBe(`" <${href}>"`);

  await page.emulateMedia({ media: "screen" });
  await expect(full.getByTestId("site-header")).toBeVisible();
  await expect(full.getByTestId("area-tabs")).toBeVisible();
});

// C10: the printed pack has 16mm margins, no fold markers, a small close knit header and no
// back link or buttons; the page never scrolls sideways at 320, 390 or 1280, on screen or paper.
test("the printed pack: small header, no markers or controls, no sideways scroll", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001/pack");
  const pack = page.getByTestId("market-pack");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await expect(pack.getByTestId("site-header").getByRole("link", { name: /close knit/ })).toBeVisible();
  for (const hidden of [pack.getByRole("navigation", { name: "Site" }), pack.getByRole("link", { name: "Back to the map", exact: true }),
    pack.getByTestId("breadcrumbs"), pack.getByTestId("area-page-tabs"), page.getByTestId("print-button"), page.getByTestId("market-pack-markdown")]) {
    await expect(hidden).toBeHidden();
  }
  const marker = await pack.locator(".pack-section > summary").first().evaluate((node) => getComputedStyle(node, "::after").content);
  expect(marker).toBe("none");
  const margin = await page.evaluate(() => [...document.styleSheets].flatMap((sheet) => {
    try { return [...sheet.cssRules]; } catch { return []; }
  }).flatMap((rule) => rule instanceof CSSMediaRule ? [...rule.cssRules] : [rule])
    .some((rule) => rule instanceof CSSPageRule && rule.style.margin === "16mm"));
  expect(margin).toBe(true);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const media of ["print", "screen"] as const) {
      await page.emulateMedia({ media });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${media} at ${width}`).toBeLessThanOrEqual(0);
    }
  }
});
