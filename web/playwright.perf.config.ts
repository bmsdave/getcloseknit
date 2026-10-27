import { defineConfig, devices } from "@playwright/test";

// Layer load times (perf/layer-load/README.md): its own test dir, so `npm run test:e2e` never runs it.
// No web server: it measures a running site, local or production through a tunnel (PERF_BASE_URL).
// One worker, one page at a time: production's API rate limiter is shared by everyone.
export default defineConfig({
  testDir: "./e2e-perf",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 240_000,
  // Playwright empties its output dir at the start: the results lines (scripts/perf-layers.mjs) live beside it.
  outputDir: "test-results/perf-artifacts",
  use: {
    baseURL: process.env.PERF_BASE_URL ?? "http://127.0.0.1:4180",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
    trace: "off",
  },
});
