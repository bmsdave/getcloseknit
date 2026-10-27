import { expect, test } from "./fixtures";

import { openTopMenu } from "./top-bar";

// Menu v5 · Schools hub · Schools 101 (owner board 2026-10-20). Preview mode: the preview schools all sit in
// the Westminster preview borough.

test("menu v5: five plain links, then Tools and Learn; Schools marks the hub and a school page", async ({ page }) => {
  await page.goto("/schools");
  await openTopMenu(page);
  const menu = page.getByTestId("top-menu");
  await expect(menu.locator(".site-menu__top, [data-fold]"))
    .toHaveText(["Find a place", "My match", "Rankings", "Schools", "AI agents", "Tools", "Learn"]);
  await expect(menu.getByRole("link", { name: "Schools", exact: true })).toHaveAttribute("href", "/schools");
  await expect(menu.getByRole("link", { name: "Schools", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "AI agents" })).toHaveAttribute("href", "/agents");
  // Learn keeps Guide, Boroughs and About; it opens with the menu shut on other folds.
  await menu.getByRole("button", { name: "Learn", exact: true }).click();
  await expect(menu.locator(".site-menu__links").getByRole("link")).toHaveText(["Guide", "Boroughs", "About"]);
});

test("/schools renders the search, filters, top lists, boroughs and the Schools 101 grid", async ({ page }) => {
  const response = await page.goto("/schools");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("site-header")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schools in London");
  await expect(page.getByTestId("breadcrumbs")).toContainText("Schools");
  await expect(page.getByTestId("schools-search").getByRole("searchbox", { name: "Search a school" })).toBeVisible();
  for (const id of ["filter-phase", "filter-ofsted", "filter-results", "filter-type", "filter-intake", "filter-faith"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("filter-phase").getByRole("link", { name: "All", exact: true })).toHaveAttribute("aria-current", "true");
  // The 8 published rankings, as the /rankings tiles; each opens /rankings/[slug].
  const tops = page.getByTestId("schools-top-lists");
  await expect(tops.getByTestId("ranking-tile-link").first()).toHaveAttribute("href", /^\/rankings\//);
  await expect(page.getByTestId("schools-own-top")).toBeDisabled();
  await expect(page.getByTestId("schools-boroughs").getByRole("link")).toHaveCount(33);
  const cards = page.getByTestId("schools-101-grid").locator(".schools-101__card");
  await expect(cards).toHaveCount(12);
  await expect(page.getByTestId("schools-101-key-dates").getByRole("link", { name: /Read more/ }))
    .toHaveAttribute("href", "/guide/schools-101#key-dates");
  // No list until a search, borough or filter asks for one.
  await expect(page.getByTestId("schools-list")).toHaveCount(0);
});

test("a borough lists its schools, filters narrow it, and each row opens the school", async ({ page }) => {
  await page.goto("/schools");
  await page.getByTestId("schools-borough-westminster").click();
  await page.waitForURL(/\/schools\?borough=westminster/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schools in Westminster");
  const list = page.getByTestId("schools-list");
  await expect(list.getByTestId("schools-row").first()).toBeVisible();
  const all = await list.getByTestId("schools-row").count();
  await expect(list.getByTestId("schools-row").first().getByRole("link")).toHaveAttribute("href", /^\/school\/\d+/);
  // A phase chip keeps the borough and narrows the rows.
  await page.getByTestId("filter-phase").getByRole("link", { name: "Primary" }).click();
  await page.waitForURL(/borough=westminster.*schools=t\.p(&|$)/);
  await expect(page.getByTestId("filter-phase").getByRole("link", { name: "Primary" })).toHaveAttribute("aria-current", "true");
  await expect(list.getByTestId("schools-row")).not.toHaveCount(0);
  expect(await list.getByTestId("schools-row").count()).toBeLessThanOrEqual(all);
  await expect(list.getByTestId("schools-row").filter({ hasText: "Secondary" })).toHaveCount(0);
  // Another borough has no preview schools: a plain empty line.
  await page.goto("/schools?borough=hackney");
  await expect(page.getByTestId("schools-none")).toBeVisible();
});

test("the search finds a school by name", async ({ page }) => {
  await page.goto("/schools");
  await page.getByRole("searchbox", { name: "Search a school" }).fill("westminster primary");
  await page.getByTestId("schools-search").getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/\/schools\?q=westminster\+primary/);
  await expect(page.getByTestId("schools-row")).toHaveCount(1);
  await expect(page.getByTestId("schools-row")).toContainText("Westminster Primary Preview");
});

test("the Schools 101 guide has every card's section", async ({ page }) => {
  await page.goto("/guide/schools-101");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schools 101");
  for (const id of ["phases", "types", "ofsted", "report-cards", "ks2", "attainment-progress", "grade-5", "catchment", "faith", "appeals", "key-dates"]) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }
  await expect(page.getByRole("heading", { name: "How we rank" })).toBeVisible();
  await expect(page.getByTestId("guide-fine-print")).toContainText("Open Government Licence");
});

test.describe("at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("/schools fits a phone without sideways scroll", async ({ page }) => {
    await page.goto("/schools?borough=westminster");
    await expect(page.getByTestId("schools-row").first()).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });
});
