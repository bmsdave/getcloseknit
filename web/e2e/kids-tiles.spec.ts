import { expect, test } from "./fixtures";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";

// Kids figures on the area page, in demo mode (lib/kids.ts fixtures stand in for area-kids.v1): each is a
// row in its own section (v3 Fix 33b): nurseries under Schools, road casualties under Safety, cycle lanes
// under Getting around. A household with children gets them first and marked ▸; nothing is ever hidden.

test("Kids: nurseries, road casualties and cycle lanes are rows in their own sections", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001");
  const nurseries = page.getByTestId("evidence-section-schools").getByTestId("nurseries");
  await expect(nurseries).toContainText(/Nurseries ≤ 1 km\d+ well rated: Preview Nursery \d+ m/, { timeout: 30_000 });
  await expect(page.getByTestId("evidence-section-safety").getByTestId("road-casualties")).toContainText(/\d+ in \d+ years · \d+ child(ren)? · \d+ serious or fatal/);
  await expect(page.getByTestId("evidence-section-getting-around").getByTestId("cycle-lanes")).toContainText(/km protected/);
  // Without a household, nothing is marked as theirs.
  await expect(page.locator(".key-numbers > div[data-mine]")).toHaveCount(0);
  await expect(page.getByTestId("kids-tiles")).toHaveCount(0);
});

test("Kids: a household with children under 5 gets nurseries and road casualties first, marked", async ({ page }) => {
  await page.addInitScript((profile) => {
    window.localStorage.setItem("close-knit.preference-profile.v1", JSON.stringify(profile));
    window.localStorage.setItem("close-knit.tailor-only.v1", "1");
  }, { ...DEFAULT_PROFILE, household: "kids-under5" });
  await page.goto("/area/lsoa/E01000001");
  const schools = page.getByTestId("schools-key-numbers").locator(":scope > div").first();
  await expect(schools).toHaveAttribute("data-testid", "nurseries", { timeout: 30_000 });
  await expect(schools).toHaveAttribute("data-mine", "");
  const safety = page.getByTestId("safety-key-numbers").locator(":scope > div").first();
  await expect(safety).toHaveAttribute("data-testid", "road-casualties");
  await expect(safety).toHaveAttribute("data-mine", "");
});

test("Kids: no figures for a borough (they are per LSOA and MSOA)", async ({ page }) => {
  await page.goto("/area/lad/E09000001");
  await expect(page.getByTestId("area-sources")).toBeVisible();
  await expect(page.getByTestId("nurseries")).toHaveCount(0);
});
