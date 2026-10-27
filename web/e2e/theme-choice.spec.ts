import { expect, test } from "./fixtures";
import { openMapSettings, openTopMenu } from "./top-bar";

// Pages off the map: the ≡ menu's foot has Auto · Day · Night.
test("on /guide, ≡ › Night turns the page dark and survives a reload", async ({ page }) => {
  await page.goto("/guide");
  await openTopMenu(page);
  const theme = page.getByTestId("top-menu").getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
  await theme.getByRole("button", { name: "Night" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "night");
  await expect(theme.getByRole("button", { name: "Night" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "night");
  await openTopMenu(page);
  await expect(page.getByTestId("top-menu").getByRole("button", { name: "Night" })).toHaveAttribute("aria-pressed", "true");
});

// On the map the theme is the ≡ menu's foot too (Map settings, in ≡ › Map, hold only the map's colours):
// Auto follows the device live; Day and Night stick across reloads.
test("theme choice follows the system by default and persists an explicit pick", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await openMapSettings(page);
  await page.getByTestId("appearance-toggle").click();
  // Colours holds the map's palettes, not a second theme switch.
  await expect(page.getByTestId("appearance-menu").getByRole("radiogroup", { name: "Theme" })).toHaveCount(0);

  const theme = page.getByTestId("top-menu").getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).not.toHaveAttribute("data-ui-theme", /.*/);

  await theme.getByRole("button", { name: "Day" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "day");
  await theme.getByRole("button", { name: "Night" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "night");
  await expect(theme.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "false");

  // The boot script applies the saved pick on reload.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "night");
  expect(await page.evaluate(() => localStorage.getItem("close-knit.ui-theme"))).toBe("night");
});
