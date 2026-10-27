import assert from "node:assert/strict";
import test from "node:test";

import config from "../playwright.config";

const DEV_PREVIEW_PORT = 4180;

function webServerUrl(): URL {
  const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
  assert.equal(servers.length, 1, "one test server so journeys cannot split across builds");
  const server = servers[0];
  assert.equal(server?.reuseExistingServer, false, "never validate a stale preview on a reused server");
  assert.ok((server?.timeout ?? 0) > 0, "a server that fails to start fails the run");
  assert.ok(server?.url, "the test server probes a fixed URL");
  return new URL(server.url);
}

function requiredBrowsers(): string[] {
  const browsers = (config.projects ?? []).map(
    (project) => project.use?.defaultBrowserType ?? "chromium",
  );
  return [...new Set(browsers)].sort();
}

test("browser journeys run against the isolated test server, never the dev preview", () => {
  const server = webServerUrl();
  assert.notEqual(server.port, String(DEV_PREVIEW_PORT), "test port is isolated from the running preview");
  assert.equal(config.use?.baseURL, server.href.replace(/\/$/, ""), "journeys hit the server Playwright started");
});

test("every configured journey runs on Chromium, the only browser CI installs", () => {
  // Desktop Chrome plus a Chromium phone profile (Pixel 7): WebKit profiles
  // hang page.goto under page.route and are not installed by the workflow.
  assert.deepEqual(requiredBrowsers(), ["chromium"]);
  // Two projects per device (the map specs and the DOM specs), both named after it.
  assert.deepEqual([...new Set((config.projects ?? []).map((project) => project.name))].sort(), ["desktop", "mobile"]);
  for (const mobile of (config.projects ?? []).filter((project) => project.name === "mobile")) {
    assert.equal(mobile.use?.isMobile, true, "the mobile projects emulate a phone");
  }
});
