import { readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { test as base, expect, type Page, type Request, type Route } from "@playwright/test";

import { mayMatch, type UrlMatch } from "./route-match";

export * from "@playwright/test";

/** How long a navigation waits for hydration. */
const HYDRATION_TIMEOUT = 15_000;

/**
 * Waits for the app to hydrate after a full navigation (components/hydration-mark.tsx sets <html data-hydrated>):
 * until then a click lands on server HTML without its handlers and a typed field is reset. Pages that are not the
 * app (JSON, images, a sitemap) carry no Next.js scripts, and an offline page is the service worker's shell: both
 * are left as they load. A page still not hydrated after the wait goes on as before: what the spec checks next
 * says what is wrong, and a spec that reads only the server's HTML never needed it.
 */
async function hydrated(page: Page) {
  const app = await page.evaluate(() => navigator.onLine && document.contentType === "text/html"
    && !!document.querySelector("script[src*='/_next/']")).catch(() => false);
  if (!app) return;
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-hydrated"), null, { timeout: HYDRATION_TIMEOUT })
    .catch(() => undefined);
}

/**
 * Section batching is on, as in production (lib/section-batch.ts): an area's section reads reach the server as
 * one POST /api/v1/sections, which a spec's page.route on one section URL never sees. So once a spec routes
 * anything, each batch leaves out the URLs it routed: the server sends no line for them and the browser reads
 * each on its own (the batch's own fallback), through the spec's route. The rest are read in the batch. A spec's
 * own route on /api/v1/sections is added later, so it comes first. A page no spec routes is left unrouted.
 */
function batchAroundMocks(page: Page) {
  const routed: UrlMatch[] = [];
  const route = page.route.bind(page);
  page.route = (async (match, handler, options) => {
    if (routed.length === 0) await route("**/api/v1/sections", (batch: Route) => {
      const urls = (batch.request().postDataJSON() as { urls?: unknown } | null)?.urls;
      if (!Array.isArray(urls)) return batch.fallback();
      const kept = urls.filter((url) => !routed.some((pattern) => mayMatch(pattern, new URL(String(url), batch.request().url()))));
      if (kept.length === urls.length) return batch.fallback();
      if (kept.length === 0) return batch.fulfill({ status: 200, contentType: "application/x-ndjson", body: "" });
      return batch.fallback({ postData: JSON.stringify({ urls: kept }) });
    });
    routed.push(match);
    return route(match, handler, options);
  }) as Page["route"];
}

/** Fails a spec listed as DOM-only (DOM_SPECS, playwright.config.ts) that draws the map: it belongs with the map specs. */
async function noWebGl(page: Page) {
  const drew: string[] = [];
  await page.exposeBinding("__e2eWebGl", ({ frame }) => { drew.push(frame.url()); });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith("webgl")) (window as unknown as { __e2eWebGl(): Promise<void> }).__e2eWebGl().catch(() => undefined);
      return (getContext as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof getContext;
  });
  return drew;
}

/** Most trace recordings one worker keeps (playwright.config.ts traces every test and keeps a failure's). */
const TRACE_CAP_MB = 128;

/**
 * Every test's trace recording (actions, network bodies, DOM snapshots) piles up in one folder per worker until
 * it exits, though only a failure's is kept, zipped into its own results. Over the cap, the folder is emptied
 * before the next test starts tracing.
 */
function capTraces(outputDir: string, workerIndex: number) {
  const folder = join(outputDir, `.playwright-artifacts-${workerIndex}`, "traces");
  let bytes = 0;
  try {
    for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) bytes += statSync(join(entry.parentPath, entry.name)).size;
    }
  } catch {
    return; // no traces yet
  }
  if (bytes <= TRACE_CAP_MB * 1024 * 1024) return;
  for (const entry of readdirSync(folder)) rmSync(join(folder, entry), { recursive: true, force: true });
}

/**
 * The specs' `test`: `page.goto` and `page.reload` return once the page has hydrated, as a visitor's first tap
 * would need. A navigation that asks for an earlier point (waitUntil "commit" or "domcontentloaded") and pages
 * without JavaScript keep Playwright's own behaviour.
 */
export const test = base.extend<{ traceCap: void }>({
  traceCap: [async ({}, use, testInfo) => {
    capTraces(testInfo.project.outputDir, testInfo.workerIndex);
    await use();
  }, { auto: true }],
  page: async ({ page, javaScriptEnabled }, use, testInfo) => {
    if (javaScriptEnabled !== false) {
      for (const method of ["goto", "reload"] as const) {
        const navigate = page[method].bind(page) as (...args: unknown[]) => ReturnType<Page["goto"]>;
        page[method] = (async (...args: unknown[]) => {
          const options = args.find((arg) => typeof arg === "object" && arg !== null) as { waitUntil?: string } | undefined;
          const response = await navigate(...args);
          if (!options?.waitUntil || options.waitUntil === "load" || options.waitUntil === "networkidle") await hydrated(page);
          return response;
        }) as Page["goto"] & Page["reload"];
      }
    }
    batchAroundMocks(page);
    const drew = testInfo.project.metadata.dom ? await noWebGl(page) : [];
    await use(page);
    expect(drew, `${basename(testInfo.file)} drew the map (WebGL): take it out of DOM_SPECS in playwright.config.ts`).toEqual([]);
  },
});

/** The URLs a request reads: its own, or each one in a section batch (lib/section-batch.ts). */
export function areaReads(request: Request): string[] {
  const url = new URL(request.url());
  if (url.pathname !== "/api/v1/sections") return [url.href];
  const urls = (request.postDataJSON() as { urls?: unknown } | null)?.urls;
  return Array.isArray(urls) ? urls.map((each) => new URL(String(each), url).href) : [];
}

/**
 * A timed input or a measuring window, never a wait for the app: a response a spec serves late, a finger held
 * still before it lifts, layout shifts counted after a load.
 */
export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * For what must not happen (a late request, a panel closing, the camera moving): `check` passes now and keeps
 * passing for `ms`. It is checked every 100 ms, so a break fails as it happens rather than only at the end.
 */
export async function expectSteady(check: () => unknown, ms: number): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    await check();
    if (Date.now() >= end) return;
    await pause(100);
  }
}
