import { defineConfig, devices } from "@playwright/test";

// The test server intentionally avoids the dev preview port (4180): a stale
// preview answering on the probed URL would otherwise validate the wrong build.
// 4190 is on WebKit's restricted-port list ("Not allowed to use restricted
// network port"), which made every mobile (iPhone/WebKit) test time out on
// page.goto — hence 4280.
const testPort = Number(process.env.PLAYWRIGHT_TEST_PORT ?? 4280);
const testOrigin = `http://127.0.0.1:${testPort}`;

// Specs that never draw the map (no WebGL: area, postcode, school and ranking pages, the API). They run with more
// workers than the map specs, which draw WebGL in software (SwiftShader) and time out when too many run at once.
// e2e/fixtures.ts fails a spec listed here that draws the map, so the list cannot go stale unnoticed.
const DOM_SPECS = [
  "api-contracts.spec.ts",
  "charts.spec.ts",
  "civic.spec.ts",
  "kids-tiles.spec.ts",
  "market-pack.spec.ts",
  "print-area.spec.ts",
  "rankings-next-step.spec.ts",
  "school-card-sections.spec.ts",
  "schools-hub.spec.ts",
  "subpage-polish.spec.ts",
  "teams-page.spec.ts",
];

// Map specs per device project: a full run draws four maps at once. Against `next dev`, Playwright's default
// (5 on a 10-core Mac) failed 96 and 147 of 1,742 tests on timeouts in two runs of an unchanged main, so every
// spec ran on three workers (42 min).
const MAP_WORKERS = 2;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // All projects together: the DOM specs fill what the map specs leave.
  workers: 5,
  // A map page's async data (the area's panel, its painted pack) under parallel software WebGL can take longer
  // than Playwright's 5 s default; hydration is waited for in e2e/fixtures.ts.
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: "line",
  use: {
    baseURL: testOrigin,
    // A failure keeps its trace (actions, DOM snapshots, network, console). Every test records one, and a worker
    // keeps the recordings until it exits (1.2 GB each over a full run once filled the disk): no screencast
    // frames, and e2e/fixtures.ts empties a worker's recordings past a cap.
    trace: { mode: "retain-on-first-failure", screenshots: false, snapshots: true, sources: false },
    screenshot: "only-on-failure",
    // The service worker (public/sw.js) answers area tiles and ?v= data cache-first, and what it fetches never
    // reaches page.route: once it controls the page, a spec's mocked map data is replaced by the test server's.
    // The specs about the worker itself turn it back on (offline-shell.spec.ts, explorer.spec.ts).
    serviceWorkers: "block",
  },
  // Two projects per device, both named after it (so `--project=desktop` and `testInfo.project.name` mean what
  // they did): the map specs on fewer workers, the DOM specs on the rest.
  projects: [
    { name: "desktop", testIgnore: DOM_SPECS, workers: MAP_WORKERS, use: { ...devices["Desktop Chrome"] } },
    { name: "desktop", testMatch: DOM_SPECS, metadata: { dom: true }, use: { ...devices["Desktop Chrome"] } },
    // Chromium-based phone profile: CI installs chromium only, and WebKit
    // (iPhone profiles) hangs page.goto whenever a spec uses page.route.
    { name: "mobile", testIgnore: DOM_SPECS, workers: MAP_WORKERS, use: { ...devices["Pixel 7"] } },
    { name: "mobile", testMatch: DOM_SPECS, metadata: { dom: true }, use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // As in production: a production build (no compiling on first request) with section batching on
    // (lib/section-batch.ts; e2e/fixtures.ts keeps a spec's mocked section URLs out of the batch). The basemap is
    // the local fixture style; CLOSE_KNIT_DEMO_PAGES keeps the development-only /dev/charts page in the build.
    command: `npm run build && npx next start --hostname 127.0.0.1 --port ${testPort}`,
    env: { NEXT_PUBLIC_BASEMAP_STYLE_URL: "/api/v1/style", CLOSE_KNIT_DEMO_PAGES: "on" },
    url: testOrigin,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
