import { expect, test } from "./fixtures";

// Wave 1 / feature 6: the printable area evidence pack — cited aggregates,
// no valuation, no sale rows, the leasehold figure as a share of sales.
test("the area evidence pack cites its sources and withholds thin medians", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001/pack");

  const pack = page.getByTestId("market-pack");
  // The name people use is the heading; the official name sits beneath it.
  await expect(pack.getByRole("heading", { level: 1 })).toHaveText("St James's · SW1A");
  await expect(pack.getByTestId("market-pack-official")).toHaveText("Westminster preview LSOA");
  await expect(pack.getByTestId("pack-market")).toContainText("share of sales, not of homes");
  await expect(pack.getByTestId("pack-market")).toContainText("New-build premium not shown");
  await expect(pack.getByTestId("pack-crime")).toContainText("per 1,000 residents");
  await expect(pack.getByTestId("pack-schools")).toContainText("Preview Academy");
  await expect(pack.getByTestId("pack-sources").getByRole("link", { name: "HM Land Registry Price Paid Data" }))
    .toHaveAttribute("href", /^https:\/\//);
  await expect(pack.getByTestId("pack-nearby")).toHaveCount(0);

  // Conclusions first; release ids live in the Sources list, cited by number.
  await expect(pack.getByTestId("pack-summary")).toContainText("63% of them leasehold");
  await expect(pack.getByTestId("pack-market")).not.toContainText("preview-hmlr-ppd");
  await pack.getByTestId("pack-market").getByRole("link", { name: /^Source \d: HM Land Registry/ }).first().click();
  await expect(page).toHaveURL(/#pack-source-\d$/);
  await expect(pack.getByTestId("pack-sources")).toContainText("preview-hmlr-ppd");
  // The limits start folded and open for print.
  await expect(pack.getByTestId("pack-limits")).not.toHaveAttribute("open");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(pack.getByTestId("pack-limits")).toHaveAttribute("open");

  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("print-button")).toBeHidden();
});

test("with an address the pack adds building and street aggregates, not sale rows", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001/pack?address=uk:addr:a1b2c3d4e5f6");

  const nearby = page.getByTestId("pack-nearby");
  await expect(nearby).toContainText("Same building: 2 other sales in 10 years; median not shown");
  await expect(nearby).toContainText("£10,500/m²");
  await expect(page.getByTestId("market-pack")).not.toContainText("610,000");
});

test("an address outside the area is refused and an unknown area is a 404", async ({ page }) => {
  await page.goto("/area/lsoa/E01000001/pack?address=uk:addr:000000000000");
  await expect(page.getByTestId("market-pack-unavailable")).toContainText("not inside this area");

  const missing = await page.goto("/area/lsoa/E01999999/pack");
  expect(missing?.status()).toBe(404);
});
