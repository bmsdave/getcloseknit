import { expect, test } from "./fixtures";

// Dead ends (review #4): an unknown page keeps its 404 status but answers with
// the site header, a search and the way back; the search never offers a
// postcode page it cannot open.
test("an unknown postcode is a 404 with the branded page, a search and the way back", async ({ page, request }) => {
  expect((await request.get("/postcode/nope")).status()).toBe(404);
  expect((await request.get("/postcode/ZZ9-9ZZ")).status()).toBe(404);
  expect((await request.get("/no-such-page")).status()).toBe(404);

  const response = await page.goto("/postcode/ZZ9-9ZZ");
  expect(response?.status()).toBe(404);
  const notFound = page.getByTestId("not-found-page");
  await expect(notFound.getByTestId("site-header")).toBeVisible();
  await expect(notFound.getByRole("heading", { level: 1 })).toHaveText("We can't find ZZ9 9ZZ");
  await expect(notFound).toContainText("We cover Greater London");
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  await expect(notFound.getByTestId("not-found-map")).toHaveAttribute("href", "/");
  await expect(notFound.getByRole("link", { name: "Guide", exact: true }).last()).toHaveAttribute("href", "/guide");

  // The search leads somewhere real.
  await notFound.getByLabel("Search postcode, street or area").fill("SW1A 1AB");
  const results = notFound.getByTestId("not-found-results");
  await expect(results.getByRole("link", { name: /SW1A 1AB.*Prices & sales/ })).toHaveAttribute("href", "/postcode/SW1A-1AB", { timeout: 15_000 });
  await notFound.getByLabel("Search postcode, street or area").fill("ZZ9 9ZZ");
  await expect(notFound.getByRole("status")).toHaveText(/We can't find ZZ9 9ZZ/);
  await expect(results).toHaveCount(0);
});

test("the map's search offers no page for a postcode it cannot find, and says so", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await search.fill("ZZ9 9ZZ");
  await expect(page.getByTestId("search-no-match")).toHaveText("We can't find ZZ9 9ZZ — check it, or try a street or area name.");
  await expect(page.getByRole("option", { name: /Prices & sales/ })).toHaveCount(0);
  await search.press("Enter");
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(page.getByTestId("search-no-match")).toBeVisible();

  // A postcode the search knows still leads with its page, and Enter opens it.
  await search.fill("sw1a1ab");
  await expect(page.getByRole("option", { name: /SW1A 1AB.*Prices & sales/ })).toBeVisible();
  await search.press("Enter");
  await expect(page).toHaveURL(/\/postcode\/SW1A-1AB$/, { timeout: 20_000 }); // a cold dev compile
});
