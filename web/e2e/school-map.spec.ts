import { expect, test, type Page } from "./fixtures";

import { openShowPanel } from "./top-bar";

// Show › Schools (v3 Fixes 23, 31; v4 Task 1c; Map controls PR 2–3): cap icons with filters and a key under the
// Show row, a popup per school that peeks on hover (a mouse): name, Ofsted as the cap's top colour only, up to
// 3 tags; a click or tap opens the school's card in the sheet with the › to its page (e2e/map-pick.spec.ts).
// Preview points (app/api/v1/schools/points): Westminster Primary Preview (report card), and a private one.

const PRIMARY = { lng: -0.139, lat: 51.503, name: "Westminster Primary Preview" };
const PRIVATE = { lng: -0.163, lat: 51.509, name: "Hyde Park Independent Preview" };

async function openAt(page: Page, at: { lng: number; lat: number }) {
  const points = page.waitForResponse((response) => response.url().includes("/api/v1/schools/points"));
  await page.goto(`/?lat=${at.lat}&lng=${at.lng}&zoom=15&schools=on&stations=off&diagnostics=1`);
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  expect((await points).ok()).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.layerIds().includes("school-points") ?? false)).toBe(true);
}

/** The school's cap on the page, in CSS pixels. */
async function capAt(page: Page, at: { lng: number; lat: number }) {
  const canvas = await page.locator(".maplibregl-canvas").boundingBox();
  const point = await page.evaluate((lngLat) => window.__closeKnitDiagnostics.project(lngLat), [at.lng, at.lat] as [number, number]);
  return { x: (canvas?.x ?? 0) + point.x, y: (canvas?.y ?? 0) + point.y };
}

/** Hovers (a mouse) the cap until its popup peeks: the icons draw once their images are in. */
async function openPopup(page: Page, at: { lng: number; lat: number }) {
  const popup = page.getByTestId("school-popup");
  await expect(async () => {
    const cap = await capAt(page, at);
    await page.mouse.move(cap.x + 40, cap.y + 40);
    await page.mouse.move(cap.x, cap.y);
    await expect(popup).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return popup;
}

/** Clicks (or taps) the cap until its card opens in the sheet. */
async function openCard(page: Page, at: { lng: number; lat: number }) {
  const card = page.getByTestId("school-card");
  await expect(async () => {
    const cap = await capAt(page, at);
    await page.mouse.click(cap.x, cap.y);
    await expect(card).toBeAttached({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return card;
}

test("Show › Schools: filters drawn as the real markers with counts and All · None; the address keeps them", async ({ page }) => {
  await openAt(page, PRIMARY);
  const show = await openShowPanel(page);
  await expect(show.getByTestId("schools-toggle")).toBeChecked();
  const key = show.getByTestId("school-legend");
  await expect(key.locator(".school-key__name")).toHaveText(["Primary", "Secondary", "All-through", "Private",
    "Outstanding", "Good", "Requires improvement", "Inadequate", "Report card", "Not inspected"]);
  // Counts from the same points as the map (the preview: one primary, one secondary, one private).
  await expect(key.getByTestId("school-type-private").locator(".school-key__count")).toHaveText("1");
  await expect(key.getByTestId("school-type-all-through").locator(".school-key__count")).toHaveText("0");
  await expect(key.getByTestId("school-awards").locator("li")).toHaveCount(5);
  await expect(key).toContainText("P primary · S secondary · PS all-through");
  await expect(key.getByTestId("school-type-all")).toBeDisabled();
  // Private off: its cap leaves the map and the address lists the types kept.
  await key.getByTestId("school-type-private").getByRole("checkbox").uncheck();
  await expect(page).toHaveURL(/schools=t\.p\.s\.a(&|$)/);
  // England top % ≤ 10% (Schools filter v2): one measure and its threshold, in the same ?schools= text.
  await key.getByTestId("school-measure").selectOption("englandTopPercent");
  await key.getByTestId("school-threshold-on").getByRole("checkbox").check();
  await expect(page).toHaveURL(/schools=t\.p\.s\.a_m\.top\.10/);
  await page.reload();
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  const again = await openShowPanel(page);
  await expect(again.getByTestId("school-type-private").getByRole("checkbox")).not.toBeChecked();
  await expect(again.getByTestId("school-measure")).toHaveValue("englandTopPercent");
  await expect(again.getByTestId("school-threshold-on").getByRole("checkbox")).toBeChecked();
  await again.getByTestId("school-filter-reset").click();
  await expect(page).toHaveURL(/schools=on/);
  await expect(again.getByTestId("school-filter-reset")).toBeDisabled();
});

test("Show › Schools: the caps sit over the street labels, their +N folds over them", async ({ page }) => {
  await openAt(page, PRIMARY);
  const ids = await page.evaluate(() => window.__closeKnitDiagnostics.layerIds());
  expect(ids.indexOf("school-folds")).toBeGreaterThan(ids.indexOf("school-points"));
  const firstLabel = await page.evaluate(() => window.__closeKnitDiagnostics.layerIds().find((id) => /label|name|place/i.test(id) && !/school/.test(id)));
  if (firstLabel) expect(ids.indexOf("school-points"), firstLabel).toBeGreaterThan(ids.indexOf(firstLabel));
});

test("a school's popup peeks on hover: name, Ofsted as an icon, tags; it never covers the cap and goes when the pointer leaves", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "a touch screen has no peek: a tap opens the card (map-pick.spec.ts)");
  await openAt(page, PRIMARY);
  const popup = await openPopup(page, PRIMARY);
  await expect(popup).toHaveAccessibleName(PRIMARY.name);
  await expect(popup.locator(".school-pop__name")).toHaveText(PRIMARY.name);
  await expect(popup.getByRole("img", { name: "New Ofsted report card" })).toBeVisible();
  await expect(popup.getByTestId("school-popup-tags").locator("li")).toHaveText(["Primary"]);
  // Above the cap, clear of it (or below it near the top edge).
  const cap = await capAt(page, PRIMARY);
  const box = await popup.boundingBox();
  expect(box && (box.y + box.height < cap.y - 8 || box.y > cap.y + 8)).toBe(true);
  // Leaving the cap closes it.
  await page.mouse.move(cap.x + 260, cap.y + 160);
  await expect(popup).toBeHidden();
});

test("a private school: ink cap, no Ofsted swatch, Private tag; its card links to GIAS", async ({ page }, testInfo) => {
  await openAt(page, PRIVATE);
  if (testInfo.project.name !== "mobile") {
    const popup = await openPopup(page, PRIVATE);
    await expect(popup.locator(".school-pop__name")).toHaveText(PRIVATE.name);
    await expect(popup.getByRole("img")).toHaveCount(0);
    await expect(popup.getByTestId("school-popup-tags").locator("li")).toHaveText(["Private", "All-through", "Sixth form"]);
  }
  const card = await openCard(page, PRIVATE);
  await expect(card).toContainText(PRIVATE.name);
  await expect(card.getByTestId("school-card-tags").locator("li")).toHaveText(["Private", "All-through", "Sixth form"]);
  await expect(card.getByTestId("school-card-link"))
    .toHaveAttribute("href", "https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/100009");
  await expect(card.getByTestId("school-card-save")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
});

// Both preview schools in view, at phone width too.
const BETWEEN = { lng: -0.151, lat: 51.506 };

async function openBetween(page: Page) {
  await page.goto(`/?lat=${BETWEEN.lat}&lng=${BETWEEN.lng}&zoom=13&schools=on&stations=off&diagnostics=1`);
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  const links = page.getByTestId("school-keys").getByRole("link");
  await expect(links).toHaveCount(2, { timeout: 15_000 });
  return links;
}

test("keyboard: the schools in view are links; focus opens one popup at its cap, Tab moves it, Esc closes it", async ({ page }) => {
  const links = await openBetween(page);
  expect((await links.allTextContents()).sort()).toEqual([PRIVATE.name, PRIMARY.name].sort());
  await expect(links.filter({ hasText: PRIMARY.name })).toHaveAccessibleName(`${PRIMARY.name}, Primary, state, Ofsted Report card`);
  const popup = page.getByTestId("school-popup");
  await links.first().focus();
  await expect(popup).toHaveCount(1);
  await expect(popup).toHaveAttribute("data-focused", "");
  await expect(popup.locator(".school-pop__name")).toHaveText((await links.first().textContent()) ?? "");
  await page.keyboard.press("Tab");
  await expect(links.nth(1)).toBeFocused();
  await expect(popup).toHaveCount(1);
  await expect(popup.locator(".school-pop__name")).toHaveText((await links.nth(1).textContent()) ?? "");
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
});

test("a mouse: one popup at a time between caps; a click opens the school's card in the sheet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "a touch screen has no peek");
  await openBetween(page);
  const popup = await openPopup(page, PRIMARY);
  await expect(popup.locator(".school-pop__name")).toHaveText(PRIMARY.name);
  await openPopup(page, PRIVATE);
  await expect(page.getByTestId("school-popup")).toHaveCount(1);
  await expect(page.getByTestId("school-popup").locator(".school-pop__name")).toHaveText(PRIVATE.name);
  // A state school opens its page's content in the panel (school-panel.tsx).
  await openCard(page, PRIMARY);
  const card = page.getByTestId("school-panel");
  await expect(card.getByRole("heading", { level: 1 })).toHaveText(PRIMARY.name);
  await expect(card.getByTestId("school-panel-page")).toHaveAttribute("href", "/school/100001");
  await expect(page.getByTestId("school-popup")).toHaveCount(0);
});
