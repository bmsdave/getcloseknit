import { expect, test, type Page } from "./fixtures";

// v3 round 2 on the area page (docs/design/v3-spec.md Fix 28, 33, boards V3-27g, V3-33a, V3-33b): the whole
// default page from the server, scroll-spy under the sticky bar, full-width price chart, Ofsted school rows.
const AREA = "/area/lsoa/E01000001";
const SECTIONS = ["price", "getting-around", "safety", "schools", "local-places", "environment", "health", "homes", "people", "living-costs"];
/** Section reads the page used to make in the browser; the server now sends them with the page. */
const SECTION_READS = /\/api\/v1\/(areas\/|metrics|health)/;

async function open(page: Page, theme: "day" | "night", width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(AREA);
  await page.evaluate((value) => document.documentElement.setAttribute("data-ui-theme", value), theme);
  await expect(page.getByTestId("area-tabs")).toBeVisible({ timeout: 30_000 });
}

test("the server sends every section with its numbers, no loading states (Fix 33 SEO rule)", async ({ request }) => {
  const html = await (await request.get(AREA)).text();
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const id of SECTIONS) expect(body, id).toContain(`data-testid="evidence-section-${id}"`);
  for (const id of ["price-types", "market-trend-price", "price-key-numbers", "getting-around-key-numbers", "safety-types",
    "safety-key-numbers", "area-school-row", "local-places-key-numbers", "area-tabs"]) {
    expect(body, id).toContain(`data-testid="${id}"`);
  }
  expect(body).toMatch(/£[\d,]+\/m²/);
  expect(body).not.toMatch(/Loading/);
  // Still never a per-home price.
  expect(body).not.toMatch(/home-cost-value|worth|valuation/i);
});

test("the browser reads none of the sections again: they came with the page", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (request) => { if (SECTION_READS.test(new URL(request.url()).pathname)) reads.push(request.url()); });
  await page.goto(AREA);
  await expect(page.getByTestId("price-key-numbers")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  expect(reads).toEqual([]);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("a reader gets every section and its numbers", async ({ page }) => {
    await page.goto(AREA);
    for (const id of SECTIONS) await expect(page.getByTestId(`evidence-section-${id}`), id).toBeVisible();
    await expect(page.getByTestId("price-key-numbers")).toContainText("£");
    await expect(page.getByTestId("safety-types")).toBeVisible();
    await expect(page.getByTestId("area-school-row").first()).toBeVisible();
  });
});

/** Scrolls so the section's top sits `offset` px under the sticky bar's bottom. */
async function topUnderBar(page: Page, id: string, offset: number) {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(([section, gap]) => {
      const bar = document.querySelector("[data-testid=area-tabs]")!.getBoundingClientRect();
      const top = document.getElementById(section as string)!.getBoundingClientRect().top;
      window.scrollBy(0, top - bar.bottom - (gap as number));
    }, [id, offset] as const);
  }
}

for (const theme of ["day", "night"] as const) {
  for (const width of [390, 1440]) {
    test.describe(`${theme} at ${width}px`, () => {
      test("scroll-spy: the chip is the section whose top is under the bar, header and bar included", async ({ page }) => {
        await open(page, theme, width);
        const current = page.locator("[data-testid=area-tabs] [aria-current=true]");
        // Schools just under the bar, and with Safety's tail still showing above it: Schools.
        await topUnderBar(page, "schools", 4);
        await expect(current).toHaveAttribute("data-section", "schools");
        await topUnderBar(page, "schools", 60);
        await expect(current).toHaveAttribute("data-section", "schools");
        // Schools only halfway down the view: still Safety.
        await topUnderBar(page, "schools", Math.round(900 * 0.5));
        await expect(current).toHaveAttribute("data-section", "safety");
        // A chip lands its section under the bar and marks it.
        await page.getByTestId("area-tab-health").click();
        await expect(current).toHaveAttribute("data-section", "health");
        await expect.poll(() => page.evaluate(() => {
          const gap = document.getElementById("health")!.getBoundingClientRect().top
            - document.querySelector("[data-testid=area-tabs]")!.getBoundingClientRect().bottom;
          return gap >= 0 && gap < 40;
        })).toBe(true);
        await expect(current).toHaveAttribute("data-section", "health");
      });

      test("the price chart spans the section, drawn at its real size (board V3-33a)", async ({ page }) => {
        await open(page, theme, width);
        const section = page.getByTestId("evidence-section-price");
        const plot = section.locator(".market-plot > svg");
        await expect(plot).toBeVisible();
        await expect.poll(async () => plot.evaluate((svg) => {
          const body = svg.closest(".area-section__body")!.getBoundingClientRect().width;
          const drawn = svg.getBoundingClientRect().width;
          // Spans the section, and the viewBox matches the drawn width (labels stay 12 px, stitches round).
          return drawn >= body * 0.95 && Math.abs((svg as SVGSVGElement).viewBox.baseVal.width - drawn) <= 2;
        })).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      });

      test("school rows lead with the Ofsted icon, then name, Top 10% and distance (board V3-33b)", async ({ page }) => {
        await open(page, theme, width);
        const schools = page.getByTestId("evidence-section-schools");
        const rows = schools.getByTestId("area-school-row");
        await expect(rows.first()).toBeVisible();
        // No generic building icon and no "Good (2023)" text chip any more.
        await expect(schools.locator(".school-row .chart-icon, .school-row .school-badge")).toHaveCount(0);
        for (const row of await rows.all()) {
          const first = row.locator(":scope > *").first();
          await expect(first).toHaveClass(/school-row__ofsted/);
          await expect(first).toHaveAttribute("aria-label", /Ofsted/);
        }
        await expect(rows.first()).toHaveAttribute("data-ofsted", "report-card");
        await schools.getByTestId("school-phase-secondary").click();
        const top = rows.filter({ has: page.getByTestId("area-school-top") }).first();
        await expect(top).toHaveAttribute("data-ofsted", "good");
        await expect(top.locator("svg.school-row__ofsted")).toHaveAttribute("aria-label", /^Ofsted: Good/);
        expect(await top.locator(":scope > *").evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("class") ?? "").split(" ")[0])))
          .toEqual(["school-row__ofsted", "school-row__name", "school-row__top", "school-row__meta"]);
        await expect(top.getByTestId("area-school-top")).toHaveText("Top 10%");
      });

      test(`tiles: ${width < 760 ? "the first 6, then Show all 12" : "all 12 in four columns"} (board V3-27g)`, async ({ page }) => {
        await open(page, theme, width);
        const tiles = page.getByTestId("area-tiles").locator("[data-testid^=area-tile-]");
        await expect(tiles).toHaveCount(12);
        const shown = async () => (await tiles.evaluateAll((nodes) => nodes.filter((node) => (node as HTMLElement).offsetWidth > 0))).length;
        if (width < 760) {
          expect(await shown()).toBe(6);
          await expect(page.getByTestId("area-tiles-more")).toHaveText("Show all 12");
          await page.getByTestId("area-tiles-more").click();
        } else {
          await expect(page.getByTestId("area-tiles-more")).toBeHidden();
        }
        expect(await shown()).toBe(12);
      });
    });
  }
}
