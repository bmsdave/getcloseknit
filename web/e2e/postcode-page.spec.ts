import { expect, test } from "./fixtures";

// The postcode page (C2): the data-mode badge, one friendly line under the
// postcode, one Area page link, Find my area and the watch, 44px links, and
// canonical + OpenGraph metadata. Unknown postcodes stay a 404.

test("status codes: a known postcode is 200, an unknown one stays 404", async ({ request }) => {
  expect((await request.get("/postcode/sw1a-1ab")).status()).toBe(200);
  expect((await request.get("/postcode/nope")).status()).toBe(404);
});

test("the header carries the data-mode badge and a friendly summary line", async ({ page }) => {
  await page.goto("/postcode/sw1a-1ab");
  await expect(page.getByText("Demo data · not for decisions")).toBeVisible();
  await expect(page.getByTestId("postcode-summary")).toHaveText(/^The last recorded sale here was £570k, in November 2022\./);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SW1A 1AB");
});

test("one area link, Find my area from this area, and links with real hit areas", async ({ page }) => {
  await page.goto("/postcode/sw1a-1ab");
  await expect(page.getByTestId("postcode-living")).toBeVisible({ timeout: 20_000 });
  // What's next › Up names the area (the breadcrumbs link it too).
  await expect(page.getByTestId("postcode-area-link")).toHaveCount(1);
  await expect(page.getByTestId("postcode-area-link")).toHaveAttribute("href", "/area/lsoa/E01000001");
  await expect(page.getByTestId("postcode-find-like")).toHaveAttribute("href", "/?find=like&area=lsoa%3AE01000001");
  for (const link of await page.locator(".panel-links a, .panel-links button, .whats-next a, .whats-next button").all()) {
    const box = await link.boundingBox();
    expect(box?.height ?? 0, await link.innerText()).toBeGreaterThanOrEqual(24);
  }
});

test("the living-here tiles have clean names in sentence case", async ({ page }) => {
  await page.goto("/postcode/sw1a-1ab");
  const tiles = page.getByTestId("postcode-living-tile");
  await expect(tiles.first()).toBeVisible({ timeout: 20_000 });
  for (const tile of await tiles.all()) {
    const label = await tile.locator(".postcode-stat__label").innerText();
    await expect(tile).toHaveAccessibleName(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "i"));
    const text = await tile.locator(".postcode-stat__label").evaluate((node) => node.textContent ?? "");
    expect(text).not.toMatch(/^[A-Z ·,]+$/);
  }
});

// The flood tile reads the homes' own EA bands, not the area's land (W5 1LR: a park's floodplain in its LSOA).
test("the flood tile leads with the homes' own bands, not the area's highest band", async ({ page }) => {
  await page.goto("/postcode/sw1a-1ab");
  const tile = page.locator('[data-testid="postcode-living-tile"][data-tile="flood"]');
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await expect(tile.locator(".postcode-stat__label")).toHaveText("Flood risk · rivers, sea");
  // The demo area's land reaches medium; its banded homes are low at worst.
  await expect(tile.locator(".postcode-tile__value")).toHaveText("Low");
  await expect(tile.locator(".postcode-stat__detail")).toHaveText(/^2 of \d homes · surface water very low$/);
});

// r3 #30/#31 (CUJ02 step 2): On map · Watch · ♡ by the title, no "Postcode" eyebrow, and Homes here in a phone's first screen.
test("the title carries On map, Watch and ♡, and Homes here is in the first screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/postcode/sw1a-1ab");
  const actions = page.getByTestId("postcode-actions");
  await expect(actions.getByTestId("postcode-on-map")).toHaveAttribute("href", /^\/\?selected=uk%3Alsoa%3AE01000001/);
  await expect(actions.getByRole("button", { name: "Watch" })).toBeVisible();
  await expect(page.locator(".postcode-page .eyebrow")).toHaveCount(0);
  const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
  expect((await actions.boundingBox())!.y).toBeLessThan(title.y + title.height + 60);
  expect((await page.getByTestId("postcode-homes-here").boundingBox())!.y).toBeLessThan(844);
  // ♡ keeps the postcode in Saved › Places.
  await actions.getByTestId("postcode-save").click();
  await expect(actions.getByTestId("postcode-save")).toHaveAttribute("aria-pressed", "true");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("close-knit.saved-items.v1") ?? "{}"));
  expect(saved.items[0]).toMatchObject({ kind: "place", id: "postcode:SW1A-1AB", name: "SW1A 1AB", href: "/postcode/SW1A-1AB" });
  // One Watch on the page (v3 Fix 22).
  await expect(page.getByTestId("watch-listings-open")).toHaveCount(1);
});

test("Watch opens a prompt for this postcode, with no e-mail field", async ({ page }) => {
  await page.goto("/postcode/sw1a-1ab");
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  // v4.4: the shared sheet (CUJ12 v4), scoped to the postcode.
  const dialog = page.getByRole("dialog", { name: "Watch new homes" });
  await expect(dialog.getByTestId("watch-place")).toHaveText("SW1A 1AB");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("watch-listings-prompt")).toContainText("new homes for sale in SW1A 1AB");
  await expect(dialog.locator("input[type=email]")).toHaveCount(0);
  // v4 Task 51: without an agent, the portals' own alerts for SW1A, with the price and beds filled in.
  const alerts = dialog.getByTestId("watch-portal-alerts");
  await expect(alerts).toContainText("Open SW1A on ▸");
  await expect(alerts.getByTestId("watch-portal-rightmove")).toHaveAttribute("href", "https://www.rightmove.co.uk/property-for-sale/SW1A.html");
  await alerts.getByTestId("watch-max-price").fill("650k");
  await alerts.getByTestId("watch-beds").selectOption({ label: "2+" });
  for (const portal of ["rightmove", "zoopla", "onthemarket"]) {
    const href = new URL((await alerts.getByTestId(`watch-portal-${portal}`).getAttribute("href"))!, "http://x");
    expect(href.pathname).toBe(`/go/${portal}`);
    expect(Object.fromEntries(href.searchParams)).toMatchObject({ kind: "listings", outcode: "SW1A", market: "buy", max_price: "650000", beds: "2" });
  }
  await expect(alerts.getByTestId("watch-portal-zoopla")).toHaveAttribute("target", "_blank");
  await alerts.getByTestId("watch-market-rent").click();
  await expect(alerts.getByTestId("watch-portal-rightmove")).toHaveAttribute("href", /market=rent/);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Watch", exact: true })).toBeFocused();
});

// v4 Task 34 + 44: the homes at the top as links; the last sale on the page's own surface (no inverted ink card).
test("Homes here sits at the top, each home a link, and the last sale is on tokens", async ({ page }) => {
  await page.goto("/postcode/sw1a-1ab");
  const here = page.getByTestId("postcode-homes-here");
  await expect(here.getByRole("heading", { name: "Homes here" })).toBeVisible();
  const [hereBox, salesBox] = await Promise.all([here.boundingBox(), page.getByRole("heading", { name: "Every recorded sale" }).boundingBox()]);
  expect(hereBox!.y).toBeLessThan(salesBox!.y);
  const rows = here.getByTestId("postcode-home-here");
  await expect(rows).toHaveCount(3);
  await expect(rows.first().getByRole("link", { name: "10 Sample Street", exact: true })).toHaveAttribute("href", "/property/100000000001");
  await expect(rows.first()).toContainText("Flat");
  await expect(rows.first()).toContainText("£570k · 2022");
  // r3 #35: every row is a link; a home with no page of its own opens the map's card for its address.
  await expect(rows.getByRole("link")).toHaveCount(3);
  await expect(rows.last().getByTestId("postcode-home-here-map")).toHaveAttribute("href", /^\/\?selected=uk%3Alsoa%3AE01000001&.*address=/);
  await expect(here.getByTestId("postcode-homes-all")).toHaveAttribute("href", "/postcode/SW1A-1AB/homes");
  const lead = page.getByTestId("postcode-last-sale");
  const [ground, ink] = await lead.evaluate((node) => {
    const style = getComputedStyle(node);
    const probe = document.createElement("i");
    probe.style.color = "var(--ink)";
    document.body.append(probe);
    const inkColour = getComputedStyle(probe).color;
    probe.remove();
    return [style.backgroundColor, inkColour];
  });
  expect(ground).not.toBe(ink);
});

test("canonical and OpenGraph metadata name the postcode", async ({ page }) => {
  await page.goto("/postcode/sw1a-1ab");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/postcode\/SW1A-1AB$/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /SW1A 1AB/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /SW1A 1AB/);
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
});

// The pages this lane changed, at phone and desktop widths in Day and Night: nothing scrolls sideways.
for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1440]) {
    test(`property and postcode pages fit at ${width}px (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/property/100000000001", "/postcode/sw1a-1ab", "/postcode/SW1A-1AB/homes"]) {
        await page.goto(path);
        const asking = page.getByTestId("asking-price-input");
        if (path !== "/postcode/SW1A-1AB/homes") await asking.first().fill("650000");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  }
}

test("an address that is not plain text is ignored", async ({ page }) => {
  await page.goto("/postcode/sw1a-1ab?address=%3Cscript%3Ex%3C%2Fscript%3E+Road");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SW1A 1AB");
  await expect(page.getByTestId("postcode-searched-home")).toHaveCount(0);
});
