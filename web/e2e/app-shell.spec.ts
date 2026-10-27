import { expect, test } from "./fixtures";

import { matchOpener, openMenuGroup, openTopMenu, showTimeline } from "./top-bar";

// The app shell after the UX review: My match is the main job ("Find my
// area"), internals (data mode, release ids) are dev-only, and the first
// visit says in one line what the explorer is for.

test("first visit: the intro opens My match and is remembered", async ({ page, isMobile }) => {
  await page.goto("/");
  const intro = page.getByTestId("intro-card");
  await expect(intro).toContainText("What London homes really sold for, and which areas fit your budget and commute");

  await page.getByTestId("find-my-area").click();
  const dialog = page.getByTestId("match-list");
  await expect(dialog).toBeVisible();
  await expect(intro).toHaveCount(0);
  if (isMobile) {
    // A phone's My match is a sheet: Escape closes it and focus returns to the round My match button.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(matchOpener(page)).toBeFocused();
  }

  await page.reload();
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
});

test("the intro closes with × and stays closed", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("intro-card").getByRole("button", { name: "Dismiss introduction" }).click();
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
  // The × leaves with the card; focus moves on to the round My match button.
  await expect(matchOpener(page)).toBeFocused();
  await page.reload();
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
});

test("a chosen area hides the intro", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText("St James's");
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
});

test("the intro never covers the map-unavailable notice", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: never[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return (original as Function).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/");
  await expect(page.getByTestId("map-fallback")).toBeVisible();
  await expect(page.getByTestId("intro-card")).toBeHidden();
  await expect(matchOpener(page)).toBeVisible();
});

test("phones keep My match as the first round button above the sheet; the bar is ≡ and a compact search", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  // The round button shows with the first-visit card too, and it is the only one.
  const find = page.getByTestId("find-my-area");
  await expect(page.getByTestId("intro-card")).toBeVisible();
  await expect(find).toBeVisible();
  await expect(page.getByRole("button", { name: "My match", exact: true })).toHaveCount(1);
  await page.getByTestId("intro-dismiss").click();
  await expect(find).toBeVisible();
  await expect(find).toHaveAccessibleName("My match");
  const input = page.getByRole("combobox", { name: "Search", exact: true });
  await expect(input).toHaveAttribute("placeholder", "Search");
  // The whole hint fits the field: its text width, in the field's own font, within the room between the paddings.
  const fit = await input.evaluate((field: HTMLInputElement) => {
    const style = getComputedStyle(field);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return {
      text: context.measureText(field.placeholder).width,
      room: field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      fontSize: style.fontSize,
    };
  });
  expect(fit.fontSize).toBe("16px"); // iOS zooms into smaller fields
  expect(fit.text).toBeLessThanOrEqual(fit.room);
  const [search, menu, button, layers, dock] = await Promise.all(
    [page.locator(".search-wrap"), page.getByTestId("top-menu-toggle"), find, page.getByTestId("layers-toggle"), page.getByTestId("map-dock")]
      .map((el) => el.boundingBox()));
  // One pill: ≡ first, then the search (v3 Fix 11).
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(search!.x);
  // Bottom-right, over Layers, above the sheet's peek.
  expect(button!.x + button!.width).toBeLessThanOrEqual(320);
  expect(button!.y + button!.height).toBeLessThanOrEqual(layers!.y);
  expect(layers!.y + layers!.height).toBeLessThanOrEqual(dock!.y);
  await openTopMenu(page);
  await expect(page.getByTestId("top-menu").getByRole("button", { name: "My match", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await find.click();
  await expect(page.getByTestId("match-list")).toBeVisible();
});

test("first load shows one My match, and no time slider until the layers open", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("intro-card")).toBeVisible();
  await expect(page.getByRole("button", { name: "My match", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Play timeline" })).toHaveCount(0);
  await expect(page.getByLabel("Price period")).toHaveCount(0);
  await showTimeline(page);
  await expect(page.getByRole("button", { name: "Play timeline" })).toBeVisible();
  // Opening the layers counts as getting going: the card steps aside and the bar's button takes over (desktop).
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
});

test("a search, places or a deep link hides the first-visit card", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("intro-card")).toBeVisible();
  await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/?layer=food-hygiene&places=all");
  await expect(page.locator(".map-status")).toHaveText("Map ready");
  await expect(page.getByTestId("intro-card")).toHaveCount(0);
});

test("visitors see no internals; ?dev=1 shows the data mode and release", async ({ page }) => {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  const dock = page.getByTestId("map-dock");
  await expect(page.getByTestId("data-status")).toHaveText("Demo data · not for decisions");
  await expect(dock).not.toContainText("preview-2026-09");
  // Sources & privacy and Terms are the map's ⓘ (and the menu foot), not the area panel's (v3 Fix 22).
  await expect(dock.getByTestId("sources-privacy-link")).toHaveCount(0);
  const credits = page.getByTestId("map-credits");
  await credits.getByTestId("map-attribution-toggle").click();
  await expect(credits.getByTestId("sources-privacy-link")).toHaveAttribute("href", "/privacy");
  await expect(credits.getByTestId("sources-terms-link")).toHaveAttribute("href", "/terms");
  await page.keyboard.press("Escape");
  await openTopMenu(page);
  await expect(page.getByTestId("top-menu").getByRole("link", { name: "Rankings" })).toBeVisible();
  await expect(page.getByTestId("data-mode-selector")).toHaveCount(0);
  await expect(page.getByTestId("top-menu")).not.toContainText("Build my match");

  await page.goto("/?dev=1&selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("data-status")).toHaveText("Demo data · not for decisions · preview-2026-09");
  // The flag survives the map rewriting the address.
  await expect.poll(() => new URL(page.url()).searchParams.get("dev")).toBe("1");
  await openTopMenu(page);
  await expect(page.getByTestId("data-mode-release")).toHaveText("Release preview-2026-09");
});

test("finger-sized targets: price period slider and back links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await showTimeline(page);
  const slider = await page.getByLabel("Price period").boundingBox();
  expect(slider?.height ?? 0).toBeGreaterThanOrEqual(44);

  await page.goto("/tools/stamp-duty");
  const back = await page.getByRole("link", { name: "Back to the map", exact: true }).boundingBox();
  expect(back?.height ?? 0).toBeGreaterThanOrEqual(44);
  for (const label of await page.locator(".tools-check > label").all()) {
    const box = await label.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
});

// Menu v5 (components/site-menu.tsx, owner board 2026-10-20): one ≡ on the map and on every page; five plain
// links, then Tools and Learn as folds.
for (const path of ["/", "/guide"]) {
  test(`the ≡ menu on ${path} reaches the rankings, the guide and the theme`, async ({ page }) => {
    await page.goto(path);
    const menu = await openMenuGroup(page, "Tools");
    await expect(menu.getByRole("link", { name: "Rankings" })).toHaveAttribute("href", "/rankings");
    // One fold open at a time.
    await openMenuGroup(page, "Learn");
    await expect(menu.getByRole("button", { name: "Tools", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(menu.getByRole("link", { name: "Stamp duty" })).toHaveCount(0);
    await expect(menu.getByRole("link", { name: "Guide" })).toHaveAttribute("href", "/guide");
    await expect(menu.getByRole("link", { name: "Boroughs" })).toHaveAttribute("href", "/area/london");
    await expect(menu.getByRole("group", { name: "Theme" }).getByRole("button")).toHaveText(["Auto", "Day", "Night"]);
    // Privacy · Terms · Feedback close the map's menu; pages off the map have them in their footer.
    for (const id of ["privacy-link", "terms-link", "feedback-link"]) await expect(menu.getByTestId(id)).toHaveCount(path === "/" ? 1 : 0);
    // Menu v5: two folds after the plain links.
    await expect(menu.locator("[data-fold]")).toHaveText(["Tools", "Learn"]);
    // The Map row (2D/3D) and Colours are the map's own.
    await expect(menu.getByRole("group", { name: "Map", exact: true })).toHaveCount(path === "/" ? 1 : 0);
  });
}

// MenuA-v4 (v4 Task 50): still one fold at a time; a page opens the menu on its own group and marks itself,
// and the tool rows carry the tool tabs' names (v4 Task 46).
test("the ≡ menu on a page opens on its group, marks the page and names tools as their tabs", async ({ page }) => {
  await page.goto("/tools/stamp-duty");
  await openTopMenu(page);
  const menu = page.getByTestId("top-menu");
  await expect(menu.getByRole("button", { name: "Tools", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("button", { name: "Learn", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(menu.locator(".site-menu__links").getByRole("link")).toHaveText(["Check a home", "Stamp duty", "Mortgage rates", "Buy-to-let"]);
  await expect(menu.getByRole("link", { name: "Stamp duty" })).toHaveAttribute("aria-current", "page");
  await expect(menu.locator("[aria-current=page]")).toHaveCount(1);
});

for (const width of [1280, 390]) {
  test(`saved areas show as ♡ N in the map's top bar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => window.localStorage.setItem("close-knit.saved-shortlists.v1",
      JSON.stringify([{ id: "a", name: "My shortlist", candidates: ["uk:lsoa:E01000001"] }])));
    await page.goto("/");
    const saved = page.getByTestId("header-saved-areas");
    await expect(saved).toBeVisible();
    await expect(saved).toHaveText("1");
    await expect(saved).toHaveAttribute("aria-label", "Saved (1)");
    // Its own chip at the bar's right, apart from the pill (≡ · close knit · Search); My match is a round button on the map.
    const [link, menu, find, pill] = await Promise.all([saved, page.getByTestId("top-menu-toggle"), page.getByTestId("find-my-area"),
      page.getByTestId("top-bar-pill")].map((el) => el.boundingBox()));
    expect(link!.x).toBeGreaterThanOrEqual(pill!.x + pill!.width);
    expect(menu!.x).toBeLessThan(pill!.x + 60);
    expect(link!.x + link!.width).toBeLessThanOrEqual(width - 8);
    expect(find!.x + find!.width).toBeLessThanOrEqual(width);
  });
}
