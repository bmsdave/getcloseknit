import { expect, test, type Page } from "./fixtures";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";

// Proposals #7, #9 and #24: the first view says what Close Knit is for, how it
// works and where the figures come from; a returning visitor gets "Welcome
// back" instead; Claude is offered as the other way in.

const VALUE_LINE = "What London homes really sold for, and which areas fit your budget and commute";

const SEEDED = JSON.stringify([{
  schemaVersion: "saved-shortlist.v1", id: "seeded-test-move", name: "Test move",
  createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z",
  candidates: ["uk:lsoa:E01000002", "uk:lsoa:E01000003"], candidateNames: {},
  profile: DEFAULT_PROFILE, mode: "demo", release: "demo-fixture-pack", evidence: [],
}]);

async function seedShortlist(page: Page) {
  await page.addInitScript((value) => {
    if (!window.sessionStorage.getItem("seeded")) {
      window.localStorage.setItem("close-knit.saved-shortlists.v1", value);
      window.sessionStorage.setItem("seeded", "1");
    }
  }, SEEDED);
}

test.describe("a 375 × 812 phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the first view shows the value line, three steps and the proof strip", async ({ page }) => {
    await page.goto("/");
    const intro = page.getByTestId("intro-card");
    for (const part of ["intro-value", "intro-steps", "intro-proof", "intro-example", "intro-claude"]) {
      await expect(intro.getByTestId(part)).toBeInViewport();
    }
    await expect(intro.getByTestId("intro-value")).toHaveText(VALUE_LINE);
    await expect(intro.getByTestId("intro-steps").locator("li")).toHaveText(["Budget & commute", "Matching areas", "Compare & brief"]);
    // Phones show the short proof strip on one line; the full one is the desktop's.
    await expect(intro.getByTestId("intro-proof-short")).toHaveText("Land Registry · police.uk · Ofsted · no paid placement");
    await expect(intro.getByTestId("intro-proof-full")).toBeHidden();
    await expect(intro.getByTestId("intro-proof-full"))
      .toHaveText("HM Land Registry · police.uk · Ofsted — every figure sourced · nothing here is paid placement");
    const lines = await intro.getByTestId("intro-value").evaluate((element) =>
      Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight)));
    expect(lines).toBeLessThanOrEqual(3);
  });
});

test.describe("a 390 × 844 phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the intro, with its actions, is 260px tall or less: steps wrap clear of the edge, proof on one line", async ({ page }) => {
    await page.goto("/");
    const intro = page.getByTestId("intro-card");
    await expect(intro).toBeVisible();
    const box = await intro.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(260);
    const rows = async (testId: string) => intro.getByTestId(testId).evaluate((element) =>
      Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight)));
    // The steps wrap with 8px between them and never run to the card's right edge.
    const steps = intro.getByTestId("intro-steps");
    expect(await steps.evaluate((element) => getComputedStyle(element).flexWrap)).toBe("wrap");
    expect(await steps.evaluate((element) => getComputedStyle(element).columnGap)).toBe("8px");
    const right = await steps.locator("li").evaluateAll((items) => Math.max(...items.map((item) => item.getBoundingClientRect().right)));
    expect(right).toBeLessThanOrEqual(box!.x + box!.width - 12);
    expect(await rows("intro-proof")).toBe(1);
    await expect(intro.getByTestId("intro-steps").locator("svg")).toHaveCount(3);
    // "Try an example" and "Ask Claude" share one row (My match is a round map button).
    const example = await intro.getByTestId("intro-example").boundingBox();
    const claude = await intro.getByTestId("intro-claude").boundingBox();
    expect(Math.abs((example!.y + example!.height / 2) - (claude!.y + claude!.height / 2))).toBeLessThan(4);
  });
});

// #20: in landscape (and any window under 500px tall) the card folds to a one-line pill over at most a
// quarter of the map, and My match is the first round map button as always: exactly one on screen.
for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }]) {
  test.describe(`a ${viewport.width} × ${viewport.height} landscape phone`, () => {
    test.use({ viewport });

    test("the intro is a short card with the labelled start and My match is one round button", async ({ page }) => {
      await page.goto("/");
      const intro = page.getByTestId("intro-card");
      await expect(intro).toBeVisible();
      await expect(intro.getByTestId("intro-value")).toHaveText(VALUE_LINE); // whole in the h1, cut short on screen only
      await expect(intro.getByTestId("intro-steps")).toBeHidden();
      // v4.6 (HomeLandscape): "Find my area" and "Try an example" as on desktop and portrait, the value line one row.
      await expect(intro.getByTestId("intro-find")).toBeVisible();
      await expect(intro.getByTestId("intro-example")).toBeVisible();
      await expect(page.getByTestId("dock-example").filter({ visible: true })).toHaveCount(0);
      const box = (await intro.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(110);
      const map = (await page.locator(".maplibregl-canvas").first().boundingBox())!;
      const overlap = Math.max(0, Math.min(box.x + box.width, map.x + map.width) - Math.max(box.x, map.x))
        * Math.max(0, Math.min(box.y + box.height, map.y + map.height) - Math.max(box.y, map.y));
      expect(overlap / (map.width * map.height)).toBeLessThanOrEqual(0.25);
      await expect(page.getByTestId("find-my-area")).toBeVisible();
      await expect(page.getByRole("button", { name: "My match", exact: true }).filter({ visible: true })).toHaveCount(1);
      await page.getByTestId("find-my-area").click();
      await expect(page.getByTestId("match-list")).toBeVisible();
    });
  });
}

test("the value line is the page's one h1, before and after the intro goes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("intro-card")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(VALUE_LINE);
  await page.getByRole("button", { name: "Dismiss introduction" }).click();
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(VALUE_LINE);
  await expect(page.getByTestId("value-heading")).toHaveClass(/sr-only/);
});

test("Try an example shows the ready-made search without saving it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("intro-card").getByRole("button", { name: "Try an example" }).click();
  await expect(page.getByTestId("close-knit")).toHaveAttribute("data-active-metric", "personal-match");
  await expect(page.getByTestId("example-banner")).toBeVisible();
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), "close-knit.preference-profile.v1")).toBeNull();
});

test("the Claude link opens /agents", async ({ page }) => {
  await page.goto("/");
  // Phones read "Ask Claude →"; wider screens the full line.
  const link = page.getByTestId("intro-card").getByRole("link", { name: /^(or ask Claude to find it for you|Ask Claude) →$/ });
  await expect(link).toHaveAttribute("href", "/agents");
});

test("the default title and description carry the value line, and pages stay unlisted", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(`Close Knit: ${VALUE_LINE.charAt(0).toLowerCase()}${VALUE_LINE.slice(1)}`);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", new RegExp(`^${VALUE_LINE}`));
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

// v3 Fix 22: no "Welcome back" card; a returning visitor's reminder is ♡ N in the top bar.
test("a saved shortlist brings no card: ♡ N is the reminder", async ({ page }) => {
  await seedShortlist(page);
  await page.goto("/");
  await expect(page.getByTestId("header-saved-areas")).toHaveAttribute("aria-label", "Saved (2)");
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
  await expect(page.getByTestId("welcome-back")).toHaveCount(0);
  await expect(page.getByTestId("value-heading")).toHaveCount(1);
});

test("with storage blocked there is no Welcome back and nothing throws", async ({ page }) => {
  await page.addInitScript(() => {
    const denied = () => { throw new DOMException("denied", "SecurityError"); };
    Object.defineProperty(window, "localStorage", { get: denied });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  // The card settles after mount: the first-visit intro shows (unremembered), never Welcome back.
  await expect(page.getByTestId("intro-card")).toBeVisible();
  await expect(page.getByTestId("welcome-back")).toHaveCount(0);
  expect(errors).toEqual([]);
});
