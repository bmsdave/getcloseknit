import { expect, test, type Page } from "./fixtures";

const OLD_FRAGMENT = "#profile=v1.WzAsNTUwMDAwLDYwMDAwMCwyLDEsW1szLDQsMSxudWxsLG51bGxdLFs5LDMsMSw0MCxudWxsXSxbMSwwLDEsbnVsbCxudWxsXV0sW10sW1sicHJpbWFyeSJdLFtdLFtdLFtdLDNdLDAsW1swLCJvc206bjExOTI3NDQ2NCIsMTUsIktpbmcncyBDcm9zcyBTdCBQYW5jcmFzIl0sWzEsInVrOmJvcm91Z2g6RTA5MDAwMDA3Il0sWzIsWyJ1azpsc29hOkUwMTAwMDk1MSIsInVrOmxzb2E6RTAxMDAxMjM0Il0sIkNhZsOpICYgY28g4oCUIMO8bsOvY29kZSJdXV0";

// v4.3 pages frame: one page width (Task 16), the borough page (Task 17), page metadata and URLs
// (Task 40), and one chosen state and brand lockup (Task 37). Demo fixtures.

const PAGES = [
  "/area/lsoa/E01000001", "/area/lsoa/E01000001/places", "/area/lad/E09000001", "/school/100002",
  "/property/100000000001", "/postcode/SW1A-1AB", "/tools", "/guide", "/privacy", "/area/london", "/rankings",
];

/** The header, the page's main and the footer: left edge and width, rounded. */
async function frame(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? [Math.round(rect.left), Math.round(rect.width)] : null;
    };
    return { header: box(".site-header"), main: box("main"), footer: box(".site-footer"), overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
}

for (const width of [1440, 1280, 1024, 390]) {
  test(`header, content and footer share one width on every page at ${width}px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "one pass sets each width itself");
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const expected = [Math.round((width - Math.min(1120, width - 48)) / 2), Math.min(1120, width - 48)];
    for (const path of width === 1440 || width === 390 ? PAGES : PAGES.slice(0, 4)) {
      await page.goto(path);
      await expect(page.getByTestId("site-header")).toBeVisible();
      const found = await frame(page);
      expect({ path, ...found }).toEqual({ path, header: expected, main: expected, footer: expected, overflow: found.overflow });
      expect(found.overflow, path).toBeLessThanOrEqual(0);
    }
  });
}

test("long prose keeps a reading measure inside the page width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/privacy");
  const widths = await page.evaluate(() => [...document.querySelectorAll("main.page-prose > :not(.site-header)")]
    .map((node) => Math.round(node.getBoundingClientRect().width)));
  expect(widths.length).toBeGreaterThan(0);
  expect(Math.max(...widths)).toBeLessThanOrEqual(720);
});

test("the borough's Areas list sorts by its strips, keeps the sort in the address and links each area page", async ({ page }) => {
  await page.goto("/area/lad/E09000001?sort=schools");
  const areas = page.getByTestId("borough-areas");
  await expect(areas.getByTestId("borough-areas-sort-schools")).toHaveAttribute("aria-pressed", "true");
  const row = areas.getByTestId("borough-area").first();
  await expect(row.getByRole("link")).toHaveAttribute("href", "/area/lsoa/E01000001");
  await expect(row.getByTestId("london-strip")).toHaveCount(3);
  await areas.getByTestId("borough-areas-sort-name").click();
  await expect(page).toHaveURL(/[?&]sort=name/);
  await expect(areas.getByTestId("borough-areas-sort-name")).toHaveAttribute("aria-pressed", "true");
  // Tiles lead to the borough's own sections; the tags say "of boroughs".
  await expect(page.getByTestId("area-tile-price")).toHaveAttribute("href", "#price");
  for (const text of await page.getByTestId("area-tags").getByRole("link").allTextContents()) expect(text).not.toMatch(/of London$/);
  // Income and social renting are described rows, never tags.
  await expect(page.getByTestId("people-key-numbers")).toContainText("Household income");
  await expect(page.getByTestId("area-tags")).not.toContainText(/income|social/i);
});

test("a lowercase code or postcode moves permanently to its page", async ({ request }) => {
  for (const [from, to] of [
    ["/area/lsoa/e01000001", "/area/lsoa/E01000001"], ["/area/lad/e09000001?sort=name", "/area/lad/E09000001?sort=name"],
    ["/area/lsoa/e01000001/places", "/area/lsoa/E01000001/places"], ["/postcode/sw1a1ab", "/postcode/SW1A-1AB"],
  ] as const) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(308);
    expect(new URL(response.headers().location, "http://x").pathname + new URL(response.headers().location, "http://x").search).toBe(to);
  }
});

// Step R2: a LAD's page was /area/borough/<code> and its id uk:borough:<code>; old links keep working.
test("an old borough page moves for good (301) to /area/lad/, and an old shared search still opens", async ({ page, request, baseURL }) => {
  for (const [from, to] of [
    ["/area/borough/E09000001", "/area/lad/E09000001"], ["/area/borough/e09000001/pack?x=1", "/area/lad/E09000001/pack?x=1"],
  ] as const) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(301);
    const location = new URL(response.headers().location, "http://x");
    expect(location.pathname + location.search).toBe(to);
  }
  await page.goto("/area/borough/E09000001");
  await expect(page).toHaveURL(/\/area\/lad\/E09000001$/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/area/lad/E09000001`);
  const api = await request.get("/api/v1/areas/uk:borough:E09000001/rents");
  expect(api.status()).toBe(200);
  // A search shared before R2 (its borough zone uk:borough:E09000007) opens in full.
  await page.goto(`/?layer=personal-match${OLD_FRAGMENT}`);
  await expect(page.getByTestId("match-ranking").getByTestId("shared-banner")).toContainText("Buy up to £600k");
  await expect(page.getByTestId("map-toast-text")).toHaveCount(0);
});

test("home, postcode, school and 404 pages have their own title, canonical, preview and JSON-LD", async ({ page, baseURL }) => {
  const ld = async () => (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text));
  await page.goto("/property/100000000001");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/property/100000000001`);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `${baseURL}/property/100000000001`);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Sample Street.* · Close Knit$/);
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /\/area\/lsoa\/E01000001\/opengraph-image/);
  const home = (await ld()).find((entry) => entry["@type"] === "Residence");
  expect(home?.address.postalCode).toBeTruthy();
  expect(JSON.stringify(home)).not.toMatch(/price/i);

  await page.goto("/postcode/SW1A-1AB");
  await expect(page).toHaveTitle(/^SW1A 1AB · St James's · SW1A · Close Knit$/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", await page.title());
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /opengraph-image/);
  expect((await ld()).map((entry) => entry["@type"])).toContain("Place");

  await page.goto("/school/100002");
  await expect(page).toHaveTitle(/ · Close Knit$/);
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /\/area\/lsoa\/E0100000\d\/opengraph-image|\/opengraph-image/);

  for (const path of ["/area/lsoa/E01999999", "/postcode/ZZ99-9ZZ", "/property/999999999999", "/no-such-page"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page, path).toHaveTitle("Page not found · Close Knit");
    await expect(page.locator('meta[name="description"]')).not.toHaveAttribute("content", /really sold for/);
  }
});

test("one chosen state: the chosen tab and pressed chip are the primary fill with the running stitch", async ({ page }) => {
  await page.goto("/tools/stamp-duty");
  const tool = await page.locator('.tools-nav a[aria-current="page"]').evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.goto("/area/lad/E09000001");
  const chosen = page.locator('.area-tabs a[aria-current="true"]').first();
  await expect(chosen).toBeVisible();
  const chip = await chosen.evaluate((node) => ({ fill: getComputedStyle(node).backgroundColor, stitch: getComputedStyle(node, "::after").borderTopStyle }));
  const pressed = await page.getByTestId("borough-areas-sort-price").evaluate((node) => ({
    fill: getComputedStyle(node).backgroundColor, stitch: getComputedStyle(node, "::after").borderTopStyle,
  }));
  expect(chip).toEqual({ fill: tool, stitch: "dashed" });
  expect(pressed).toEqual({ fill: tool, stitch: "dashed" });
});

test("one brand lockup: the knitted house and the wordmark on the map and on every page", async ({ page }) => {
  const lockup = async () => page.locator(".brand-lockup").first().evaluate((node) => {
    const mark = node.querySelector(".brand-lockup__mark")!.getBoundingClientRect();
    const word = node.querySelector<HTMLElement>(".brand-lockup__word")!;
    return { mark: Math.round(mark.width), word: word.textContent, shown: getComputedStyle(word).display !== "none", size: getComputedStyle(word).fontSize };
  });
  await page.goto("/");
  const map = await lockup();
  await page.goto("/guide");
  const guide = await lockup();
  expect(map).toEqual(guide);
  expect(map).toMatchObject({ word: "close knit", shown: true });
});
