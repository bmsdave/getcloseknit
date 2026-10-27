import { expect, type Locator, type Page } from "./fixtures";

// The top bar's ≡ menu (components/top-bar-menu.tsx) holds the pages, the map's
// settings and, with ?dev=1 only, the data mode; open it before operating any of them.
// Pages off the map have the same ≡ (same test ids) in their header.
export async function openTopMenu(page: Page): Promise<void> {
  const toggle = page.getByTestId("top-menu-toggle");
  // Retried: a click before hydration lands on a button without a handler.
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(page.getByTestId("top-menu")).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

// Menu v5: five plain links (Find a place, My match, Rankings, Schools, AI agents), then Tools and Learn as folds,
// one open at a time: open the menu and one fold. The same menu is in the map's top bar and every page's header
// (components/site-menu.tsx).
export async function openMenuGroup(page: Page, group: "Tools" | "Learn"): Promise<Locator> {
  await openTopMenu(page);
  const menu = page.getByTestId("top-menu");
  const fold = menu.getByRole("button", { name: group, exact: true });
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  return menu;
}

export async function closeTopMenu(page: Page): Promise<void> {
  const toggle = page.getByTestId("top-menu-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
}

// Map settings (2D/3D and Colours) live only in the ≡ menu's Map group (site-menu.tsx).
export async function openMapSettings(page: Page): Promise<void> {
  // A Layers menu or Show card open on a phone is modal: put it away first (Escape: the desktop menu has no ×).
  for (const id of ["layers-panel", "show-panel"]) {
    if (await page.getByTestId(id).isVisible()) {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(id)).toBeHidden();
    }
  }
  await openTopMenu(page);
  await expect(page.getByTestId("top-menu").getByTestId("map-settings")).toBeVisible();
}

// Show (map-layers.tsx): what is drawn on top of the colours, from the round map-pin button.
export async function openShowPanel(page: Page): Promise<Locator> {
  const toggle = page.getByTestId("show-toggle");
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(page.getByTestId("show-panel")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return page.getByTestId("show-panel");
}

// The period slider and ▶ sit at the top of the Layers card's Layers tab: open the card (it stays open).
export async function showTimeline(page: Page): Promise<void> {
  const timeline = page.getByTestId("price-timeline");
  if (await timeline.isVisible()) return;
  const toggle = page.getByTestId("layers-toggle");
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(page.getByTestId("layers-panel")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(timeline).toBeVisible();
}

// The round My match button opens My match (v4 Task 21c: the list, no wizard): the side panel on a desktop, its own
// sheet on a phone. There is one, the first of the map's round buttons at every width.
async function visibleFind(page: Page): Promise<Locator> {
  return page.getByTestId("find-my-area");
}

export async function openMatchBuilder(page: Page): Promise<void> {
  const list = page.getByTestId("match-list");
  // Retried: a click before hydration lands on a button without a handler.
  await expect(async () => {
    if (!(await list.isVisible())) await (await visibleFind(page)).click({ timeout: 1_000 });
    // Long enough for a busy run to open it: a retry toggles My match again (and takes the focus back to the button).
    await expect(list).toBeVisible({ timeout: 5_000 });
  }).toPass();
}

// Keyboard route to My match: Enter on its round button.
export async function openMatchBuilderByKeyboard(page: Page): Promise<void> {
  const list = page.getByTestId("match-list");
  await expect(async () => {
    if (!(await list.isVisible())) {
      const find = await visibleFind(page);
      await find.focus();
      await page.keyboard.press("Enter");
    }
    await expect(list).toBeVisible({ timeout: 5_000 });
  }).toPass();
}

// The round My match button.
export function matchOpener(page: Page): Locator {
  return page.getByTestId("find-my-area");
}

export function menuToggle(page: Page): Locator {
  return page.getByTestId("top-menu-toggle");
}

// The data mode switch is an internal: it renders only with ?dev=1.
export async function chooseDataMode(page: Page, mode: "Demo" | "Real"): Promise<void> {
  await openTopMenu(page);
  await page.getByRole("radio", { name: new RegExp(mode) }).click();
}
