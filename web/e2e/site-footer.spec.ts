import { expect, test } from "./fixtures";

// UX P7 / proposal #18: one trust footer on every page off the map. The map
// at "/" keeps its own dock footer, so the shared one is absent there.

const PAGES = ["/guide", "/privacy", "/terms", "/property/100000000001", "/about"];

for (const path of PAGES) {
  test(`${path} carries the shared footer`, async ({ page }) => {
    await page.goto(path);
    const footer = page.getByTestId("site-footer");
    await expect(footer).toBeVisible();
    await expect(footer.getByRole("link", { name: "Sources & privacy" })).toHaveAttribute("href", "/privacy");
    await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    await expect(footer.getByRole("link", { name: "Licences" })).toHaveAttribute("href", "/terms#reuse");
    await expect(footer.getByRole("link", { name: "Places data (ODbL)" })).toHaveAttribute("href", "/api/v2/downloads/places.csv");
    await expect(footer.getByRole("link", { name: "Real or demo data" })).toHaveAttribute("href", "/guide/demo-vs-real");
    await expect(footer.getByRole("link", { name: "Report or hide a home" })).toHaveAttribute("href", "/privacy#hide-my-home");
    await expect(footer.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    await expect(footer.getByRole("link", { name: "For teams" })).toHaveAttribute("href", "/about#teams");
    await expect(footer).toContainText("no paid placement");
    // #17: the launch list and research sign-up are plain e-mails, nothing collected here.
    await expect(footer.getByTestId("footer-launch-list"))
      .toHaveAttribute("href", "mailto:hello@getcloseknit.com?subject=Tell%20me%20what's%20new%20on%20Close%20Knit");
    await expect(footer.getByTestId("footer-research"))
      .toHaveAttribute("href", "mailto:hello@getcloseknit.com?subject=Take%20part%20in%20a%2030-minute%20research%20session");
    await expect(footer.locator("form, input")).toHaveCount(0);
  });
}

test("the map has no shared footer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("close-knit")).toBeVisible();
  await expect(page.getByTestId("site-footer")).toHaveCount(0);
});

test("the footer is hidden in print", async ({ page }) => {
  await page.goto("/guide");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("site-footer")).toBeHidden();
});

test("About names the controller as the privacy notice does and only links by e-mail", async ({ page }) => {
  await page.goto("/privacy");
  const notice = (await page.locator("#controller p").first().innerText()).split(".")[0];
  await page.goto("/about");
  await expect(page.getByTestId("about-controller")).toContainText(notice);
  await expect(page.getByTestId("about-controller")).toContainText("hello@getcloseknit.com");
  await expect(page.getByTestId("about-pledge")).toContainText("No paid placement");
  await expect(page.getByTestId("about-pledge")).toContainText("No lead selling");
  await expect(page.getByTestId("about-pledge")).toContainText("Rankings are never sold");
  await expect(page.getByTestId("about-freshness").locator("tbody tr").first()).toBeVisible();
  await expect(page.getByTestId("about-launch-list"))
    .toHaveAttribute("href", "mailto:hello@getcloseknit.com?subject=Tell%20me%20what's%20new%20on%20Close%20Knit");
  await expect(page.getByTestId("about-research"))
    .toHaveAttribute("href", "mailto:hello@getcloseknit.com?subject=Take%20part%20in%20a%2030-minute%20research%20session");
  // Nothing is collected here: no form, no field, nothing stored but the anonymous usage id (lib/usage.ts).
  // (The site header's Search finds pages; it is not part of the About content.)
  await expect(page.locator("main :is(form, input):not(.site-header *)")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key !== "close-knit.visitor.v1"))).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
});
