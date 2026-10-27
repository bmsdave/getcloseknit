import { expect, test } from "./fixtures";
import { openHelp } from "./evidence";
import { openTopMenu } from "./top-bar";

test("footer links to the privacy notice and the notice explains the objection route", async ({ page }) => {
  await page.goto("/");
  await openTopMenu(page);
  await page.getByTestId("privacy-link").click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByTestId("privacy-page")).toContainText("legitimate interests");
  await expect(page.locator("#hide-my-home")).toContainText("confirmation link");
  await expect(page.getByTestId("privacy-right-to-object")).toContainText("Article 21");
  await expect(page.locator("#your-home")).toContainText("Article 14(5)(b)");
  await expect(page.locator("#recipients")).toContainText("OpenFreeMap");
  await expect(page.getByTestId("privacy-usage-data")).toContainText("Share redacted usage data to improve matching");
  await page.getByRole("link", { name: "legitimate interests assessment" }).click();
  await expect(page).toHaveURL(/\/privacy\/legitimate-interests$/);
  await expect(page.getByTestId("lia-page")).toContainText("Article 6(1)(f)");
});

test("a selected home offers report / hide and the hide request posts an objection", async ({ page }) => {
  const posted: unknown[] = [];
  await page.route("**/api/v1/corrections", async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending", kind: "privacy-objection", route: "privacy", id: 3, confirmationSent: true, confirmationChannel: "smtp" }),
    });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("Sample Street");
  await page.getByRole("option", { name: /10 Sample Street/ }).click();
  await expect(page.getByTestId("brief-home")).toContainText("10 Sample Street");

  const note = page.getByTestId("home-privacy-note");
  await expect(note).toContainText("Public-record data");
  await expect(await openHelp(note, "where these figures come from", "home-privacy")).toContainText("HM Land Registry");
  await note.getByRole("button", { name: "About where these figures come from" }).click();
  await page.getByTestId("home-correction-open").click();
  await expect(page.getByTestId("home-correction-kind-privacy-objection")).toBeChecked();

  await page.getByTestId("home-correction-send").click();
  await expect(page.getByTestId("home-correction-error")).toContainText("e-mail");
  expect(posted).toEqual([]);

  await page.getByTestId("home-correction-email").fill("owner@example.com");
  await page.getByTestId("home-correction-send").click();
  const outcome = page.getByTestId("home-correction-outcome");
  await expect(outcome).toHaveAttribute("data-outcome", "sent");
  await expect(outcome).toContainText("We have sent you a link to confirm the request");
  expect(posted).toEqual([{ kind: "privacy-objection", addressId: "uk:addr:a1b2c3d4e5f6", email: "owner@example.com" }]);
});

test("a hide request the API refuses shows the reason instead of a silent failure", async ({ page }) => {
  await page.route("**/api/v1/corrections", (route) => route.fulfill({
    status: 409, contentType: "application/json",
    body: JSON.stringify({ detail: { error: "objection-exists", message: "this home is already hidden" } }),
  }));
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("Sample Street");
  await page.getByRole("option", { name: /10 Sample Street/ }).click();
  await page.getByTestId("home-correction-open").click();
  await page.getByTestId("home-correction-email").fill("owner@example.com");
  await page.getByTestId("home-correction-send").click();
  await expect(page.getByTestId("home-correction-outcome")).toHaveAttribute("data-outcome", "already-hidden");
});

test("the privacy notice explains the feedback people choose to send", async ({ page }) => {
  await page.goto("/privacy");
  const feedback = page.locator("#feedback");
  await expect(feedback).toContainText("12 months");
  await expect(feedback).toContainText("not linked to the analytics identifier");
  await expect(feedback).toContainText("Analytics off");
  // The page's address is stored (an area page names its area), never a home or full postcode.
  await expect(feedback).toContainText("the page's address");
  await expect(feedback).not.toContainText("the kind of page");
  await expect(page.locator("#retention")).toContainText("feedback sent by an assistant or from the site for 12 months");
});
