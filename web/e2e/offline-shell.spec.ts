import { expect, test } from "./fixtures";

// The service worker is registered per build (/sw.js?v=<build id>&m=<MapLibre version>) and keeps
// one cache, named after that build (tests/sw.test.ts covers pruning and the cap).
test.use({ serviceWorkers: "allow" });
test("the service worker is versioned by build and keeps only that build's cache", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one browser is enough for the worker wiring");
  await page.goto("/");
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? "")).toMatch(/\/sw\.js\?v=\w+&m=[\w.-]+$/);
  const { version, keys } = await page.evaluate(async () => ({
    version: new URL((await navigator.serviceWorker.getRegistration())!.active!.scriptURL).searchParams.get("v"),
    keys: await caches.keys(),
  }));
  expect(keys).toEqual([`close-knit-shell-${version}`]);
});
