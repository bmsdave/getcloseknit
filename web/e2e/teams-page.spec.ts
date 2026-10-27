import { expect, test } from "./fixtures";

// Proposal #34, v3 Fix 17: For teams is a section of About (/teams redirects there). It says what
// the API and MCP return, states the rate limits and licences, gives the contact address, and
// collects nothing: team use starts with an e-mail.

test("About › For teams says what the API and MCP return, the limits, the licences and the contact", async ({ page }) => {
  const response = await page.goto("/teams");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/about#teams$/);
  const about = page.getByTestId("about-page");
  await expect(page.getByTestId("teams-returns")).toContainText("Area figures");
  await expect(page.getByTestId("teams-returns")).toContainText("Never a value for the home itself");
  const limits = page.getByTestId("teams-limits");
  await expect(limits.locator('tr[data-class="default"]')).toContainText("120");
  await expect(limits.locator('tr[data-class="default"]')).toContainText("10,000");
  await expect(limits.locator('tr[data-class="detail"]')).toContainText("30");
  await expect(about.locator("#limits")).toContainText("429");
  await expect(page.getByTestId("teams-licences")).toContainText("Open Government Licence v3.0");
  await expect(page.getByTestId("teams-licences")).toContainText("ODbL");
  // It restates the terms rather than widening them.
  await expect(about.locator("#team-use")).toContainText("for personal use");
  await expect(about.getByRole("link", { name: "terms of use" })).toHaveAttribute("href", "/terms#acceptable-use");
  await expect(page.getByTestId("teams-contact").getByRole("link", { name: "hello@getcloseknit.com" }))
    .toHaveAttribute("href", "mailto:hello@getcloseknit.com?subject=Close%20Knit%20for%20teams");
  // No form in For teams, nothing stored but the anonymous usage id (lib/usage.ts).
  await expect(about.locator(":is(#teams, #limits, #licences, #team-use) :is(form, input, textarea, select)")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key !== "close-knit.visitor.v1"))).toEqual([]);
  expect(await page.context().cookies()).toEqual([]);
});

test("For teams is linked from the footer and the AI agents page", async ({ page }) => {
  await page.goto("/agents");
  await expect(page.getByTestId("footer-teams")).toHaveAttribute("href", "/about#teams");
  await expect(page.locator(".subpage-foot").getByRole("link", { name: "API and licences" })).toHaveAttribute("href", "/about#teams");
});
