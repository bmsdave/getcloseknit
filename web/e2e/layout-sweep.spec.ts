import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, pause, test, type Browser, type Page } from "./fixtures";

import { PROFILE_KEY, SEEDED_SEARCH } from "./wizard";

// #14 layout sweep (gate.sh --mobile): every sitemap route plus the journey
// pages the sitemap leaves out; each page template's first route and every
// journey at 320/768/1024/1440 in Day and Night, the rest at 320 (plan). Each
// load asserts: no horizontal page overflow, opened menus and dialogs inside
// the viewport, CLS under 0.1 (0.05 or less on the area page), and no console
// errors. Runs once, from the mobile project, with its own contexts.

const WIDTHS = [320, 768, 1024, 1440] as const;
const SCHEMES = ["light", "dark"] as const;
const JOURNEYS = [
  "/?selected=uk%3Alsoa%3AE01000001", "/area/lsoa/E01000001", "/postcode/sw1a-1ab", "/postcode/SW1A-1AB/homes",
  "/property/100000000001", "/brief", "/tools", "/tools/stamp-duty", "/guide", "/guide/glossary", "/agents", "/rankings", "/area/london", "/privacy",
  "/terms", "/about",
];
const AREA_PAGE = /^\/area\/lsoa\//;
// Menus that open in place; each one's panel must stay on screen.
const MENUS = "details:is(.property-more, .area-full__more-menu, .postcode-more) > summary";

// The sweep is split into tests so a full run spreads it over the workers.
const SHARDS = 3;
// Dynamic segments that pick a different page layout (an LSOA, MSOA and borough page differ): their value is
// part of the template.
const LAYOUT_PARAMS = new Set(["carrier"]);

interface Sweep { route: string; full: boolean }

async function sitemapRoutes(page: Page): Promise<string[]> {
  const response = await page.request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  const paths = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
  return [...new Set([...JOURNEYS, ...paths])];
}

/** The app's page templates (src/app/**\/page.tsx) as segment lists: "/guide/[slug]" → ["guide", "[slug]"]. */
function pageTemplates(): string[][] {
  const root = fileURLToPath(new URL("../src/app", import.meta.url));
  const found: string[][] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === "page.tsx") found.push(segments);
      // Route groups, "(name)", add no segment.
      else if (entry.isDirectory()) walk(`${dir}/${entry.name}`, /^\(.+\)$/.test(entry.name) ? segments : [...segments, entry.name]);
    }
  };
  walk(root, []);
  return found;
}

/** The template a route renders with ("/rankings/[slug]", "/area/lsoa/[code]"), static segments first as Next.js
 *  matches them; the route itself when no template matches. */
function templateOf(route: string, templates: string[][]): string {
  const parts = route.split("/").filter(Boolean);
  const dynamic = (segment: string) => segment.startsWith("[");
  // "0" per static segment, "1" per dynamic one: the lowest key is the most static match.
  const precedence = (template: string[]) => template.map((segment) => (dynamic(segment) ? "1" : "0")).join("");
  const template = templates
    .filter((candidate) => candidate.length === parts.length
      && candidate.every((segment, index) => dynamic(segment) || segment === parts[index]))
    .sort((a, b) => precedence(a).localeCompare(precedence(b)))[0];
  if (!template) return route;
  return "/" + template.map((segment, index) => (LAYOUT_PARAMS.has(segment.slice(1, -1)) ? parts[index] : segment)).join("/");
}

/** Every route, each template's first one (a journey route when it has one) and every journey at every width
 *  and theme; the other routes of a template, whose content differs but layout does not, at 320 px Day, the
 *  width where content overflows first. */
function plan(routes: readonly string[]): Sweep[] {
  const templates = pageTemplates();
  const seen = new Set<string>();
  return routes.map((route) => {
    const template = templateOf(route, templates);
    const full = JOURNEYS.includes(route) || !seen.has(template);
    seen.add(template);
    return { route, full };
  });
}

async function sweep(browser: Browser, baseURL: string, { route, full }: Sweep): Promise<string[]> {
  const problems: string[] = [];
  for (const colorScheme of full ? SCHEMES : SCHEMES.slice(0, 1)) {
    for (const width of full ? WIDTHS : WIDTHS.slice(0, 1)) {
      const mobile = width < 768;
      const context = await browser.newContext({
        baseURL, colorScheme, viewport: { width, height: mobile ? 760 : 900 }, isMobile: mobile, hasTouch: mobile,
      });
      await context.addInitScript(() => {
        const shifts: number[] = [];
        (window as unknown as { __shifts: number[] }).__shifts = shifts;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
            if (!entry.hadRecentInput) shifts.push(entry.value);
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 140)); });
      page.on("pageerror", (error) => errors.push(`pageerror ${error.message.slice(0, 140)}`));
      const where = `${route} @${width} ${colorScheme}`;
      await page.goto(route, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      // Layout shifts are counted over the load and 400 ms after it.
      await pause(400);

      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        cls: (window as unknown as { __shifts: number[] }).__shifts.reduce((sum, value) => sum + value, 0),
      }));
      if (layout.overflow > 1) problems.push(`${where}: page overflows by ${layout.overflow}px`);
      const limit = AREA_PAGE.test(route) ? 0.05 : 0.1;
      if (layout.cls > limit) problems.push(`${where}: CLS ${layout.cls.toFixed(3)} > ${limit}`);

      // Open each in-place menu (and the map's ≡ menu) and keep its panel inside the viewport.
      const toggle = page.getByTestId("top-menu-toggle");
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
        await page.getByTestId("top-menu").waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
        problems.push(...(await offscreen(page, "[data-testid='top-menu']")).map((line) => `${where}: ${line}`));
        await page.keyboard.press("Escape");
      }
      for (const summary of await page.locator(MENUS).all()) {
        if (!(await summary.isVisible())) continue;
        await summary.click();
        problems.push(...(await offscreen(page, "details[open]:is(.property-more, .area-full__more-menu, .postcode-more)")).map((line) => `${where}: ${line}`));
        await summary.click();
      }
      problems.push(...(await offscreen(page, "dialog[open], [role='dialog']")).map((line) => `${where}: ${line}`));
      problems.push(...errors.map((error) => `${where}: console ${error}`));
      await context.close();
    }
  }
  return problems;
}

/** Visible boxes inside the matched elements that leave the viewport. */
async function offscreen(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((query) => {
    const out: string[] = [];
    for (const root of document.querySelectorAll<HTMLElement>(query)) {
      for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0 || getComputedStyle(element).visibility === "hidden") continue;
        if (box.left < -1 || box.right > window.innerWidth + 1) {
          out.push(`${root.className || root.tagName} leaves the viewport (${Math.round(box.left)}…${Math.round(box.right)})`);
          break;
        }
      }
    }
    return out;
  }, selector);
}

test.describe("layout sweep", () => {
  for (let shard = 0; shard < SHARDS; shard += 1) {
    test(`sitemap and journey routes hold their layout (${shard + 1}/${SHARDS})`, async ({ browser, page, baseURL }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "runs once, from gate.sh --mobile");
      // ~120 routes; each template's first at 4 widths × 2 themes, the rest once (plan): a few minutes a shard.
      test.setTimeout(15 * 60_000);
      // SWEEP_ROUTES="/a,/b" narrows a local run while debugging (every width and theme).
      const sweeps = process.env.SWEEP_ROUTES
        ? process.env.SWEEP_ROUTES.split(",").map((route) => ({ route, full: true }))
        : plan(await sitemapRoutes(page));
      // Full sweeps first, then dealt round-robin, so the shards carry about the same load.
      const mine = [...sweeps.filter((item) => item.full), ...sweeps.filter((item) => !item.full)]
        .filter((_, index) => index % SHARDS === shard);
      const problems: string[] = [];
      // Three routes at a time.
      for (let start = 0; start < mine.length; start += 3) {
        const batch = mine.slice(start, start + 3);
        for (const found of await Promise.all(batch.map((item) => sweep(browser, baseURL ?? "", item)))) problems.push(...found);
      }
      const full = mine.filter((item) => item.full).length;
      testInfo.annotations.push({ type: "routes", description: `${full} routes × ${WIDTHS.length} widths × 2 themes, ${mine.length - full} at 320 px` });
      expect(problems).toEqual([]);
    });
  }

  // The ranking with a long place name: every row (and its tick) stays inside the panel.
  test("the ranking with a long place name holds its layout", async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "runs once, from gate.sh --mobile");
    test.setTimeout(5 * 60_000);
    const profile = { ...SEEDED_SEARCH, places: [{
      id: "p1", label: "Waterloo preview station", target: { kind: "point", latitude: 51.5031, longitude: -0.1132 },
      mode: "transit", targetMinutes: 25, weight: 3, must: false,
    }] };
    const problems: string[] = [];
    for (const colorScheme of SCHEMES) {
      for (const width of WIDTHS) {
        const mobile = width < 768;
        const context = await browser.newContext({
          baseURL, colorScheme, viewport: { width, height: mobile ? 760 : 900 }, isMobile: mobile, hasTouch: mobile,
        });
        await context.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), { key: PROFILE_KEY, value: profile });
        const page = await context.newPage();
        await page.goto("/?layer=personal-match");
        await page.getByTestId("match-row-why").first().waitFor();
        const found = await page.evaluate(() => {
          const out: string[] = [];
          const panel = document.querySelector(".match-panel")!.getBoundingClientRect();
          const dock = document.querySelector<HTMLElement>(".dock-area, .match-sheet .map-sheet__body");
          if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push("page overflows");
          if (dock && dock.scrollWidth > dock.clientWidth + 1) out.push(`dock scrolls sideways by ${dock.scrollWidth - dock.clientWidth}px`);
          for (const element of document.querySelectorAll<HTMLElement>(".match-panel *")) {
            const box = element.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            if (box.right > panel.right + 1) { out.push(`${element.className || element.tagName} ends at ${Math.round(box.right)} past ${Math.round(panel.right)}`); break; }
          }
          return out;
        });
        problems.push(...found.map((line) => `ranking @${width} ${colorScheme}: ${line}`));
        await context.close();
      }
    }
    expect(problems).toEqual([]);
  });
});
