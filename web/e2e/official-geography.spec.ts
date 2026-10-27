import { expect, expectSteady, pause, test } from "./fixtures";
// The map's brief has no sections, so nothing below needs folding first.
// AE-03 official-geography pilot journey: a multipart area is selectable,
// its parent is reachable, its official code is searchable, and the link
// survives a reload. Live runs need the isolated Playwright server; in a
// sandboxed session this spec is verified statically (selectors and routes
// below match committed components and API routes).

test("official code search selects the area and keeps it on reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("E01000001");
  await page.getByRole("option", { name: /Westminster, London/ }).click();

  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page).toHaveURL(/selected=uk%3Alsoa%3AE01000001/);

  await page.reload();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page).toHaveURL(/selected=uk%3Alsoa%3AE01000001/);
});

test("committing a search result does not reopen suggestions", async ({ page }) => {
  const searches: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/search")) searches.push(request.url());
  });

  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByRole("combobox", { name: "Search", exact: true })).toHaveValue("SW1A 1AA");
  await expect(page.getByRole("listbox", { name: "Search results" })).toHaveCount(0);
  const committedSearches = searches.length;
  await expectSteady(() => expect(searches.length).toEqual(committedSearches), 600);

  await page.getByRole("combobox", { name: "Search", exact: true }).fill("WC1A");
  await page.getByRole("option", { name: /WC1A 1AA.*North London/ }).press("Enter");
  await expect(page.getByTestId("selected-area")).toContainText("Highbury · N5");
  await expect(page.getByRole("listbox", { name: "Search results" })).toHaveCount(0);
  const recommittedSearches = searches.length;
  await expectSteady(() => expect(searches.length).toEqual(recommittedSearches), 600);
});

test("every dismissal path closes results and resets combobox state", async ({ page }) => {
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  const listbox = page.getByRole("listbox", { name: "Search results" });

  async function expectDismissed() {
    await expect(listbox).toHaveCount(0);
    await expect(search).toHaveAttribute("aria-expanded", "false");
    expect(await search.getAttribute("aria-activedescendant")).toBeNull();
  }

  await page.goto("/");
  await search.fill("SW1A");
  await expect(listbox).toBeVisible();
  await search.press("Escape");
  await expectDismissed();

  await search.fill("");
  await search.fill("SW1A");
  await expect(listbox).toBeVisible();
  await page.getByTestId("map-canvas").click({ position: { x: 10, y: 10 } });
  await expectDismissed();

  await search.fill("");
  await search.fill("SW1A");
  await expect(listbox).toBeVisible();
  await search.evaluate((element) => element.blur());
  await expectDismissed();

  await search.fill("");
  await search.fill("SW1A");
  await expect(listbox).toBeVisible();
  await search.press("ArrowDown");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
});

test("a late search response cannot reopen dismissed results", async ({ page }) => {
  let held = 0;
  await page.route("**/api/v1/search**", async (route) => {
    held += 1;
    try {
      const response = await route.fetch();
      await pause(600);
      await route.fulfill({ response });
    } finally {
      held -= 1;
    }
  });

  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  const listbox = page.getByRole("listbox", { name: "Search results" });
  await search.fill("SW");
  await expect(listbox).toBeVisible();
  await search.fill("SW1A");
  await search.press("Escape");
  await expect(listbox).toHaveCount(0);
  // The late answers have all arrived, and the results stay closed.
  await expect.poll(() => held).toBe(0);
  await expectSteady(async () => {
    expect(await listbox.count()).toBe(0);
    expect(await search.getAttribute("aria-activedescendant")).toBeNull();
  }, 300);
});

test("selecting a result moves focus to the selected-area heading", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  await expect(page.getByTestId("selected-area")).toBeFocused();
  await expect(page.getByRole("listbox", { name: "Search results" })).toHaveCount(0);

  await page.getByRole("combobox", { name: "Search", exact: true }).fill("WC1A");
  await page.getByRole("option", { name: /WC1A 1AA.*North London/ }).press("Enter");
  await expect(page.getByTestId("selected-area")).toBeFocused();
  await expect(page.getByRole("listbox", { name: "Search results" })).toHaveCount(0);
});

test("parent navigation moves selection up the published hierarchy", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&diagnostics=1");
  const debug = () => page.evaluate(() => window.__closeKnitDiagnostics?.debug() as
    { bounds: [[number, number], [number, number]]; widerAreaRendered: number } | undefined);

  // The wider areas sit over the title as breadcrumbs from London down (v4 Task 12), named, not in "About this data".
  const breadcrumb = page.getByTestId("wider-areas");
  // One naming source with the area page (v4.4): "London › Westminster › St James's", the group named like
  // the area left out, never a generic "the wider neighbourhood" or another district.
  await expect(breadcrumb).toHaveText(/^London\s*Westminster\s*St James's$/);
  await expect(page.getByTestId("about-this-data")).toHaveCount(0);
  await expect(page.getByTestId("view-parent-area")).toHaveCount(0);

  await page.getByTestId("view-borough").click();
  await expect(page).toHaveURL(/selected=uk%3Alad%3AE09000001/);
  await expect(page.getByTestId("about-this-data")).toHaveCount(0);
  // The map outlines the borough it does not fill and brings it into view.
  await expect.poll(async () => (await debug())?.widerAreaRendered ?? 0).toBeGreaterThan(0);
  // Its panel has a real figure in words, never "unknown" (v4 Task 12: no price for a home).
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).toContainText("£");
  await expect(page.getByTestId("evidence-panel").getByTestId("area-tile-price")).not.toContainText(/unknown|Loading/);
});

test("the map's areas come as vector tiles only, with stable identifiers", async ({ request }) => {
  // Demo data's tiles (lib/demo-area-tiles.ts; tests/demo-area-tiles.test.ts decodes them: multipart islands kept).
  const tile = await request.get("/api/v1/tiles/areas/a0-000000000000/lsoa/10/511/340.mvt");
  expect(tile.status()).toBe(200);
  expect(tile.headers()["content-type"]).toBe("application/vnd.mapbox-vector-tile");
  expect((await tile.body()).length).toBeGreaterThan(0);
  // No GeoJSON of the areas anywhere: not in the test style, not from a geometry route.
  const style = await (await request.get("/api/v1/style")).json();
  expect(Object.values(style.sources).filter((source) => (source as { type: string }).type === "geojson" &&
    JSON.stringify(source).includes("geography_id"))).toEqual([]);
  expect((await request.get("/api/v1/areas/geometry?carrier=lsoa")).headers()["content-type"] ?? "").not.toContain("geo+json");

  const area = await request.get("/api/v1/areas/uk%3Alsoa%3AE01000001?metric=crime&period=2026-06");
  expect(await area.json()).toMatchObject({
    summary: { geographyId: "uk:lsoa:E01000001" },
    parentId: "uk:msoa:E02000001",
  });
});
