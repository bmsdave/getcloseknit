import { expect, test } from "./fixtures";
import { continueToReview, typeBudget } from "./wizard";
import { openMatchBuilder } from "./top-bar";

// My match's older extras (Saved areas & costs, Compare places, Tailor, Clear, Your data…) wait behind a default-off
// flag since v4.6 (lib/match-extras.ts): this spec covers them, so it turns them on for each page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { for (const storage of [window.localStorage, window.sessionStorage]) storage.setItem("close-knit.match-extras", "on"); });
});

const CANARY_BUDGET = "637211";

test("a normal map open transmits no raw profile and creates no profile URL", async ({ page }) => {
  const bodies: string[] = [];
  const urls: string[] = [];
  page.on("request", (request) => {
    urls.push(request.url());
    const body = request.postData();
    if (body) bodies.push(body);
  });

  await page.goto("/");
  await expect(page.getByTestId("close-knit")).toBeVisible();
  await expect(page).not.toHaveURL(/profile=v\d/);

  const traffic = `${urls.join("\n")}\n${bodies.join("\n")}`;
  expect(traffic).not.toContain("maximumBudget");
  expect(traffic).not.toContain("commuteDestinations");
});

// Usage data and erasing live with the search (My match › "Your data", under the ten).
async function openYourData(page: import("@playwright/test").Page) {
  await page.goto("/");
  await openMatchBuilder(page);
  await typeBudget(page, CANARY_BUDGET);
  await continueToReview(page);
  const data = page.getByTestId("your-data");
  await data.locator("summary").click();
  return data;
}

test("opt-in and opt-out controls change the transmitted consent flag", async ({ page }) => {
  const data = await openYourData(page);
  for (const consent of [true, false]) {
    // Listen before toggling: a profile change re-requests matches ~120ms later.
    const flagged = page.waitForRequest((request) =>
      request.url().includes("/api/v1/matches") && request.method() === "POST",
    );
    const checkbox = data.getByLabel("Share redacted usage data to improve matching");
    await checkbox.click();
    await expect(checkbox).toBeChecked({ checked: consent });
    // The match request is the ordered list (preference-profile.v2): consent rides with it only when given.
    const body = JSON.parse((await flagged).postData() ?? "{}") as { schemaVersion: string; analyticsConsent?: boolean };
    expect(body.schemaVersion).toBe("preference-profile.v2");
    expect(Boolean(body.analyticsConsent)).toBe(consent);
  }
});

test("erase control needs confirmation and restores defaults on confirm", async ({ page }) => {
  const data = await openYourData(page);
  // Accidental activation cannot delete data: a confirmation gates the erase.
  await data.getByRole("button", { name: "Erase local profile" }).click();
  await expect(page.getByTestId("erase-preview")).toContainText("cannot be undone");
  await expect(page.getByTestId("match-list")).toContainText("£637k");

  await page.getByRole("button", { name: "Confirm erase" }).click();
  const stored = await page.evaluate(() => window.localStorage.getItem("close-knit.preference-profile.v1"));
  expect(stored).toBeNull();
  // Back to the start: the three start rows, the budget empty again.
  await expect(page.getByTestId("match-budget-start").getByTestId("budget-max")).toHaveValue("");
});

test("erase confirmation cancels without deleting and restores focus", async ({ page }) => {
  const data = await openYourData(page);
  const trigger = data.getByRole("button", { name: "Erase local profile" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("erase-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("erase-preview")).toHaveCount(0);
  const kept = await page.evaluate(() => window.localStorage.getItem("close-knit.preference-profile.v1"));
  expect(kept).not.toBeNull();
  await expect(data.getByRole("button", { name: "Erase local profile" })).toBeFocused();
});

test("denied local storage keeps the map usable and profile-free in the URL", async ({ page }) => {
  await page.addInitScript(() => {
    const denied = () => { throw new DOMException("denied", "SecurityError"); };
    Object.defineProperty(window, "localStorage", { value: { getItem: () => null, setItem: denied, removeItem: denied } });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByTestId("close-knit")).toBeVisible();
  await openMatchBuilder(page);
  await typeBudget(page, CANARY_BUDGET);
  await expect(page).not.toHaveURL(/profile=v\d/);
  expect(errors).toEqual([]);
});

test("sharing previews sensitive fields and needs explicit confirmation", async ({ page }) => {
  await page.goto("/");
  await openMatchBuilder(page);
  await typeBudget(page, CANARY_BUDGET);
  await continueToReview(page);
  await page.getByTestId("share-search").click();

  const preview = page.getByTestId("share-preview");
  await expect(preview).toContainText("Budget up to");
  await expect(preview).toContainText("637,211");

  await page.getByRole("button", { name: "Cancel share" }).click();
  await expect(page).not.toHaveURL(/profile=v\d/);

  await page.getByTestId("share-search").click();
  await expect(page.getByTestId("share-preview")).toBeVisible();
  await page.getByRole("button", { name: "Confirm share" }).click();
  await expect(page).toHaveURL(/profile=v\d/);
});

test("personalized match responses are excluded from shared caches", async ({ page }) => {
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/v1/matches"));
  await page.goto("/");
  await openMatchBuilder(page);
  await continueToReview(page);
  const headers = (await responsePromise).headers();
  expect(headers["cache-control"] ?? "").toContain("no-store");
});
