import { expect, test, type Page } from "./fixtures";
import { openTopMenu } from "./top-bar";

const AREA = "/area/lsoa/E01000001";

// Feedback people choose to send (docs/superpowers/specs/2026-10-14-user-feedback-design.md): the
// /feedback form from the menu, and each figure's own Report. v3 Fix 22: no quick 👍/👎 votes and
// no prompt after an action.

type Body = Record<string, unknown>;

/** Retried: a click before hydration lands on a star without a handler. */
async function rate(page: Page, stars: number) {
  const star = page.getByTestId(`star-${stars}`);
  await expect(async () => {
    await star.click();
    await expect(star).toHaveAttribute("aria-checked", "true", { timeout: 1_000 });
  }).toPass();
}

async function captureFeedback(page: Page, status = 204): Promise<Body[]> {
  const bodies: Body[] = [];
  await page.route("**/api/v1/feedback", async (route) => {
    bodies.push(route.request().postDataJSON() as Body);
    await route.fulfill({ status });
  });
  return bodies;
}

test("an area page has no quick vote and a portal click brings no prompt", async ({ page }) => {
  const bodies = await captureFeedback(page);
  await page.context().route(/rightmove|zoopla|onthemarket|openrent/, (route) => route.fulfill({ status: 204, body: "" }));
  page.context().on("page", (opened) => { if (opened !== page) void opened.close(); });
  await page.goto(AREA);
  await expect(page.getByTestId("area-full-page")).toBeVisible();
  await expect(page.getByText("Was this useful?")).toHaveCount(0);
  await expect(page.locator(".quick-vote")).toHaveCount(0);
  const portal = page.getByTestId("homes-here").getByTestId("homes-here-rightmove");
  await expect(portal).toBeVisible({ timeout: 20_000 });
  await portal.click();
  await expect(page.getByRole("dialog", { name: /How's Close Knit so far/ })).toHaveCount(0);
  await expect(page.locator(".feedback-prompt")).toHaveCount(0);
  expect(bodies).toEqual([]);
});

test("the form sends a rating, reasons and text, from the footer link", async ({ page }) => {
  test.slow(); // two pages, the first visit to /feedback compiles it in dev
  const bodies = await captureFeedback(page);
  await page.goto("/about");
  await page.getByTestId("site-footer").getByRole("link", { name: "Feedback" }).click();
  await expect(page).toHaveURL(/\/feedback$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("How's Close Knit so far?");
  const send = page.getByTestId("feedback-send");
  await expect(send).toBeDisabled();
  await rate(page, 2);
  await expect(page.getByText("What got in the way?")).toBeVisible();
  await expect(page.getByTestId("feedback-message")).toHaveAttribute("placeholder", "What would make it better?");
  await page.getByTestId("feedback-reason-slow").click();
  await page.getByTestId("feedback-message").fill("The map takes a while on my phone");
  await send.click();
  await expect(page.getByTestId("feedback-thanks")).toContainText("Thank you!");
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ kind: "review", surface: "site", rating: 2, tags: ["slow"], message: "The map takes a while on my phone", path: "/feedback" });
  expect(bodies[0].client_id).toMatch(/^[0-9a-f-]{36}$/);
});

test("changing the rating across 3 and 4 swaps and clears the reasons", async ({ page }) => {
  await page.goto("/feedback");
  await rate(page, 5);
  await expect(page.getByText("What worked well?")).toBeVisible();
  await expect(page.getByTestId("feedback-message")).toHaveAttribute("placeholder", "What did you like most?");
  await page.getByTestId("feedback-reason-fast").click();
  await page.getByTestId("star-4").click();
  await expect(page.getByTestId("feedback-reason-fast")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("star-3").click();
  await expect(page.getByTestId("feedback-reason-fast")).toHaveCount(0);
  await page.getByTestId("star-5").click();
  await expect(page.getByTestId("feedback-reason-fast")).toHaveAttribute("aria-pressed", "false");
});

test("a failed send says so and keeps the text", async ({ page }) => {
  await captureFeedback(page, 503);
  await page.goto("/feedback");
  await rate(page, 4);
  await page.getByTestId("feedback-message").fill("Keep this");
  await page.getByTestId("feedback-send").click();
  await expect(page.getByTestId("feedback-error")).toBeVisible();
  await expect(page.getByTestId("feedback-message")).toHaveValue("Keep this");
  await expect(page.getByTestId("feedback-thanks")).toHaveCount(0);
});

test("arrow keys move between the stars", async ({ page }) => {
  await page.goto("/feedback");
  await rate(page, 3);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("star-4")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("star-4")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("star-2")).toHaveAttribute("aria-checked", "true");
});

test("the top-bar menu links to the form", async ({ page }) => {
  await page.goto("/");
  await openTopMenu(page);
  await expect(page.getByTestId("feedback-link")).toHaveAttribute("href", "/feedback");
});
