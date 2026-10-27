import { expect, test, type Page } from "./fixtures";

// v4 Task 32, round 2: opening the map with a selected area fired 20-odd area reads (23 on a desktop) and
// 8+ got HTTP 429. One area view's sections now go to the server in one request (lib/section-batch.ts),
// which reads them as one render: one page view for the API. The e2e server builds with batching on, as
// production does; this page also turns it on in the browser, so it holds whatever the build says.

const AREA = "/?selected=uk%3Alsoa%3AE01000001";

function watchAreaReads(page: Page) {
  const singles: string[] = [];
  const batches: string[][] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/sections") batches.push((request.postDataJSON() as { urls: string[] }).urls);
    else if (/^\/api\/v1\/areas\/uk/.test(url.pathname)) singles.push(`${url.pathname}${url.search}`);
  });
  // The answer streams (NDJSON, one line per section as it is read): Playwright cannot hold its body, and
  // may even report the request as aborted once the page has read it. A URL the stream did not carry is
  // read again on its own, so "no batched URL read singly" is the proof that every line arrived.
  return { singles, batches };
}

test("opening the map on an area reads its sections in a few requests, none of them twice", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("close-knit.section-batch", "on"));
  const reads = watchAreaReads(page);
  await page.goto(AREA);
  await expect(page.getByTestId("selected-area")).toBeVisible();
  await expect.poll(() => reads.batches.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  const batched = reads.batches.flat();
  // Every batched URL was answered in the stream, so none was read again on its own.
  expect(reads.singles.filter((url) => batched.includes(url))).toEqual([]);
  for (const batch of reads.batches) {
    expect(new Set(batch.map((url) => url.split("/")[4].split("?")[0])).size, "one area per batch").toBe(1);
  }
  // Was 23 single reads on a desktop: the panel's own evidence, its wider areas' names and the batches.
  expect(reads.singles.length + reads.batches.length).toBeLessThanOrEqual(8);
});

test("a batch that fails falls back to single reads, and the panel still fills", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("close-knit.section-batch", "on"));
  await page.route("**/api/v1/sections", (route) => route.fulfill({ status: 503, json: { error: "down" } }));
  const reads = watchAreaReads(page);
  await page.goto(AREA);
  await expect(page.getByTestId("selected-area")).toBeVisible();
  await expect.poll(() => reads.batches.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const batched = reads.batches.flat();
  await expect.poll(() => batched.every((url) => reads.singles.includes(url)), { timeout: 15_000 }).toBe(true);
});
