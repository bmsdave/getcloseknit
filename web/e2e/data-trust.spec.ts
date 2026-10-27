import { expect, expectSteady, pause, test } from "./fixtures";
import { closeTopMenu, openMenuGroup, openTopMenu } from "./top-bar";
import { chooseLayer } from "./evidence";

// The data mode switch and release ids are internals: every entry here opts
// in with ?dev=1 (visitors see only the demo warning and offline).

const DEMO_CRIME = "/?dev=1&layer=crime&period=2026-06&selected=uk%3Alsoa%3AE01000001";
const REAL_CRIME = "/?dev=1&mode=real&release=official-2026-06&layer=crime&selected=uk%3Alsoa%3AE01000001";

test("direct real entry agrees on mode and release everywhere", async ({ page }) => {
  const evidenceRequests: string[] = [];
  page.on("request", (request) => {
    // Carrier geometry is release-independent (real mode never draws fixture polygons).
    if (request.url().includes("/api/v1/areas/") && !request.url().includes("/api/v1/areas/boxes")) {
      evidenceRequests.push(request.url());
    }
  });

  await page.goto(REAL_CRIME);
  await expect(page.getByTestId("evidence-unavailable")).toBeVisible();
  await expect(page.getByTestId("data-status")).toHaveText("Real data · official-2026-06");
  // The data mode and its release line live in the ≡ menu.
  await openTopMenu(page);
  await expect(page.getByRole("radio", { name: /Real/ })).toBeChecked();
  await expect(page.getByTestId("data-mode-release")).toHaveText("Release official-2026-06");
  await expect(page).toHaveURL(/mode=real/);
  await expect(page).toHaveURL(/release=official-2026-06/);

  expect(evidenceRequests.length).toBeGreaterThan(0);
  for (const url of evidenceRequests) {
    const parameters = new URL(url).searchParams;
    expect(parameters.get("mode")).toBe("real");
    expect(parameters.get("release")).toBe("official-2026-06");
  }
});

test("legacy links without mode fall back to demo defaults", async ({ page }) => {
  await page.goto("/?dev=1&selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("data-status")).toHaveText("Demo data · not for decisions · preview-2026-09");
  await openTopMenu(page);
  await expect(page.getByRole("radio", { name: /Demo/ })).toBeChecked();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
});

test("switching modes keeps every surface in agreement", async ({ page }) => {
  await page.goto("/?dev=1");
  await openTopMenu(page);
  await page.getByRole("radio", { name: /Real/ }).click();
  await expect(page.getByRole("radio", { name: /Real/ })).toBeChecked();
  await expect(page.getByTestId("data-status")).toHaveText("Real data · official-2026-06");
  await expect(page.getByTestId("data-mode-release")).toHaveText("Release official-2026-06");
  await expect(page.getByTestId("layer-notice")).toContainText("Real data");
  await expect(page).toHaveURL(/mode=real/);

  await page.getByRole("radio", { name: /Real/ }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: /Demo/ })).toBeChecked();
  await expect(page.getByTestId("data-status")).toHaveText("Demo data · not for decisions · preview-2026-09");
  await expect(page).toHaveURL(/mode=demo/);
});

// Every shipped layer is published in the real pilot (crime, price, deprivation,
// income, social renting), so there is no unavailable layer to exercise here;
// the guard stays covered by tests/real-demo-separation.test.ts with a
// synthetic layer id. Re-enable with the next unpublished layer.
const NO_UNPUBLISHED_REAL_LAYER = true;

test("unavailable layers refuse without requests and keep surfaces aligned", async ({ page }) => {
  test.skip(NO_UNPUBLISHED_REAL_LAYER, "no unpublished real layer to exercise");
  const incomeAreas: string[] = [];
  const incomePacks: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/v1/areas/") && new URL(url).searchParams.get("metric") === "income") {
      incomeAreas.push(url);
    }
    if (url.includes("/api/v1/value-packs/income/")) incomePacks.push(url);
  });

  await page.goto(REAL_CRIME);
  await expect(page.getByTestId("selected-area")).not.toBeEmpty();
  await closeTopMenu(page);
  await chooseLayer(page, "income");
  await expect(page.getByTestId("layer-notice")).toContainText("official-2026-06");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  await expect(page.getByTestId("data-status")).toHaveText("Real data · official-2026-06");
  await expectSteady(() => {
    expect(incomeAreas).toEqual([]);
    expect(incomePacks).toEqual([]);
  }, 500);
});

test("offline failure is explicit on every surface", async ({ page }) => {
  await page.goto(DEMO_CRIME);
  await expect(page.getByTestId("selected-area")).not.toBeEmpty();

  await page.route("**/api/v1/areas/**", (route) => route.abort("failed"));
  await chooseLayer(page, "price-per-square-metre");
  await expect(page.getByTestId("evidence-offline")).toBeVisible();
  await expect(page.getByTestId("evidence-unavailable")).toBeVisible();
  await expect(page.getByTestId("data-status")).toContainText("Offline");
  // The guide stays reachable offline, from the ≡ menu.
  await expect((await openMenuGroup(page, "Learn")).getByRole("link", { name: "Guide" })).toBeAttached();
});

test("saved restoration agrees without duplicating state", async ({ page }) => {
  await page.goto("/?dev=1&mode=real&release=official-2026-06&layer=crime");
  await openTopMenu(page);
  await expect(page.getByRole("radio", { name: /Real/ })).toBeChecked();

  await page.goto("/?dev=1");
  await openTopMenu(page);
  await expect(page.getByRole("radio", { name: /Real/ })).toBeChecked();
  await expect(page.getByTestId("data-status")).toHaveText("Real data · official-2026-06");

  await closeTopMenu(page);
  await chooseLayer(page, "income");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "income");
  await expect(page.getByTestId("data-status")).toHaveText("Real data · official-2026-06");
});

test("stale responses never surface fixture values", async ({ page }) => {
  let heldDemo = 0;
  await page.route("**/api/v1/areas/**", async (route) => {
    const demo = new URL(route.request().url()).searchParams.get("mode") === "demo";
    if (demo) heldDemo += 1;
    try {
      const response = await route.fetch();
      await pause(demo ? 1200 : 300);
      await route.fulfill({ response });
    } finally {
      if (demo) heldDemo -= 1;
    }
  });

  await page.goto(DEMO_CRIME);
  await openTopMenu(page);
  await page.getByRole("radio", { name: /Real/ }).click();
  await expect(page.getByTestId("evidence-unavailable")).toBeVisible();
  await expect(page.getByTestId("data-status")).toHaveText("Real data · official-2026-06");
  await expect(page.getByTestId("evidence-panel")).not.toContainText("Westminster preview");
  // Every demo answer held back has now reached the page, and none surfaces.
  await expect.poll(() => heldDemo).toBe(0);
  await expectSteady(async () => {
    expect(await page.getByTestId("evidence-unavailable").isVisible()).toBe(true);
    expect(await page.getByTestId("evidence-panel").textContent()).not.toContain("Westminster preview");
  }, 500);
});

test("real-mode dead end names the onward path", async ({ page }) => {
  await page.goto(REAL_CRIME);
  const blocked = page.getByTestId("evidence-unavailable");
  await expect(blocked).toBeVisible();
  const onward = blocked.getByRole("link", { name: /how real data connects/i });
  await expect(onward).toHaveAttribute("href", "/guide/demo-vs-real");
  await onward.click();
  await expect(page).toHaveURL(/\/guide\/demo-vs-real$/);
  await page.getByTestId("guide-fine-print").locator("summary").click();
  await expect(page.getByTestId("real-data-docs")).toBeVisible();
});

test("conflicting requests reset to demo visibly on every surface", async ({ page }) => {
  await page.goto("/?dev=1&mode=real&release=preview-2026-09&selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("data-status")).toHaveText("Demo data · not for decisions · preview-2026-09");
  await openTopMenu(page);
  await expect(page.getByRole("radio", { name: /Demo/ })).toBeChecked();
  await expect(page.getByTestId("layer-notice")).toContainText("Conflicting data request");
});

// G25: area page sections report a wrong figure with "Looks wrong", which opens the correction form
// (v3 Fix 22: the one way to flag a figure; the 👍/👎 quick vote is gone).
test("the area page reports a wrong figure from each section", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  const sections = page.locator("section.area-section");
  await expect(sections.first()).toBeVisible();
  await expect(page.locator(".quick-vote")).toHaveCount(0);
  const reported = page.locator("section.area-section:has([data-testid=correction-report-open])");
  await expect(reported.first()).toBeVisible();
  const count = await reported.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await expect(reported.nth(index).getByTestId("correction-report-open"), `section ${index}`).toHaveText("Report");
  }
  const safety = page.getByTestId("evidence-section-safety");
  // r3 #7 (CUJ15 board): Report is in the title row (wrapping with it on a phone), above the section's body.
  const [body, report] = await Promise.all([safety.locator(".area-section__body").boundingBox(), safety.getByTestId("correction-report-open").boundingBox()]);
  expect(report!.y + report!.height).toBeLessThanOrEqual(body!.y + 1);
  await expect(safety.locator(".area-section__head").getByTestId("correction-report-open")).toHaveCount(1);
  await safety.getByTestId("correction-report-open").click();
  const form = safety.getByTestId("correction-report-form");
  await expect(form).toBeVisible();
  // The form names the figure it is about.
  await expect(form.getByTestId("correction-figure")).toHaveText(/^Safety · [\d,.]+ \/ 1,000( · London [\d,.]+)? · .+/);
  await expect(form.getByTestId("correction-observation-id")).toHaveText(/^uk:lsoa:E01000001:safety:/);
});
