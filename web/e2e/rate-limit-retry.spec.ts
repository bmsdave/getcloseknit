import { expect, test } from "./fixtures";

// A 429 from the API is waited out (Retry-After) and retried, so a burst of
// panel requests reads as a short delay, never "Evidence is unavailable".
test("a rate-limited area request is retried instead of showing an error", async ({ page }) => {
  let limited = 0;
  await page.route(/\/api\/v1\/areas\/uk%3Alsoa%3AE01000001\?/, async (route) => {
    if (limited < 1) {
      limited += 1;
      await route.fulfill({ status: 429, headers: { "retry-after": "1" }, contentType: "application/json",
        body: '{"detail":{"error":"too-many-requests"}}' });
      return;
    }
    await route.fallback();
  });
  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(page.getByText("status 429")).toHaveCount(0);
  expect(limited).toBe(1);
});
