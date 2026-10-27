import { expect, test, type Page } from "./fixtures";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";

// The v3 area page (docs/design/v3-spec.md Fix 27G, 28, 29, 33): what the server sends, the household's
// tailoring (reorders and highlights, never hides), and both themes at phone and desktop widths.
const AREA = "/area/lsoa/E01000001";
const TILES = ["price", "safety", "schools", "station-walk", "cycling", "noise", "nature", "air", "gp", "food-hygiene", "nightlife", "families"];
const SECTIONS = ["price", "getting-around", "safety", "schools", "local-places", "environment", "health", "homes", "people", "living-costs"];
/** The client-only page (no server seed), so a test's mock of a section read applies (lib/area-page-seed.ts). */
const SEED_OFF = "x-close-knit-seed";

async function seed(page: Page, profile: object, tailorOnly = false) {
  await page.addInitScript(([value, only]) => {
    window.localStorage.setItem("close-knit.preference-profile.v1", JSON.stringify(value));
    if (only) window.localStorage.setItem("close-knit.tailor-only.v1", "1");
  }, [profile, tailorOnly] as const);
}

test("the server sends the verdict, the tags and all 12 tiles, so crawlers and the first paint get them whole", async ({ request }) => {
  const html = await (await request.get(AREA)).text();
  expect(html).toContain('data-testid="area-verdict-line"');
  expect(html).toMatch(/data-testid="area-tag-(pro|con)"/);
  for (const id of TILES) expect(html, id).toContain(`data-testid="area-tile-${id}"`);
  // Never a per-home price, and never people, income or deprivation as a tile.
  expect(html).not.toMatch(/area-tile-(income|deprivation|social|ethnic|religion)/);
  expect(html).not.toMatch(/home-cost-value|worth|valuation/i);
});

test("six quick server renders each carry every section whole", async ({ request }) => {
  // Production once sent empty sections from the third quick view on: each section read was charged
  // to the viewer's API rate limit (lib/server-render.ts, api/area_api/ratelimit.py class render).
  const renders = await Promise.all(Array.from({ length: 6 }, () => request.get(AREA)));
  for (const [index, response] of renders.entries()) {
    expect(response.status()).toBe(200);
    const html = await response.text();
    for (const id of SECTIONS) expect(html, `render ${index + 1}: ${id}`).toMatch(new RegExp(`<section[^>]* id="${id}"`));
    expect(html, `render ${index + 1}`).not.toContain('data-testid="area-evidence-loading"');
    expect(html, `render ${index + 1}`).not.toMatch(/>Loading[^<]*…</);
  }
});

test("without the server's sections the page says they are loading, then reads them itself", async ({ page, request }) => {
  const html = await (await request.get(AREA, { headers: { [SEED_OFF]: "off" } })).text();
  expect(html).toContain('data-testid="area-evidence-loading"');
  expect(html).not.toContain("Search a postcode or tap a coloured area");
  await page.setExtraHTTPHeaders({ [SEED_OFF]: "off" });
  await page.goto(AREA);
  for (const id of SECTIONS) await expect(page.locator(`section.area-section#${id}`), id).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId("area-evidence-loading")).toHaveCount(0);
});

test("tags: at most three pros then two cons, each to its section; people never make one", async ({ page }) => {
  await page.goto(AREA);
  const tags = page.getByTestId("area-tags").getByRole("link");
  await expect(tags.first()).toBeVisible();
  const kinds = await tags.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-kind")));
  expect(kinds.filter((kind) => kind === "pro").length).toBeLessThanOrEqual(3);
  expect(kinds.filter((kind) => kind === "con").length).toBeLessThanOrEqual(2);
  expect(kinds).toEqual([...kinds].sort((a, b) => (a === "pro" ? 0 : 1) - (b === "pro" ? 0 : 1)));
  for (const href of await tags.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))) {
    expect(SECTIONS.map((id) => `#${id}`)).toContain(href);
  }
  // Deprivation may tag (owner decision 2026-10-17); income, social housing and the Census never do.
  await expect(page.getByTestId("area-tags")).not.toContainText(/income|social|ethnic|religion|born/i);
});

test("a tailored page reorders and highlights, adds the budget fit and the household's tag, and hides nothing", async ({ page }) => {
  await seed(page, { ...DEFAULT_PROFILE, maximumBudget: 1_200_000, targetBudget: 1_000_000, bedrooms: 3, propertyType: "flat" });
  await page.goto(AREA);
  await expect(page.getByTestId("tailor-chip")).toHaveText(/^Tailored to: Buy ≤ £1\.2m · 3-bed · Flat/, { timeout: 30_000 });
  // The household's tag comes first.
  await expect(page.getByTestId("area-tags").getByRole("link").first()).toHaveText(/Within budget/);
  await expect(page.getByTestId("area-tags").getByRole("link").first()).toHaveAttribute("data-mine", "");
  // Price: all four types stay, the household's first; the budget fit is an added row, marked.
  const types = page.getByTestId("price-types").locator("[data-testid^=price-type-]");
  await expect(types).toHaveCount(4);
  await expect(types.first()).toHaveAttribute("data-testid", "price-type-F");
  const fit = page.getByTestId("price-budget-fit");
  await expect(fit).toHaveAttribute("data-mine", "");
  await expect(fit).toContainText(/≤ £1\.2m buys/);
  await expect(page.getByTestId("price-key-numbers").locator(":scope > div").first()).toHaveAttribute("data-testid", "price-budget-fit");
  // Every tile and section is still there, in the same order.
  expect(await page.getByTestId("area-tiles").locator("[data-testid^=area-tile-]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")!.replace("area-tile-", "")))).toEqual(TILES);
  expect(await page.locator("section.area-section").evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual(SECTIONS);
});

test("Safety: offence types against London, and a stable rate is a row instead of a line", async ({ page }) => {
  // E01000002's demo rate moved under 15% in three years: a row says so and no line is drawn.
  await page.goto("/area/lsoa/E01000002");
  const safety = page.getByTestId("evidence-section-safety");
  await expect(safety.getByTestId("rate-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(safety.getByTestId("rate-row").first().locator(".share-row__tick")).toHaveCount(1);
  await expect(safety.getByTestId("crime-stable")).toContainText("Stable over 3 years");
  await expect(safety.getByTestId("metric-history-chart")).toHaveCount(0);
  // A rate that moved 15% or more: the line is drawn and the row gives the change (the browser reads it, so the mock applies).
  await page.setExtraHTTPHeaders({ [SEED_OFF]: "off" });
  await page.route(/\/api\/v1\/areas\/[^/?]+\/safety/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.trend = { ...body.trend, months: 36, changePercent: 22.4, stable: false };
    await route.fulfill({ response, json: body });
  });
  await page.goto(AREA);
  const moved = page.getByTestId("evidence-section-safety");
  await expect(moved.getByTestId("metric-history-chart")).toBeVisible({ timeout: 30_000 });
  await expect(moved.getByTestId("crime-trend")).toHaveText("Trend+22.4% over 3 years");
  await expect(moved.getByTestId("crime-stable")).toHaveCount(0);
});

test("board rows: road casualties per year, Band D split, nurseries first for under-5s, no London words for none", async ({ page }) => {
  await seed(page, { ...DEFAULT_PROFILE, household: "kids-under5" }, true);
  // No cycle lanes at all ties with much of London: the row says 0 km and nothing about London.
  await page.setExtraHTTPHeaders({ [SEED_OFF]: "off" });
  await page.route(/\/api\/v1\/areas\/[^/?]+\/kids/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.cycling = { ...body.cycling, protectedKm: 0, cyclewayKm: 0 };
    await route.fulfill({ response, json: body });
  });
  await page.goto(AREA);
  await expect(page.getByTestId("road-casualties-years")).toHaveText(/^Per year\d+( · \d+)+ \(2021–20\d\d\)$/, { timeout: 30_000 });
  await expect(page.getByTestId("cycle-lanes")).toHaveText("Cycle lanes ≤ 1 km0 km protected");
  await expect(page.getByTestId("civic-band-d-split")).toHaveText(/^Band D£[\d,]+\.\d\d = .+ £[\d,]+\.\d\d \+ GLA £[\d,]+\.\d\d$/);
  // With children under 5 the nurseries lead Schools, lit; the school rows follow, all still there.
  const schools = page.getByTestId("evidence-section-schools");
  await expect(schools.getByTestId("nurseries")).toHaveAttribute("data-mine", "");
  await expect(schools.getByTestId("school-phases")).toBeVisible();
  expect(await schools.locator(".area-section__body > *").first().getAttribute("data-testid")).toBe("schools-key-numbers");
});

for (const theme of ["day", "night"] as const) {
  for (const width of [390, 1440]) {
    test(`${theme} at ${width}px: tokens only, no sideways scroll, tiles in ${width < 760 ? "two" : "four"} columns`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(AREA);
      await page.evaluate((value) => document.documentElement.setAttribute("data-ui-theme", value), theme);
      await expect(page.getByTestId("area-tabs")).toBeVisible({ timeout: 30_000 });
      const columns = await page.getByTestId("area-tiles").evaluate((node) => new Set([...node.children]
        .filter((cell) => (cell as HTMLElement).offsetWidth > 0).map((cell) => Math.round(cell.getBoundingClientRect().left))).size);
      expect(columns).toBe(width < 760 ? 2 : 4);
      // Tags and tiles follow the theme's tokens: ink text on a tint of the theme's surface.
      const colours = await page.evaluate(() => {
        const tag = document.querySelector<HTMLElement>(".area-tag")!;
        const tile = document.querySelector<HTMLElement>(".standout-tile")!;
        const root = getComputedStyle(document.documentElement);
        return { tag: getComputedStyle(tag).color, tile: getComputedStyle(tile).backgroundColor, ink: root.getPropertyValue("--ink").trim() };
      });
      const hex = colours.ink.replace("#", "");
      const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
      expect(colours.tag).toBe(rgb);
      expect(colours.tile).not.toBe("rgba(0, 0, 0, 0)");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // The sticky chips stay in view while the page scrolls.
      await page.getByTestId("evidence-section-people").evaluate((node) => node.scrollIntoView({ block: "start" }));
      await expect(page.getByTestId("area-tabs")).toBeInViewport();
    });
  }
}
