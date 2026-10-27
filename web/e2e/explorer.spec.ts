import { areaReads, expect, expectSteady, pause, test } from "./fixtures";

import { backToArea, chooseLayer, openEvidenceSection, openLayerExplainer } from "./evidence";
import { addChip, addTravel, continueToReview, findMyArea, matchItem, typeBudget } from "./wizard";
import { openMapSettings, openMatchBuilder, openTopMenu, showTimeline } from "./top-bar";

test("operates every analytics layer and exposes its meaning", async ({ page }) => {
  await page.goto("/");
  const explorer = page.getByTestId("close-knit");
  await expect(explorer).toHaveAttribute("data-active-metric", "price-per-square-metre");

  // The legend's "?" carries the active layer's meaning (v3 Fix 12, 22.8: no About this data fold).
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);

  for (const metric of ["crime", "deprivation", "income", "social-renting", "price-per-square-metre"]) {
    await chooseLayer(page, metric);
    await expect(explorer).toHaveAttribute("data-active-metric", metric);
    const explainer = await openLayerExplainer(page);
    await expect(explainer.getByTestId("layer-explainer-line")).not.toBeEmpty();
    await explainer.getByTestId("layer-explainer-close").click();
  }
  await expect(page.getByTestId("about-this-data")).toHaveCount(0);
});

test("search selects an area and shows raw and comparative evidence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();

  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£");
  await expect(page).toHaveURL(/selected=uk%3Alsoa%3AE01000001/);
  // No separate map reading: the tiles say today's figures, on any month.
  await showTimeline(page); await page.getByLabel("Price period").press("Home");
  await expect(page.getByTestId("raw-value")).toHaveCount(0);
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£9,600/m²");
});

test("price timeline and pitch controls change observable map state", async ({ page }) => {
  await page.goto("/");
  const explorer = page.getByTestId("close-knit");
  await expect(page.getByLabel("Price period")).toHaveCount(0); await showTimeline(page); await page.getByLabel("Price period").press("Home");
  await expect(explorer).toHaveAttribute("data-active-period", "2006-06");

  await openMapSettings(page);
  await page.getByRole("button", { name: "Flatten map" }).click();
  await expect(explorer).toHaveAttribute("data-map-pitch", "0");
  await page.getByRole("button", { name: "Tilt map" }).click();
  await expect(explorer).toHaveAttribute("data-map-pitch", "45");
});

test("price evidence operates the period and explains its sample in £/m², without England claims", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");
  const explorer = page.getByTestId("close-knit");

  await showTimeline(page); await page.getByLabel("Price period").press("End");
  await expect(explorer).toHaveAttribute("data-active-period", "2026-06");
  await expect(page.getByTestId("raw-value")).toHaveCount(0);
  await page.getByLabel("Price period").press("Home");
  await expect(explorer).toHaveAttribute("data-active-period", "2006-06"); await backToArea(page);
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£9,600/m²");

  // v3 Fix 33a: the Price section reads in £/m² only, with no unit switch or year windows (one ten-year
  // line, market.spec.ts). The price sample is method: it reads in the section's one ⓘ fold, not behind a button.
  const price = await openEvidenceSection(page, "Price & market");
  await expect(price.getByTestId("section-headline-price")).toHaveText(/^£[\d,]+\/m²$/);
  await expect(page.getByRole("button", { name: /^Show prices per square (foot|metre)$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /year price history$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Explain this price sample" })).toHaveCount(0);
  await expect(page.getByTestId("price-sample-explanation")).toContainText(/matched sales .* LSOA level/);
  await expect(page.getByTestId("card-sources-price")).toContainText("Not published");
});

test("crime evidence gives offence types against London and a trend, not a single snapshot", async ({ page }) => {
  await page.goto("/?layer=crime&period=2026-06&selected=uk%3Alsoa%3AE01000001");
  const safety = await openEvidenceSection(page, "Living here");

  // v3 Fix 33.2: the top offence types, each with a London tick; the three-year line only when the rate
  // moved 15% or more (area-v3.spec.ts draws that case), otherwise a row says it held steady.
  await expect(safety.getByTestId("safety-types")).toContainText("Violence and sexual offences");
  await expect(safety.getByTestId("rate-row").first().locator(".share-row__tick")).toHaveCount(1);
  await expect(safety.getByTestId("crime-stable")).toContainText("Stable over 3 years");
  await expect(safety.getByTestId("metric-history-chart")).toHaveCount(0);
});

test("deep links restore the selected layer, period, and area", async ({ page }) => {
  await page.goto(
    "/?layer=price-per-square-metre&period=2024-06&selected=uk%3Alsoa%3AE01000001&pitch=45",
  );

  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-period", "2024-06");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
});

test("mobile presents selected evidence as a bottom sheet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only layout check");
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");

  // The evidence lives in the dock, a sheet fixed to the bottom edge.
  const dock = page.getByTestId("map-dock");
  await expect(dock).toHaveCSS("position", "fixed");
  await expect(dock.getByTestId("evidence-panel")).toBeVisible();
  // The sheet slides up to its rest (its half grows to fit the peek): measure where it settles.
  const viewport = page.viewportSize();
  await expect.poll(async () => { const box = await dock.boundingBox(); return Math.round((box?.y ?? 0) + (box?.height ?? 0)); }).toBe(viewport?.height);
  await expect(page.getByTestId("map-canvas")).toBeVisible();
});

test("cancelled evidence requests do not surface unhandled errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let held = 0;
  await page.route("**/api/v1/areas/**", async (route) => {
    held += 1;
    try {
      await pause(100);
      await route.continue();
    } finally {
      held -= 1;
    }
  });

  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await chooseLayer(page, "crime");
  await chooseLayer(page, "income");
  // Every held request has been let go (the cancelled ones too), and none surfaced an error.
  await expect.poll(() => held).toBe(0);
  await expectSteady(() => expect(pageErrors).toEqual([]), 250);
});

test.describe("with the service worker", () => {
  test.use({ serviceWorkers: "allow" });

  test("registers an installable offline app shell", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "WebKit cannot navigate while context-level offline mode is active");
    await page.goto("/");

    await expect.poll(
      () => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active)),
    ).toBeTruthy();
    await page.reload();
    await page.context().setOffline(true);
    await page.goto("/guide");
    await expect(page.getByRole("heading", { name: "Map guide" })).toBeVisible();
  });
});

test("builds and adjusts a personal match instead of merely displaying controls", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  await typeBudget(page, "700000");
  await addChip(page, "safer-streets");

  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "personal-match");
  const rows = page.getByTestId("match-top").getByTestId("match-row");
  await expect(rows.first()).toBeVisible();
  const before = await rows.allTextContents();
  // Safer streets out, Price per m² (Any layer) in: the ranking follows.
  // The row's × (board "Your order rows"): no card to open first.
  await matchItem(page, "range:crime").getByTestId("match-item-remove").click();
  await findMyArea(page).getByTestId("chip-any-layer").click();
  await page.getByTestId("any-layer-menu").getByRole("button", { name: "Price per m²", exact: true }).click();
  await expect(matchItem(page, "range:price-per-square-metre")).toBeVisible();
  await expect.poll(() => rows.allTextContents()).not.toEqual(before);
});

test("budget and the place you travel to change match results", async ({ page, isMobile }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  await typeBudget(page, "450000");
  await addChip(page, "safer-streets");
  const scores = page.getByTestId("match-top").getByTestId("match-score");
  await expect(scores.first()).toBeVisible();
  const cheapBudget = await scores.allTextContents();

  await typeBudget(page, "700000");
  await expect(matchItem(page, "affordability")).toContainText("£700k");
  await expect.poll(() => scores.allTextContents()).not.toEqual(cheapBudget);

  // A picked place ranks by journey time: the area's card says the minutes to it.
  await addTravel(page, "Westminster", /Westminster preview station/);
  await expect(page.locator('[data-testid="match-item"][data-id^="place:"]')).toContainText("Westminster preview station ≤ 35");
  await page.getByTestId("match-top").getByTestId("match-row").first().locator(".match-row__main").click();
  await expect(page.getByTestId("area-view").filter({ visible: true })).toContainText(isMobile ? /\S/ : "Westminster preview station", { timeout: 30_000 });
});

test("failed journey routing is contained without an unhandled error", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/v1/commute", (route) => route.abort("failed"));
  await page.goto("/");
  await openMatchBuilder(page);
  await typeBudget(page, "650000");
  await addTravel(page, "Waterloo", /Waterloo preview station/);
  await page.getByTestId("match-top").getByTestId("match-row").first().locator(".match-row__main").click();
  await expect(page.getByTestId("area-view").filter({ visible: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("operates rent, a place, schools and explicit sharing", async ({ page, context }) => {
  // WebKit knows no clipboard permission names; the read assertion below
  // still fails loudly there if the grant did nothing on Chromium.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await page.goto("/");
  await openMatchBuilder(page);
  await findMyArea(page).getByRole("group", { name: "Buy or rent" }).getByRole("button", { name: "Rent" }).click();
  await typeBudget(page, "2000");
  await addTravel(page, "Highbury", /Highbury preview station/);
  const place = page.locator('[data-testid="match-item"][data-id^="place:"]');
  await place.getByTestId("match-chip").click();
  await page.getByRole("button", { name: /^By transit, change$/ }).click();
  await page.getByRole("group", { name: "How you get there" }).getByRole("button", { name: "bike", exact: true }).click();
  await addChip(page, "good-schools");
  expect(new URL(page.url()).hash).toBe("");
  await page.getByTestId("share-search").click();
  const review = page.getByRole("dialog", { name: "Review before sharing" });
  await expect(review).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await review.getByRole("button", { name: "Cancel share" }).click();
  await expect(review).toBeHidden();
  expect(new URL(page.url()).hash).toBe("");
  await page.getByTestId("share-search").click();
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Confirm share" }).click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#profile=v3\./);
  const shared = await page.evaluate(() => navigator.clipboard.readText()); // the search only, no map position
  expect(new URL(shared).hash).toBe(new URL(page.url()).hash); expect(shared).not.toMatch(/lat=|zoom=/);
  await page.goto(shared);
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#profile=v3\./);
  await expect(page.getByTestId("shared-banner")).toContainText("Rent up to £2,000 a month");
  await expect(page.locator('[data-testid="match-item"][data-id^="place:"]')).toContainText("Highbury preview station");
  await expect(matchItem(page, "range:schools")).toBeVisible();
});

test("sharing a profile survives clipboard denial", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
    });
  });
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  await page.getByTestId("share-search").click();
  const review = page.getByRole("dialog", { name: "Review before sharing" });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Confirm share" }).click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#profile=v3\./);
  await expectSteady(() => expect(pageErrors).toEqual([]), 250);
  const denied = page.url();
  await page.goto(denied);
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#profile=v3\./);
});

test("real-mode deep link forwards mode and release on every evidence request", async ({ page }) => {
  const evidenceRequests: string[] = [];
  page.on("request", (request) => {
    // Carrier geometry is release-independent (real mode never draws fixture polygons). On their own or in a
    // section batch.
    for (const url of areaReads(request)) {
      if (url.includes("/api/v1/areas/") && !url.includes("/api/v1/areas/boxes")) evidenceRequests.push(url);
    }
  });

  await page.goto("/?mode=real&release=official-2026-06&layer=crime&selected=uk%3Alsoa%3AE01000001");
  await expect.poll(() => evidenceRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("selected-area")).not.toBeEmpty();

  await expectSteady(() => {
    for (const url of evidenceRequests) {
      const parameters = new URL(url).searchParams;
      expect(parameters.get("mode"), url).toBe("real");
      expect(parameters.get("release"), url).toBe("official-2026-06");
    }
  }, 500);
});

test("pointer and keyboard users can switch the data mode", async ({ page }) => {
  // The data mode switch is an internal: ?dev=1.
  await page.goto("/?dev=1");
  await openTopMenu(page);
  const group = page.getByRole("group", { name: "Data mode" });
  await expect(group).toBeVisible();
  await expect(page.getByRole("radio", { name: /Demo/ })).toBeChecked();

  await page.getByRole("radio", { name: /Real/ }).click();
  await expect(page.getByRole("radio", { name: /Real/ })).toBeChecked();
  await expect(page).toHaveURL(/mode=real/);
  await expect(page.getByTestId("data-mode-release")).toHaveText("Release official-2026-06");
  await expect(page.getByTestId("layer-notice")).toContainText("Real data");

  await page.getByRole("radio", { name: /Real/ }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: /Demo/ })).toBeChecked();
  await expect(page).toHaveURL(/mode=demo/);
});

test("a delayed demo response is ignored after switching mode", async ({ page }) => {
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

  await page.goto("/?dev=1&layer=crime&period=2026-06&selected=uk%3Alsoa%3AE01000001");
  await openTopMenu(page);
  await page.getByRole("radio", { name: /Real/ }).click();
  await expect(page.getByTestId("evidence-unavailable")).toBeVisible();
  await expect(page.getByTestId("evidence-panel")).not.toContainText("Westminster preview");
  // Every demo answer held back has now reached the page, and none surfaces.
  await expect.poll(() => heldDemo).toBe(0);
  await expectSteady(async () => {
    expect(await page.getByTestId("evidence-unavailable").isVisible()).toBe(true);
    expect(await page.getByTestId("evidence-panel").textContent()).not.toContain("Westminster preview");
  }, 500);
});

// Every shipped layer is published in the real pilot (crime, price, deprivation,
// income, social renting), so there is no unavailable layer to exercise here;
// the guard stays covered by tests/real-demo-separation.test.ts with a
// synthetic layer id. Re-enable with the next unpublished layer.
const NO_UNPUBLISHED_REAL_LAYER = true;

test("selecting an unavailable real layer performs no evidence request", async ({ page }) => {
  test.skip(NO_UNPUBLISHED_REAL_LAYER, "no unpublished real layer to exercise");
  const incomeRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/v1/areas/") && new URL(url).searchParams.get("metric") === "income") {
      incomeRequests.push(url);
    }
  });

  await page.goto("/?mode=real&release=official-2026-06&layer=crime&selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).not.toBeEmpty();
  await chooseLayer(page, "income");
  await expect(page.getByTestId("layer-notice")).toContainText("official-2026-06");
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
  await expectSteady(() => expect(incomeRequests).toEqual([]), 500);
});

test("unavailable real layers start no map value-pack request", async ({ page }) => {
  test.skip(NO_UNPUBLISHED_REAL_LAYER, "no unpublished real layer to exercise");
  const incomePacks: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/value-packs/income/")) incomePacks.push(request.url());
  });

  await page.goto("/?mode=real&release=official-2026-06&layer=income");
  await expect(page.getByText("Map ready")).toBeVisible();
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("evidence-unavailable")).toBeVisible();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "income");
  await expectSteady(() => expect(incomePacks).toEqual([]), 500);
});

test("lost evidence connections stay explicit instead of falling back silently", async ({ page }) => {
  await page.goto("/?layer=crime&period=2026-06&selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).not.toBeEmpty();

  await page.route("**/api/v1/areas/**", (route) => route.abort("failed"));
  await chooseLayer(page, "price-per-square-metre");
  await expect(page.getByTestId("evidence-offline")).toBeVisible();
  await expect(page.getByTestId("evidence-unavailable")).toBeVisible();
});

test("real mode rejects fixture payloads with an explicit unavailable state", async ({ page }) => {
  let held = 0;
  await page.route("**/api/v1/areas/**", async (route) => {
    held += 1;
    try {
      const response = await route.fetch();
      await pause(600);
      await route.fulfill({ response });
    } finally {
      held -= 1;
    }
  });

  await page.goto("/?mode=real&release=official-2026-06&layer=crime&selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("evidence-unavailable")).toBeVisible();
  await expect(page.getByTestId("evidence-panel")).not.toContainText("Westminster preview");
  await expect(page.getByTestId("evidence-panel")).not.toContainText("preview-2026-09");
  // Every answer held back has now reached the page: still unavailable, still no fixture values.
  await expect.poll(() => held).toBe(0);
  await expectSteady(async () => {
    expect(await page.getByTestId("evidence-unavailable").isVisible()).toBe(true);
    expect(await page.getByTestId("evidence-panel").textContent()).not.toContain("Westminster preview");
  }, 500);
  // Real mode also asks for carrier geometry (never fixture polygons); a delayed reply may outlive the test.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/** The score tabs sit behind a fold in the selected-area panel; open it once (idempotent). */
