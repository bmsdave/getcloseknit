import { expect, test } from "./fixtures";

const PATH = "/property/at/W5-1LR/120-meadvale-road";

test("an old postcode link with ?address= permanently redirects to the street-level home", async ({ request, page }) => {
  const response = await request.get("/postcode/W5-1LR?address=120+Meadvale+Road&near=116-124", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location, "http://x").pathname).toBe(PATH);
  await page.goto("/postcode/W5-1LR?address=120+Meadvale+Road&near=116-124");
  expect(new URL(page.url()).pathname).toBe(PATH);
});

test("the street-level home is named, noindex, and says there is no recorded sale", async ({ page }) => {
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("120 Meadvale Road");
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
  await expect(page.getByTestId("street-home-note")).toHaveText(
    "No recorded sale; postcode likely W5 1LR (numbers 116 and 124 either side)");
  await expect(page.getByTestId("breadcrumbs").getByRole("link", { name: "W5 1LR" })).toHaveAttribute("href", "/postcode/W5-1LR");
});

test("a number outside the street's recorded range is the not-found page, noindex", async ({ page }) => {
  const response = await page.goto("/property/at/W5-1LR/999-meadvale-road");
  expect(response?.status()).toBe(404);
  // Next's own noindex on the 404, beside the private preview's layout meta (see seo.spec.ts).
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("999 Meadvale Road");
});

test("a number within the street's recorded range with no record (or a hidden one) is the street-level page", async ({ page }) => {
  const response = await page.goto("/property/at/W5-1LR/122-meadvale-road");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("122 Meadvale Road");
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
});

test("a recorded home without a UPRN goes to its postcode page, never a no-sale page", async ({ page }) => {
  await page.goto("/property/at/W5-1LR/116-meadvale-road");
  expect(new URL(page.url()).pathname).toBe("/postcode/W5-1LR");
  await expect(page.getByTestId("street-home-note")).toHaveCount(0);
});

test("a recorded home redirects to its property page", async ({ page }) => {
  const response = await page.goto("/property/at/SW1A-1AB/10-sample-street");
  expect(new URL(page.url()).pathname).toBe("/property/100000000001");
  expect(response?.status()).toBe(200);
});

test("an old postcode link with a plain address (no house number) keeps the postcode page", async ({ page }) => {
  const response = await page.goto("/postcode/sw1a-1ab?address=Sample+Street");
  expect(response?.status()).toBe(200);
  // PR #130 (v4 Task 40): another case moves to the canonical postcode page.
  expect(new URL(page.url()).pathname).toBe("/postcode/SW1A-1AB");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SW1A 1AB");
});

test("an old ?address= link to an unknown number ends in a 404 with noindex", async ({ page }) => {
  const response = await page.goto("/postcode/W5-1LR?address=999+Meadvale+Road&near=998-1000");
  expect(new URL(page.url()).pathname).toBe("/property/at/W5-1LR/999-meadvale-road");
  expect(response?.status()).toBe(404);
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
});
