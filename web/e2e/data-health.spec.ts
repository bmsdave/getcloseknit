import { expect, test } from "./fixtures";

import { showFullAreaView } from "./evidence";

const DEGRADED_HEALTH = {
  status: "degraded",
  code: "stale-source",
  productReleaseId: "product-2026-07",
  checks: [],
  notice: "Crime data last updated Mar 2026",
  unavailableReasons: [
    "source police-uk release police-uk-2026-03 retrieved 2026-03-01 exceeds the 45-day expected cadence",
  ],
};

test("freshness warning opens and correction prepare stays profile-free", async ({ page }) => {
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(DEGRADED_HEALTH),
    });
  });
  const correctionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/corrections")) correctionRequests.push(request.url());
  });

  await page.goto("/?selected=uk%3Alsoa%3AE01000001&period=2026-06");

  const warning = page.getByTestId("freshness-warning");
  await expect(warning).toBeVisible();
  // G-E03: words for people up front; the source and release ids only behind the toggle.
  await expect(warning).toContainText("Crime data last updated Mar 2026");
  await expect(warning).not.toContainText("police-uk-2026-03");
  const toggle = page.getByTestId("freshness-warning-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const details = page.getByTestId("freshness-details");
  await expect(details).toContainText("stale-source");
  await expect(details).toContainText("police-uk-2026-03");
  await expect(details).toContainText("product-2026-07");

  // "Report a wrong figure" stays at the end of the area view (G26; a phone's sheet at full, v4 Task 12);
  // there is no About this data fold (v3 Fix 22.8).
  await showFullAreaView(page);
  await expect(page.getByTestId("about-this-data")).toHaveCount(0);
  await expect(page.getByTestId("correction-report-open")).toBeVisible();
  await page.getByTestId("correction-report-open").click();
  await expect(page.getByTestId("correction-report-form")).toBeVisible();
  await expect(page.getByTestId("correction-observation-id")).toContainText("uk:lsoa:E01000001");
  await expect(page.getByTestId("correction-source-release")).not.toBeEmpty();
  await page.getByTestId("correction-kind-transformation").check();
  await expect(page.getByTestId("correction-kind-transformation")).toBeChecked();
  await page.getByLabel("What looks wrong? (optional)").fill(
    "Rate disagrees with the publisher bulletin.",
  );
  // Nothing leaves the page until Send; Send posts the figure's ids and the words typed, no search profile.
  expect(correctionRequests).toEqual([]);
  const posted: Record<string, unknown>[] = [];
  await page.route("**/api/v1/corrections", async (route) => {
    posted.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "transformation-error", id: 7 }) });
  });
  await page.getByTestId("correction-report-send").click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].kind).toBe("transformation-error");
  expect(String(posted[0].observationId)).toContain("uk:lsoa:E01000001");
  expect(posted[0].description).toBe("Rate disagrees with the publisher bulletin.");
  const allowed = ["kind", "observationId", "productReleaseId", "sourceReleaseId", "description"];
  expect(Object.keys(posted[0]).filter((key) => !allowed.includes(key))).toEqual([]);
  await expect(page.getByTestId("home-correction-outcome")).toContainText("reference 7");
});
