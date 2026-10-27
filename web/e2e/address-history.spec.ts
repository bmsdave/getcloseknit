import { expect, test } from "./fixtures";
import { openEvidenceSection } from "./evidence";

test("building search shows the last sale in the brief and the per-building history on the full page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("Sample Street");
  await page.getByRole("option", { name: /10 Sample Street/ }).click();

  const home = page.getByTestId("brief-home");
  await expect(home).toContainText("10 Sample Street");
  await expect(home.getByTestId("brief-home-sale")).toHaveText("Last sold £570,000 · Nov 2022 · 2 sales");
  await expect(home.getByTestId("brief-home-record").getByRole("link", { name: /HM Land Registry/ }))
    .toHaveAttribute("href", "https://landregistry.data.gov.uk/app/ppd/search?postcode=SW1A+1AB");

  // Listing photos stay on the portals: links out only, never copied or hosted here.
  const listings = home.getByTestId("brief-home-listings");
  await expect(listings.getByRole("heading", { name: "View listing photos" })).toBeVisible();
  const portals = listings.getByRole("link");
  await expect(portals).toHaveText([/Rightmove/, /Zoopla/, /OnTheMarket/]);
  await expect(portals.first()).toHaveAttribute("href", "https://www.rightmove.co.uk/house-prices/sw1a-1ab.html");
  for (const link of await portals.all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }
  await expect(listings).toContainText("Links to the portals; Close Knit doesn't host listings.");
  await expect(listings.getByRole("img")).toHaveCount(0);
  await expect(home).not.toContainText(/Estimated price|worth|would be around|Now ~|Medium confidence|£\/m²/);

  await openEvidenceSection(page, "Homes sold nearby");
  const history = page.getByTestId("address-history");
  await expect(history).toContainText("10 Sample Street");
  await expect(history).toContainText("2 recorded sales");
  await expect(history).toContainText("570,000");
  await expect(history).toContainText("280,000");
  await expect(history).toContainText("postcode precision");
});

test("a home without a recorded sale says so in plain words", async ({ page }) => {
  await page.route(/\/api\/v1\/addresses\/[^/]+\/history/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.history = { ...body.history, saleCount: 0, transactions: [] };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("Sample Street");
  await page.getByRole("option", { name: /10 Sample Street/ }).click();
  await expect(page.getByTestId("brief-home-sale")).toHaveText("No recorded sale for this home");
});

test("a hidden home shows no card, no record link and no listing links", async ({ page }) => {
  // A confirmed objection hides the home: the API answers 404 for its history.
  await page.route(/\/api\/v1\/addresses\/[^/]+\/history/, (route) => route.fulfill({ status: 404, json: { error: "not-found" } }));
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("Sample Street");
  await page.getByRole("option", { name: /10 Sample Street/ }).click();
  await expect(page.getByTestId("selected-area")).not.toHaveText("Choose an area on the map or search");
  await expect(page.getByTestId("brief-home")).toHaveCount(0);
  await expect(page.getByTestId("brief-home-listings")).toHaveCount(0);
  // The area's own portal links (its postcode district, "Homes for sale here", once its sections load) stay; no
  // record link, and no link out names the home's postcode in any portal's spelling (sw1a-1ab, SW1A%201AB, SW1A+1AB).
  const postcode = ["sw1a-1ab", "sw1a%201ab", "sw1a+1ab"].map((code) => `a[href^="https://"][href*="${code}" i]`);
  await expect(page.locator(['a[href*="landregistry.data.gov.uk/app/ppd"]', ...postcode].join(", "))).toHaveCount(0);
});
