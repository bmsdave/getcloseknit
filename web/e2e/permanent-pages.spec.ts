import { expect, test } from "./fixtures";

import { chooseLayer, openEvidenceSection } from "./evidence";
import { openTopMenu } from "./top-bar";

// Permanent area and postcode pages are the shareable, crawlable entry points:
// they must open on the right area with the deployment's mode, and unknown
// ids must be an honest 404 rather than an empty map.
test("a permanent area page is the full area page, one click from the map", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  await expect(page).toHaveTitle(/St James's · SW1A/);
  await expect(page.getByTestId("area-full-page")).toBeVisible();
  await expect(page.getByTestId("area-page-title")).toContainText(/St James's|Westminster/);
  await expect(page.getByTestId("open-on-map")).toHaveAttribute("href", /\/\?selected=uk%3Alsoa%3AE01000001/);
});

test("an old area link with map settings still opens the map on that area", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001?layer=crime");
  await expect(page).toHaveURL(/\/\?.*selected=uk%3Alsoa%3AE01000001/);
  await expect(page).toHaveURL(/[?&]layer=crime/);
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "crime");
});

test("unknown or malformed area ids are 404s", async ({ request }) => {
  expect((await request.get("/area/lsoa/E01999999")).status()).toBe(404);
  expect((await request.get("/area/street/E01000001")).status()).toBe(404);
});

test("a postcode page lists every recorded sale with its numbers and links the area", async ({ page }) => {
  await page.goto("/postcode/sw1a-1ab");
  await expect(page).toHaveTitle(/SW1A 1AB/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SW1A 1AB");

  // The infographics answer "what are homes like and what do they cost" first.
  await expect(page.getByTestId("postcode-typical-price")).toContainText("£");
  await expect(page.getByTestId("postcode-last-sale")).toContainText("£");
  await expect(page.getByTestId("postcode-sales-chart").getByTestId("postcode-sale-dot").first()).toBeAttached();
  await expect(page.getByTestId("postcode-compare")).toBeVisible();
  await expect(page.getByTestId("postcode-mix")).toBeVisible();
  // An honest headline: never a middle of every sale since the 1990s; one Sources fold at the foot.
  await expect(page.getByTestId("postcode-hero")).not.toContainText("Every sale since");
  await expect(page.getByTestId("postcode-sources")).toHaveCount(1);
  // Three chart panels, "Is the asking price fair?" (#16) and the borough's private rents.
  // PR #128 (v4.3 homes pages): Homes here at the top is a panel too.
  await expect(page.locator(".postcode-panel h2")).toHaveCount(6);
  await expect(page.locator(".postcode-panel h2", { hasText: /^Private rents in / })).toHaveCount(1);
  await expect(page.locator(".postcode-panel h2", { hasText: "Is the asking price fair?" })).toHaveCount(1);

  // Sales are grouped by building, folded below the charts; the shared disclaimer is said once, at the top.
  const building = page.getByTestId("postcode-building").first();
  await expect(building).toContainText("10 Sample Street");
  await building.locator("summary").click();
  await expect(building.getByRole("table")).toContainText("£570,000");
  await expect(building.getByRole("table")).toContainText("3 Nov 2022");
  await expect(page.getByTestId("postcode-disclaimer")).toContainText("not valuations or asking prices");
  await expect(page.getByTestId("postcode-disclaimer")).toHaveCount(1);
  await expect(building).not.toContainText("not valuations or asking prices");

  await page.getByTestId("postcode-area-link").click();
  await expect(page).toHaveURL(/\/area\/lsoa\/E01000001/);
  await expect(page.getByTestId("area-page-title")).toContainText(/St James's|Westminster/);
});

test("a postcode with no recorded sales still resolves to its area; nonsense is a 404", async ({ page, request }) => {
  await page.goto("/postcode/SW1A-1AA");
  await expect(page.getByTestId("postcode-page")).toContainText("No recorded sales");
  await expect(page.getByTestId("postcode-area-link")).toHaveAttribute("href", /E01000001$/);
  await expect(page.getByTestId("postcode-area")).not.toContainText("LSOA");
  expect((await request.get("/postcode/not-a-postcode")).status()).toBe(404);
  // A copied link with an encoded space is the same page.
  expect((await request.get("/postcode/SW1A%201AA")).status()).toBe(200);
});

test("evidence charts show their numbers, not just a line", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");
  await openEvidenceSection(page, "Price & market");
  const chart = page.getByTestId("market-trend-price");
  await expect(chart.getByRole("img")).toHaveAccessibleName(/Typical sale price by type of home from .+ to .+\. All homes latest £/);
  await chart.getByText("Show the numbers").click();
  await expect(chart.locator(".market-table tbody tr").first()).toContainText("£");

  // Crime by type: each rate in words beside its bar and London's tick.
  const safety = await openEvidenceSection(page, "Living here");
  await expect(safety.getByTestId("rate-row").first().locator(".share-row__value")).toHaveText(/^\d+\.\d$/);
});

test("llms.txt tells agents where the pages and the structured data are", async ({ request }) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const body = await response.text();
  expect(body).toContain("/area/{lsoa|msoa|borough}/{code}");
  expect(body).toContain("/postcode/{POSTCODE}");
  // The JSON endpoints beyond /api/v1/metrics are listed only with an evidence API (lib/llms-txt.ts hasApi);
  // the test server has none.
  expect(body).toContain("/api/v1/metrics");
  expect(body).toContain("/agents");
});

test("the AI agents page (the old /claude) gives the connector URL, the command and the skill", async ({ page }) => {
  await page.goto("/");
  await openTopMenu(page);
  await expect(page.getByTestId("top-menu").getByRole("link", { name: "AI agents" })).toHaveAttribute("href", "/agents");
  await page.goto("/claude");
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByTestId("agents-mcp-url")).toHaveText(/\/mcp$/);
  await expect(page.getByRole("link", { name: /find-a-home\.zip/ })).toHaveAttribute("href", "/downloads/find-a-home.zip");
  await page.goto("/agents/claude-code");
  await expect(page.getByTestId("agents-claude-command")).toContainText("claude mcp add --transport http close-knit");
});

// House-level map: parcels appear for the £/m² layers from zoom 14 and a
// selected dwelling shows its last recorded sale, never a value for the home.
test("the price layer carries a parcel map and a selected house shows its recorded sale", async ({ page }) => {
  await page.goto("/?diagnostics=1&selected=uk%3Alsoa%3AE01000001");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect.poll(() => page.evaluate(() => window.__closeKnitDiagnostics?.layerIds() ?? []))
    .toEqual(expect.arrayContaining(["block-fill", "parcel-fill", "parcel-outline", "dwelling-point"]));
  await expect(page.getByTestId("map-tooltip")).toBeHidden();
  // Licence statements travel with the parcels: absent at the London overview zoom.
  await expect(page.getByTestId("parcel-attribution")).toHaveCount(0);

  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
  // The brief's home line: the last recorded sale and a link to the area's prices on the home's page.
  const home = page.getByTestId("brief-home");
  await expect(home).toContainText("1 Parliament Preview");
  await expect(home.getByTestId("brief-home-sale")).toContainText("Last sold £570,000");
  await expect(home).not.toContainText(/£668|confidence|Estimate/);

  // Old stock-value links open the price layer; it is not a chip of its own.
  await expect(page.getByTestId("layer-stock-value-per-square-metre")).toHaveCount(0);
  // …and present once the map is at parcel zoom on a £/m² layer.
  await page.goto("/?layer=price-per-square-metre&zoom=16&lat=51.501&lng=-0.1416");
  await expect(page.getByTestId("parcel-attribution")).toContainText("HM Land Registry");
  await expect(page.getByTestId("parcel-attribution")).toContainText("Ordnance Survey 100026316");
  // The explanation of the outlines sits behind the (?); the licence text stays visible.
  await page.getByRole("button", { name: "About land outlines" }).click();
  await expect(page.getByTestId("help-parcel-licence")).toContainText("plot of land");
  // Closed again before the next control: on a phone the open note sits over the Layers button.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("help-parcel-licence")).toBeHidden();
  await chooseLayer(page, "crime");
  await expect(page.getByTestId("map-legend")).toContainText("Crimes per 1,000");
});
