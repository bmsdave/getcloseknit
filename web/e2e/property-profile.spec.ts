import { expect, test, type Page } from "./fixtures";

// Track K: the shareable property page and the postcode home list (demo fixtures).

async function unstyledButtons(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll("button")]
    .filter((button) => button.getClientRects().length > 0)
    .filter((button) => ["outset", "inset"].includes(getComputedStyle(button).borderTopStyle))
    .map((button) => button.textContent?.trim() ?? ""));
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test("a property page shows its area's prices today and its recorded sales, never a figure for the home", async ({ page }) => {
  await page.goto("/property/100000000001");
  await expect(page).toHaveTitle(/10 Sample Street/);
  const card = page.getByTestId("area-prices");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Prices in this area today");
  await expect(card.getByTestId("area-prices-range"))
    .toHaveText("Flats here: most sell for £520k–£760k (middle half of 41 sales since 2023, adjusted to Jun 2026)");
  await expect(card.getByTestId("area-prices-area")).toHaveText("Sales in this neighbourhood: St James's · SW1A");
  await expect(card.getByTestId("area-prices-chart")).toHaveAttribute("data-highlight", "upper-middle");
  await expect(card.getByTestId("area-prices-position"))
    .toHaveText("When this home sold in November 2022, its price was in the upper middle of flat sales in this area that year.");
  await expect(card.getByTestId("area-prices-bridge")).toHaveText("Today, the upper middle of flat sales here are £620k–£760k.");
  await expect(card.getByTestId("area-prices-footer"))
    .toHaveText("About this area's sales, not a valuation of this home. It can't see condition or improvements.");
  await expect(card.getByTestId("area-prices-guide")).toHaveAttribute("href", "/guide/typical-price");
  const body = page.getByTestId("property-page");
  for (const word of [/Estimated price/i, /\bworth\b/i, /would be around/i, /~£/, /Now ~/, /(High|Medium|Low) confidence/]) await expect(body).not.toContainText(word);
  await expect(page.getByTestId("property-estimate")).toHaveCount(0);
  await expect(page.getByTestId("property-local")).toHaveCount(0);

  const sales = page.getByTestId("property-sales");
  await expect(sales.getByRole("heading", { level: 2 })).toHaveText("Recorded sales");
  await expect(sales.getByTestId("sale-source").first()).toHaveAttribute("href", /^https:\/\/landregistry\.data\.gov\.uk\/data\/ppi\/transaction\//);
  const facts = page.getByTestId("property-facts");
  await expect(facts).toContainText("Middle floor");
  await expect(facts.getByTestId("property-energy").getByRole("img")).toHaveAttribute("aria-label", "Energy rating: C now, B potential");
  await expect(facts).toContainText("1900-1929");
  await expect(page.getByTestId("property-sales")).toContainText("15 Jun 2006");
  // The area's Price section reads the address's and its neighbours' sales in the browser: wait for them,
  // so the check covers their dates too (shown as words; ISO only in dateTime).
  await page.getByTestId("home-area-sections").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("nearby-sales").locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId("address-history").locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId("property-page")).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  await expect(page.getByTestId("property-page")).not.toContainText("category A");

  // r3 #28: one primary action (Check this home); the map, Share, Report and the area page sit in ⋯.
  await expect(page.locator(".property-actions .property-button--primary")).toHaveCount(1);
  await expect(page.getByTestId("google-maps-link")).toBeVisible();
  await page.getByTestId("property-more").locator("summary").click();
  await expect(page.getByTestId("property-map-link")).toBeVisible();
  await expect(page.getByTestId("property-area-link")).toHaveAttribute("href", /^\/area\//);
  await expect(page.getByTestId("google-maps-link")).toHaveAttribute("href", /google\.com\/maps\/search\/.*51\.501/);
  await expect(page.getByTestId("street-view-link")).toHaveAttribute("href", /map_action=pano/);
  expect(await unstyledButtons(page)).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

/**
 * One mini map: on a phone (≤560px) after the price block, so the price stays in the first screen;
 * on a desktop inside the header's box, beside the address (ruling 2026-10-18).
 */
async function expectMiniMapPlace(page: Page) {
  const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
  const [map, header, price, facts] = await Promise.all(["home-mini-map", "home-header", "home-price", "home-facts"].map(box));
  if (page.viewportSize()!.width <= 560) {
    expect(map.y).toBeGreaterThanOrEqual(price.y + price.height);
    expect(map.y + map.height).toBeLessThanOrEqual(facts.y);
  } else {
    expect(map.x).toBeGreaterThanOrEqual(header.x);
    expect(map.y).toBeGreaterThanOrEqual(header.y);
    expect(map.x + map.width).toBeLessThanOrEqual(header.x + header.width + 0.5);
    expect(map.y + map.height).toBeLessThanOrEqual(header.y + header.height + 0.5);
  }
}

// Home blocks 1–5, the same view for a sold home and a street-level home with no recorded sale.
const HOME_BLOCKS = ["home-header", "home-price", "home-facts", "home-sales", "home-other-homes"];
for (const [kind, path] of [["a sold home", "/property/100000000001"], ["a street-level home", "/property/at/W5-1LR/120-meadvale-road"]]) {
  test(`${kind} shows the home blocks in order: header, price, about, sales, other homes`, async ({ page }) => {
    await page.goto(path);
    for (const id of HOME_BLOCKS) await expect(page.getByTestId(id)).toBeVisible();
    const tops = await Promise.all(HOME_BLOCKS.map(async (id) => (await page.getByTestId(id).boundingBox())!.y));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    const header = page.getByTestId("home-header");
    await expect(header.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(header.getByTestId("breadcrumbs")).toBeVisible();
    await expect(header.getByRole("button", { name: "Save this home" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Watch", exact: true })).toBeVisible();
    await header.getByTestId("property-more").locator("summary").click();
    for (const id of ["property-share", "property-report-link", "property-map-link"]) await expect(header.getByTestId(id)).toBeVisible();
    await header.getByTestId("property-more").locator("summary").click();
    // The mini map: MapLibre may not draw in a headless browser, so check the box and its layer switch.
    const map = page.getByTestId("home-mini-map");
    await expect(map).toBeVisible();
    await expect(map.getByTestId("google-maps-link")).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    await expect(map.getByTestId("street-view-link")).toHaveAttribute("href", /map_action=pano&viewpoint=/);
    await expect(page.getByTestId("home-mini-map")).toHaveCount(1);
    await expectMiniMapPlace(page);
    const layer = map.getByRole("combobox", { name: "Map layer" });
    await expect(layer.locator("option")).toHaveText(["Price", "Crime", "Deprivation", "Income", "Social housing"]);
    await layer.selectOption({ label: "Crime" });
    await expect(map).toHaveAttribute("data-href", /^\/\?selected=uk%3Alsoa%3AE\d{8}&layer=crime$/);
    // The map's click, for keyboards.
    await expect(map.getByRole("link", { name: "Open this layer on the map" })).toHaveAttribute("href", /^\/\?selected=uk%3Alsoa%3AE\d{8}&layer=crime$/);
    // A 44px target (DESIGN.md §7).
    expect((await map.getByTestId("home-mini-map-open").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Where WebGL runs (the desktop project), the layer paints; headless phones may have none.
    if (test.info().project.name === "desktop") await expect.soft(map).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
}

// Flood on a home page: its own EA band, else its postcode's homes' worst, else its area's land, said as such.
for (const [kind, path, term, value] of [
  ["a sold home", "/property/100000000001", "Flood, this home", "rivers and sea: low · surface water: very low"],
  // W5 1LR's demo homes have no UPRN, so no bands: the area's, never called the home's.
  ["a street-level home", "/property/at/W5-1LR/120-meadvale-road", "Flood, this area's highest band", "rivers and sea: medium · surface water: high"],
]) {
  test(`${kind}'s flood row says whose band it is`, async ({ page }) => {
    await page.goto(path);
    const sections = page.getByTestId("home-area-sections");
    await sections.scrollIntoViewIfNeeded();
    const row = sections.getByTestId("evidence-section-environment").getByTestId("flood-bands");
    await expect(row.locator("dt")).toContainText(term, { timeout: 15_000 });
    await expect(row.getByTestId("flood")).toHaveText(value);
  });
}

// The flood row is in the server's HTML of a UPRN page (indexed; the area's sections are seeded), not
// added after hydration. Street pages load their sections in the browser by design.
test("a UPRN page's server HTML has the home's flood row", async ({ request }) => {
  const html = await (await request.get("/property/100000000001")).text();
  expect(html).toContain('data-testid="flood-bands"');
  expect(html).toContain("Flood, this home</dt>");
  expect(html).toContain('<dd data-testid="flood">rivers and sea: low · surface water: very low</dd>');
});

test("the street-level home has no recorded sale, area prices by type, and links to its postcode's homes", async ({ page }) => {
  await page.goto("/property/at/W5-1LR/120-meadvale-road");
  await expect(page.getByTestId("home-sales")).toContainText("No recorded sale");
  await expect(page.getByTestId("home-price").getByRole("heading", { level: 2 }).first()).toHaveText("Prices in this area today");
  await expect(page.getByTestId("area-price-ranges")).toContainText("Flat");
  await expect(page.getByTestId("home-facts")).toContainText("Type");
  await expect(page.getByTestId("home-other-homes").getByTestId("postcode-homes-link")).toHaveAttribute("href", "/postcode/W5-1LR/homes");
  await expect(page.getByTestId("home-other-homes")).toContainText("116 Meadvale Road");
  await expect(page.getByTestId("property-page")).not.toContainText(/worth|estimated price|would be around/i);
});

test("the property page links out to the portals' listing photos, like the map card, and hosts none", async ({ page }) => {
  await page.goto("/property/100000000001");
  const listings = page.getByTestId("property-listings");
  await expect(listings.getByRole("heading", { level: 2 })).toHaveText("View listing photos");
  const portals = listings.getByRole("link");
  await expect(portals).toHaveText([/Rightmove/, /Zoopla/, /OnTheMarket/]);
  await expect(portals.first()).toHaveAttribute("href", "https://www.rightmove.co.uk/house-prices/sw1a-1ab.html");
  for (const link of await portals.all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(listings).toContainText("Links to the portals; Close Knit doesn't host listings.");
  await expect(listings.getByRole("img")).toHaveCount(0);
  await expect(listings).not.toContainText(/£|m²|worth|Estimated/);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

for (const size of [{ width: 1280, height: 720 }, { width: 375, height: 812 }]) {
  test(`the property page opens on its area's prices at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/property/100000000001");
    // The area's range sits in the first screen (owner, 2026-10-11), on a phone too, under the mini map.
    await expect(page.getByTestId("area-prices-range")).toBeInViewport();
    await expectMiniMapPlace(page);
    // r3 #28: Check this home · Stamp duty · Watch, then ♡ and ⋯.
    await expect(page.locator(".property-actions > .property-button")).toHaveCount(3);
    if (size.width < 600) {
      await expect(page.getByTestId("property-sales").getByRole("table")).toBeHidden();
      await expect(page.getByTestId("property-sales-rows")).toContainText("15 Jun 2006");
      const clipped = await page.getByTestId("property-sales-rows").evaluate((list) => list.scrollWidth > list.clientWidth);
      expect(clipped).toBe(false);
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
}

test("the help bubble explains the area's prices in plain words", async ({ page }) => {
  await page.goto("/property/100000000001");
  await page.getByTestId("area-prices").getByRole("button", { name: "What does this mean?" }).first().click();
  await expect(page.getByText(/About the area's sales, not this home: we never put a value on a single home/)).toBeVisible();
});

test("a home with too few same-type sales nearby shows only its recorded sales and a short note", async ({ page }) => {
  await page.goto("/property/100000000012");
  const card = page.getByTestId("area-prices");
  await expect(card.getByTestId("area-prices-none")).toHaveText("Not enough sales of this type nearby to show a range.");
  await expect(card.getByTestId("area-prices-chart")).toHaveCount(0);
  await expect(card.getByTestId("area-prices-position")).toHaveCount(0);
  await expect(card.getByTestId("area-prices-bridge")).toHaveCount(0);
  await expect(page.getByTestId("property-sales")).toContainText("£1,150,000");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("share copies the page link where there is no share sheet", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are chromium-only");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => { Object.defineProperty(navigator, "share", { value: undefined }); });
  await page.goto("/property/100000000001");
  await page.getByTestId("property-more").locator("summary").click();
  await page.getByTestId("property-share").click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/property/100000000001");
});

test("other homes lead to the postcode list, which lists every home with unknowns spelled out", async ({ page }) => {
  await page.goto("/property/100000000001");
  await expect(page.getByTestId("property-neighbours")).toContainText("12 Sample Street");
  await page.getByTestId("postcode-homes-link").click();
  await expect(page).toHaveURL(/\/postcode\/SW1A-1AB\/homes$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Homes in SW1A 1AB");
  const rows = page.getByTestId("postcode-home");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Leasehold");
  await expect(rows.nth(0)).toContainText("54 m²");
  await expect(rows.nth(2)).toContainText("Unknown");
  await expect(rows.nth(2)).toContainText("None recorded");
  await expect(page.getByTestId("postcode-homes-page")).not.toContainText(/Estimate|~£/);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  // Phones (≤ 560px) read the same homes as cards of terms instead of the wide table.
  const phone = (page.viewportSize()?.width ?? 1280) <= 560;
  const cards = page.getByTestId("postcode-home-cards");
  await expect(phone ? cards : page.getByRole("region", { name: "Homes in SW1A 1AB" })).toBeVisible();
  if (phone) await expect(cards.locator("li").nth(0).locator("dl")).toContainText("Leasehold");
  await (phone ? cards.locator("li").nth(0) : rows.nth(0)).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/property\/100000000001$/, { timeout: 20_000 });
});

// Review #5: an owner reaches the report / hide form from the home's page and from the postcode's list.
test("the report or hide form opens from the property page and from a postcode homes row", async ({ page }) => {
  await page.goto("/property/100000000001");
  await expect(page.getByTestId("home-correction-form")).toHaveCount(0);
  await page.getByTestId("property-more").locator("summary").click();
  await page.getByTestId("property-report-link").click();
  await expect(page).toHaveURL(/#report-home$/);
  const form = page.getByTestId("home-correction-form");
  await expect(form).toBeVisible();
  await expect(form.getByTestId("home-correction-kind-privacy-objection")).toBeChecked();
  await expect(form.getByTestId("home-correction-send")).toHaveText("Send confirmation link");

  await page.goto("/postcode/SW1A-1AB/homes");
  const report = page.getByRole("link", { name: /^Report or hide this home: 10 Sample Street/ }).locator("visible=true");
  await expect(report).toHaveAttribute("href", "/property/100000000001#report-home");
  await report.click();
  await expect(page).toHaveURL(/\/property\/100000000001#report-home$/, { timeout: 20_000 });
  await expect(page.getByTestId("home-correction-form")).toBeVisible();
  await expect(page.getByTestId("home-correction-form")).toBeInViewport();
});

test("Open on the map from a property page reselects that home", async ({ page }) => {
  await page.goto("/property/100000000001");
  await expect(page.getByTestId("property-map-link")).toHaveAttribute("href", /[?&]uprn=100000000001/);
  await page.getByTestId("property-more").locator("summary").click();
  await page.getByTestId("property-map-link").click();
  await expect(page).toHaveURL(/selected=uk%3Alsoa%3AE01000001/, { timeout: 20_000 });
  // The same home is chosen on the map: its card links back to this very page.
  const home = page.getByTestId("brief-home");
  await expect(home.getByTestId("brief-home-page")).toHaveAttribute("href", "/property/100000000001");
  await expect(home.getByTestId("brief-home-sale")).toContainText("Last sold");
  // The map's own address keeps the home, so a reload reselects it too.
  await expect(page).toHaveURL(/[?&]uprn=100000000001/);
  await page.reload();
  await expect(home.getByTestId("brief-home-page")).toHaveAttribute("href", "/property/100000000001");
});

test("the postcode page links to its home list; unknown homes and postcodes are 404s", async ({ page, request }) => {
  await page.goto("/postcode/sw1a-1ab");
  await expect(page.getByTestId("postcode-homes-link")).toHaveAttribute("href", "/postcode/SW1A-1AB/homes");
  expect((await request.get("/property/999999")).status()).toBe(404);
  expect((await request.get("/property/not-a-uprn")).status()).toBe(404);
  expect((await request.get("/postcode/E1-1AA/homes")).status()).toBe(404);
});

test("the BFF serves both contracts from fixtures in demo mode", async ({ request }) => {
  const profile = await request.get("/api/v1/properties/100000000001/profile");
  expect(profile.status()).toBe(200);
  expect((await profile.json()).schemaVersion).toBe("property-profile.v2");
  const homes = await request.get("/api/v1/postcodes/sw1a-1ab/homes");
  expect(homes.status()).toBe(200);
  expect((await homes.json()).homes).toHaveLength(3);
  expect((await request.get("/api/v1/properties/abc/profile")).status()).toBe(400);
  expect((await request.get("/api/v1/postcodes/nope/homes")).status()).toBe(400);
});

// Review #22: at 320px the "More" menu stays on screen and the wide tables are keyboard-reachable regions.
test("at 320px the More menu stays inside the viewport and a sales table takes keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/property/100000000001");
  await page.getByTestId("property-more").locator("summary").click();
  const menu = page.locator(".property-more__menu");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto("/postcode/sw1a-1ab");
  const building = page.getByTestId("postcode-building").first();
  await building.locator("summary").click();
  const region = building.getByRole("region", { name: /^Sales at / });
  await expect(region).toHaveAttribute("tabindex", "0");
  await building.locator("summary").focus();
  await page.keyboard.press("Tab");
  await expect(region).toBeFocused();
  await expect(region.locator("caption")).toHaveText(/Recorded sales at/);
});

test("at 320px the map's ≡ menu opens inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.getByTestId("top-menu-toggle").click();
  const panel = page.locator(".top-menu-panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

// Review #26: a printed property page is the record, without the header, the pills or the report form.
test("printing a property page hides the header, actions and buttons and keeps the sales table", async ({ page }) => {
  await page.goto("/property/100000000001");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("site-header")).toBeHidden();
  await expect(page.getByTestId("property-map-link")).toBeHidden();
  await expect(page.getByTestId("home-correction")).toBeHidden();
  await expect(page.getByTestId("property-sales").getByRole("table")).toBeVisible();
  await expect(page.locator(".property-page .property-button:visible")).toHaveCount(0);
});

test("Save this home keeps it at once and says so; the asking price is optional", async ({ page }) => {
  await page.goto("/property/100000000001");
  // A plain sentence under the address: what, where, last sale (no estimate).
  await expect(page.getByTestId("property-summary")).toHaveText(/^An? .+, (last sold for £[\d,]+ in [A-Z][a-z]+ \d{4}|with no recorded sale)\.$/);
  const actions = page.getByRole("navigation", { name: "Page links" });
  // r3 #28: ♡ is the header's one save.
  await actions.getByRole("button", { name: "Save this home" }).click();
  await expect(actions.getByTestId("save-home-heart")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("save-home-status")).toHaveText("Saved on this device. It is in your brief.");
  await expect(page.getByTestId("save-home-status")).toHaveAttribute("role", "status");
  // Both save points agree, and the store (the brief's source) holds the home by its UPRN.
  await expect(page.getByTestId("next-save-home-saved")).toHaveText("Saved to your brief");
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem("close-knit.user-candidates.v1") ?? "{}"));
  let stored = await read();
  expect(stored.candidates).toHaveLength(1);
  expect(stored.candidates[0].uprn).toBe("100000000001");
  expect(stored.candidates[0].asking).toBeNull();

  await page.getByTestId("next-save-home").getByRole("button", { name: "Add asking price" }).click();
  await page.getByRole("textbox", { name: "Asking price on the listing" }).first().fill("650000");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("next-save-home-status")).toHaveText(/^Asking price added\./);
  await expect(page.getByRole("button", { name: "Add asking price" })).toHaveCount(0);
  stored = await read();
  expect(stored.candidates).toHaveLength(1);
  expect(stored.candidates[0].asking.value.amount).toBe(650000);
  await page.reload();
  await expect(page.getByTestId("save-home-heart")).toHaveAttribute("aria-pressed", "true");
  // A second press unsaves it.
  await page.getByTestId("save-home-heart").click();
  await expect(page.getByTestId("save-home-heart")).toHaveAttribute("aria-pressed", "false");
  expect((await read()).candidates).toHaveLength(0);
});

test("the Tools block is folded after Living costs, holds the investor calculator and keeps nothing", async ({ page }) => {
  // The page's own first-party usage events are the only writes allowed, and none may carry a typed figure.
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" || new URL(request.url()).pathname === "/api/v1/usage") return;
    requests.push(`${request.method()} ${request.url()}`);
  });
  const usage: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/v1/usage") usage.push(request.postData() ?? ""); });
  await page.goto("/property/100000000001");
  const tools = page.getByTestId("home-tools");
  await expect(tools).not.toHaveAttribute("open");
  await expect(tools.getByTestId("investor-calculator")).toHaveCount(0);
  // After the area sections, before the closing Next steps (4 = DOCUMENT_POSITION_FOLLOWING).
  const order = await page.evaluate(() => {
    const area = document.querySelector('[data-testid="home-area-sections"]')!;
    const tools = document.querySelector('[data-testid="home-tools"]')!;
    const next = document.querySelector('[data-testid="property-next-steps"]')!;
    return [area.compareDocumentPosition(tools), tools.compareDocumentPosition(next)];
  });
  expect(order[0] & 4).toBeTruthy();
  expect(order[1] & 4).toBeTruthy();

  await tools.getByTestId("home-tools-toggle").click();
  const calculator = tools.getByTestId("investor-calculator");
  await expect(calculator).toBeVisible();
  // The rent starts at the borough average for 2 bedrooms (demo rents), editable, and says so.
  await expect(tools.getByTestId("investor-rent-source")).toContainText("average for 2 bedrooms");
  await expect(tools.getByTestId("btl-monthlyRent")).toHaveValue("2,400");
  await tools.getByRole("radio", { name: "3" }).check();
  await expect(tools.getByTestId("btl-monthlyRent")).toHaveValue("3,100");
  await tools.getByTestId("btl-monthlyRent").fill("2750");
  await expect(tools.getByTestId("btl-gross-yield")).not.toHaveText("Unknown");
  await expect(tools.getByTestId("investor-note")).toContainText("not saved or sent anywhere");
  for (const tab of ["HMO", "BRRR", "Flip"]) {
    await tools.getByRole("tab", { name: tab }).click();
    await expect(tools.getByRole("tabpanel")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  }
  // The only calculator on the page; nothing was posted anywhere.
  await expect(page.getByTestId("investor-calculator")).toHaveCount(1);
  await expect(page.getByTestId("tools-bar")).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(usage.join("")).not.toContain("2750");
});

test("check this home and stamp duty sit under the actions at the last sale; the page ends with compare, brief and watch", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/property/100000000001");
  const tools = page.getByTestId("home-header");
  const check = tools.getByTestId("next-check-home");
  await expect(check).toHaveText("Check this home · £570k · 2022");
  const checkHref = await check.getAttribute("href");
  expect(checkHref).toMatch(/^\/tools\/check-a-home\?area=/);
  expect(new URL(checkHref!, "http://x").searchParams.get("uprn")).toBe("100000000001");
  const stamp = tools.getByTestId("next-stamp-duty");
  await expect(stamp).toHaveText("Stamp duty");
  expect(new URL((await stamp.getAttribute("href"))!, "http://x").searchParams.get("price")).toBe("570000");
  expect((await stamp.boundingBox())!.y).toBeLessThan(900);
  const steps = page.getByTestId("property-next-steps");
  await expect(steps.getByRole("heading", { name: "Next steps" })).toBeVisible();
  const compare = await steps.getByRole("link", { name: "Like this" }).getAttribute("href");
  expect(compare).toMatch(/^\/\?find=like&area=lsoa%3AE\d+$/);
  await expect(steps.getByRole("button", { name: "Add to my brief" })).toBeVisible();
  // Watch is in the header only, not repeated in Next steps.
  await expect(steps.getByTestId("watch-listings-open")).toHaveCount(0);
  const watch = page.getByTestId("home-header").getByRole("button", { name: "Watch", exact: true });
  await watch.click();
  const dialog = page.getByRole("dialog", { name: "Watch new homes" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("watch-listings-prompt")).toContainText("SW1A 1AB");
  await expect(dialog.getByRole("link", { name: "Any agent" })).toHaveAttribute("href", "/agents");
  await expect(dialog.getByTestId("watch-open-claude")).toHaveAttribute("href", /^https:\/\/claude\.ai\/new\?q=Using%20Close%20Knit/);
  await expect(dialog.locator("input[type=email]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(watch).toBeFocused();

  await stamp.click();
  await expect(page.getByTestId("tools-prefill")).toBeVisible();
  await expect(page.getByTestId("sdlt-price")).toHaveValue("570,000");
});

test("next steps fit a phone: Check this home is reachable at 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/property/100000000001");
  await expect(page.getByTestId("next-check-home")).toBeVisible();
  // r3 #29: the breadcrumbs are one line on a phone ("… › SW1A 1AB › 10 Sample Street").
  const crumbs = page.getByTestId("home-header").getByTestId("breadcrumbs");
  expect((await crumbs.boundingBox())!.height).toBeLessThanOrEqual(48);
  await expect(crumbs.getByRole("link", { name: "SW1A 1AB" })).toBeVisible();
  // r3 #33: the page never names its area by its code.
  await expect(page.getByTestId("property-page")).not.toContainText(/Westminster preview \d|\(E0\d{7}\)/);
});

// r3 #35: every home in the list is a link (its page, or the map's card when it has no page); Report sits in its own column.
test("every row of a postcode's homes is a link and rows stay one line", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/postcode/SW1A-1AB/homes");
  const rows = page.getByTestId("postcode-home");
  for (const row of await rows.all()) await expect(row.locator("td").first().getByRole("link")).toHaveCount(1);
  await expect(page.getByTestId("postcode-homes-on-map")).toHaveAttribute("href", /^\/\?selected=uk%3Alsoa%3AE01000001/);
  await expect(page.getByTestId("postcode-homes-page").getByRole("button", { name: "Watch", exact: true })).toBeVisible();
  const heights = await rows.evaluateAll((list) => list.map((row) => row.getBoundingClientRect().height));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(4);
});
