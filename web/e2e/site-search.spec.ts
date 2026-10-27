import { expect, test, type Page } from "./fixtures";

// PR 3: one small Search on the map and every page finds postcodes, homes, areas, schools,
// stations and places, grouped by kind under short labels.

async function openSearch(page: Page) {
  // Phones: the page header's Search is a round button until tapped.
  const button = page.getByTestId("site-header").getByRole("button", { name: "Search", exact: true });
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await expect(async () => {
    if (await button.isVisible()) await button.click();
    await expect(search).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(search).toHaveAttribute("placeholder", "Search");
  return search;
}

test("the map's Search groups areas, homes, schools and stations, and a station is chosen on the map", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await expect(search).toHaveAttribute("placeholder", "Search");
  await search.fill("Westminster");
  const listbox = page.getByRole("listbox", { name: "Search results" });
  await expect(listbox.getByRole("group")).toHaveText([/^Homes/, /^Areas/, /^Schools/, /^Stations/]);
  await expect(listbox.getByRole("group", { name: "Schools" }).getByRole("option")).toHaveText([/Westminster Primary Preview/]);

  await listbox.getByRole("group", { name: "Stations" }).getByRole("option", { name: /Westminster preview station/ }).click();
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  await expect(search).toHaveValue("Westminster preview station");
});

test("a school opens its page from the map's Search", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("Westminster Primary");
  await page.getByRole("option", { name: /Westminster Primary Preview/ }).click();
  await expect(page).toHaveURL(/\/school\/100001$/, { timeout: 20_000 });
});

test("a partial postcode offers its full postcodes' pages (G33)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  const postcodes = page.getByRole("listbox", { name: "Search results" }).getByRole("group", { name: "Postcode" });
  await expect(postcodes.getByRole("option")).toHaveText([/SW1A 1AA.*Prices & sales/, /SW1A 1AB.*Prices & sales/]);
  await postcodes.getByRole("option", { name: /SW1A 1AB/ }).click();
  await expect(page).toHaveURL(/\/postcode\/SW1A-1AB$/, { timeout: 20_000 });
});

test("a page's header Search opens a station on the map at its point", async ({ page }) => {
  await page.goto("/guide");
  const search = await openSearch(page);
  const station = page.getByRole("option", { name: /Waterloo preview station/ });
  // Typed before the page hydrates, the text is dropped: type again until the results come.
  await expect(async () => {
    await search.fill("Waterloo preview");
    await expect(station).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await station.click();
  await expect(page).toHaveURL(/\/\?lat=51\.5031&lng=-0\.1131&zoom=15&selected=uk%3Alsoa%3AE01000003$/, { timeout: 20_000 });
});

test("a page's header Search takes the keyboard like the map's", async ({ page }) => {
  await page.goto("/guide");
  const search = await openSearch(page);
  const listbox = page.getByRole("listbox", { name: "Search results" });
  await expect(async () => {
    await search.fill("SW1A");
    await expect(listbox).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await search.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-activedescendant", /option-1$/);
  await search.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(search).toHaveAttribute("aria-expanded", "false");
});
