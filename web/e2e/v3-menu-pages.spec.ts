import { expect, test, type Page } from "./fixtures";

import { openTopMenu } from "./top-bar";

// v3 Fix 13: the ≡ menu's foot is one tidy block: label-left rows with 36px segmented pills (Map,
// Theme), Colours with the palette's swatches opening in place, then one small links line (map only).
for (const scheme of ["light", "dark"] as const) {
  test(`the map's menu foot: Map, Colours and Theme rows, then the links line (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await openTopMenu(page);
    const menu = page.getByTestId("top-menu");
    const settings = menu.getByRole("group", { name: "Settings" });
    await expect(settings.locator(".menu-row__label")).toHaveText(["Map", "Colours", "Theme"]);
    for (const name of ["Map", "Theme"]) {
      const pill = settings.getByRole("group", { name, exact: true });
      const box = await pill.boundingBox();
      expect(box?.height, `${name} pill height`).toBe(36);
    }
    await expect(settings.getByRole("group", { name: "Map", exact: true }).getByRole("button")).toHaveText(["2D", "3D"]);
    await expect(settings.getByRole("group", { name: "Theme", exact: true }).getByRole("button")).toHaveText(["Auto", "Day", "Night"]);
    // No caps "MAP VIEW" heading, no dashed divider.
    await expect(menu.getByText("Map view", { exact: true })).toHaveCount(0);
    expect(await menu.evaluate((node) => [...node.querySelectorAll("*")].some((el) => getComputedStyle(el).borderTopStyle === "dashed"))).toBe(false);
    // Colours opens the palette list in place.
    await page.getByTestId("appearance-toggle").click();
    await expect(page.getByTestId("appearance-menu").getByRole("button", { name: "Colour-blind safe" })).toBeVisible();
    await expect(menu.locator(".site-menu__legal a")).toHaveText(["Privacy", "Terms", "Feedback"]);
  });
}

test("a page's menu foot is the theme only: its links live in the page footer", async ({ page }) => {
  await page.goto("/guide");
  await openTopMenu(page);
  const settings = page.getByTestId("top-menu").getByRole("group", { name: "Settings" });
  await expect(settings.locator(".menu-row__label")).toHaveText(["Theme"]);
  await expect(page.getByTestId("top-menu").locator(".site-menu__legal")).toHaveCount(0);
  await expect(page.getByTestId("site-footer").getByTestId("footer-privacy")).toBeAttached();
});

// v3 Fix 18: every tools page has one container width, so the header, search and tabs never move.
async function toolsFrame(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main.tools-page")!.getBoundingClientRect();
    // PR #145 (r3 #32): on a phone the row opens scrolled to the current tab, so positions are read unscrolled.
    const scrolled = document.querySelector(".tools-nav")?.scrollLeft ?? 0;
    const tabs = [...document.querySelectorAll(".tools-nav a")].map((link) => Math.round(link.getBoundingClientRect().left + scrolled));
    return { left: Math.round(main.left), width: Math.round(main.width), tabs };
  });
}

for (const width of [1440, 390]) {
  test(`tools pages keep one width and the same tab positions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const frames = [];
    for (const path of ["/tools/stamp-duty", "/tools/mortgage-rates", "/tools/investor", "/tools/check-a-home", "/tools"]) {
      await page.goto(path);
      await expect(page.getByTestId("tools-page")).toBeVisible();
      frames.push(await toolsFrame(page));
    }
    for (const frame of frames.slice(1)) expect(frame).toEqual(frames[0]);
    if (width === 1440) expect(frames[0].width).toBe(1120);
    const nav = page.getByRole("navigation", { name: "Tools" }).getByRole("link");
    await expect(nav).toHaveText(["Tools", "Stamp duty", "Mortgage rates", "Buy-to-let", "Check a home"]);
    await expect(nav.first()).toHaveAttribute("href", "/tools");
    // The notice is one short muted line; its (?) holds the full text.
    const notice = page.getByTestId("not-advice");
    await expect(notice).toHaveText("A guide, not financial advice");
    await notice.getByRole("button").click();
    await expect(notice).toContainText("Not financial advice.");
  });
}

// v3 Fix 13 (board V3-13): Colours shows a chevron pointing right that turns down when open; the
// chosen palette is a plain chip fill, no stitched outline.
test("the Colours row's chevron turns as its list opens, and the chosen palette has no stitch", async ({ page }) => {
  await page.goto("/");
  await openTopMenu(page);
  const toggle = page.getByTestId("appearance-toggle");
  const turn = () => toggle.locator(".top-menu-caret").evaluate((node) => getComputedStyle(node).transform);
  expect(await turn()).not.toBe("none");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.poll(turn).toBe("none");
  const chosen = page.getByTestId("appearance-menu").locator("button[aria-pressed='true']");
  await expect(chosen).toHaveCount(1);
  expect(await chosen.evaluate((node) => getComputedStyle(node, "::after").content)).toBe("none");
});

// v3 Fix 16 and 17: folded pages answer 308 to the page that holds them (old links and bookmarks).
test("folded pages answer a permanent redirect to the page that holds them", async ({ page }) => {
  for (const [path, target] of [
    ["/explore", /^\/\?layer=custom:/], ["/explore/gyms-and-sports-centres", /^\/\?layer=custom:/], ["/explore/no-such-lens", /^\/$/],
    ["/claude", /\/agents$/], ["/glossary", /\/guide\/glossary$/], ["/teams", /\/about#teams$/],
    ["/rankings/borough-crime", /\/area\/london\?sort=crime$/], ["/rankings/borough-income", /\/area\/london\?sort=income$/],
  ] as const) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(308);
    expect(response.headers().location, path).toMatch(target);
  }
});

// v3 Fix 15: the group chips stay at the top while the page scrolls and jump to their group.
test("the rankings chips stay in reach and jump to their group", async ({ page }) => {
  // A short window, so the desktop's compact page scrolls too.
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 420 });
  await page.goto("/rankings");
  const bar = page.getByTestId("ranking-chips");
  const last = bar.getByRole("link", { name: "Everyday life" });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page).toHaveURL(/#rankings-everyday-life$/);
  await expect(page.getByRole("heading", { level: 2, name: "Everyday life" })).toBeInViewport();
  // Pinned at the top of the window, though it sits lower down the page.
  await expect(bar).toBeInViewport();
  expect((await bar.boundingBox())!.y).toBeLessThan(8);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await bar.boundingBox())!.y).toBeGreaterThan(60);
});
