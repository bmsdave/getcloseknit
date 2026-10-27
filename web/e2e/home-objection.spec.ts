import { expect, test } from "./fixtures";

// C5: one "Report or hide this home" label on every home-level entry, a form
// that opens with the reassurance and three steps, and radio cards whose
// whole label is the 44px target. The POST is stubbed (no local SMTP).

test("the form opens with the reassurance, three steps and radio cards", async ({ page }) => {
  await page.goto("/property/100000000001");
  // PR #145 (v4.6 r3 #28): the property page's Report or hide sits in its ⋯ menu.
  await page.getByTestId("property-more").locator("summary").click();
  await page.getByRole("link", { name: "Report or hide this home" }).first().click();
  const form = page.getByTestId("home-correction-form");
  await expect(form.getByTestId("home-correction-reassure")).toHaveText("You can hide your home at any time. We won't ask why.");
  const steps = form.getByRole("list", { name: "How hiding works" }).getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("e-mail you a link");
  await expect(steps.nth(1)).toContainText("hidden");
  await expect(steps.nth(2).getByRole("link", { name: "hello@getcloseknit.com" })).toHaveAttribute("href", "mailto:hello@getcloseknit.com");

  const cards = form.locator(".home-correction__kind");
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) expect((await card.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  // The label text is the target: a click on the words picks the option.
  await form.getByText("Our figure is wrong").click();
  await expect(page.getByTestId("home-correction-kind-transformation-error")).toBeChecked();
  await expect(form.getByTestId("home-correction-steps")).toHaveCount(0);
  await form.getByText(/I live here or own this home/).click();
  await expect(page.getByTestId("home-correction-email")).toHaveClass(/knit-field/);
  // The cards follow the field contract: the --field-line border, and a --focus ring from the keyboard.
  const card = cards.first();
  const fieldLine = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.borderTop = "1px solid var(--field-line)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).borderTopColor;
    probe.remove();
    return colour;
  });
  await expect(card).toHaveCSS("border-top-color", fieldLine);
  await page.getByTestId("home-correction-kind-privacy-objection").focus();
  await page.keyboard.press("ArrowDown");
  const focused = form.locator(".home-correction__kind:has(input:focus-visible)");
  await expect(focused).toHaveCSS("outline-style", "solid");
  await expect(focused).toHaveCSS("outline-width", "3px");
  await form.getByText(/I live here or own this home/).click();
  await expect(form.getByRole("link", { name: "How hiding works, in the privacy notice" })).toHaveAttribute("href", "/privacy#hide-my-home");
});

test("every home-level entry reads Report or hide this home", async ({ page }) => {
  await page.goto("/postcode/SW1A-1AB/homes");
  const links = page.getByRole("link", { name: /^Report or hide this home: / }).locator("visible=true");
  expect(await links.count()).toBeGreaterThan(0);
  // PR #145 (v4.6 r3 #35): the wide table's column reads "Report"; its accessible name keeps the full label.
  await expect(links.first()).toHaveText(/^Report( or hide this home)?$/);

  await page.goto("/postcode/sw1a-1ab");
  await expect(page.getByTestId("postcode-privacy-note").getByRole("link", { name: "Report or hide this home" })).toHaveAttribute("href", "/postcode/SW1A-1AB/homes");

  await page.goto("/about");
  await expect(page.locator("#report")).toContainText("Report or hide this home");
  await expect(page.locator("#report")).toContainText("Report a wrong figure");
  await expect(page.locator("#report")).not.toContainText("Report a data issue");
  await expect(page.getByTestId("site-footer").getByRole("link", { name: "Report or hide a home" })).toHaveAttribute("href", "/privacy#hide-my-home");
});

test("after the request is sent, a Check your e-mail panel takes focus", async ({ page }) => {
  let posted: Record<string, unknown> | null = null;
  await page.route("**/api/v1/corrections", async (route) => {
    posted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ kind: "privacy-objection", id: 41, confirmationSent: true, confirmationChannel: "smtp" }) });
  });
  await page.goto("/property/100000000001");
  // PR #145 (v4.6 r3 #28): the property page's Report or hide sits in its ⋯ menu.
  await page.getByTestId("property-more").locator("summary").click();
  await page.getByRole("link", { name: "Report or hide this home" }).first().click();
  const section = page.getByTestId("home-correction");
  await section.getByTestId("home-correction-email").fill("owner@example.com");
  await section.getByRole("button", { name: "Send confirmation link" }).click();
  const done = section.getByTestId("home-correction-outcome");
  await expect(done).toHaveAttribute("role", "status");
  await expect(done.getByRole("heading", { name: "Check your e-mail" })).toBeFocused();
  await expect(done).toContainText("hidden from search, history and the map as soon as you open it");
  await expect(done.getByRole("link", { name: "hello@getcloseknit.com" })).toHaveAttribute("href", "mailto:hello@getcloseknit.com");
  expect(posted).toMatchObject({ kind: "privacy-objection", uprn: "100000000001" });
  await done.getByRole("button", { name: "Back" }).click();
  await expect(section.getByTestId("home-correction-form")).toBeVisible();
});
