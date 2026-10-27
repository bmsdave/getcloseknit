import { expect, type Locator, type Page } from "./fixtures";

import { findTopic } from "../src/lib/map-topics";

// The map panel is a brief; every topic lives on the area card (the full
// page, or the sheet at full height) as one always-open section, in the one
// fixed order. Older spec names map onto the section that now holds them.
export const SECTION_IDS = {
  Overview: "overview",
  Price: "price",
  "Price & market": "price",
  "Homes sold nearby": "price",
  "Getting around": "getting-around",
  Transport: "getting-around",
  Safety: "safety",
  "Safety & services": "safety",
  Crime: "safety",
  Schools: "schools",
  "Local places": "local-places",
  Environment: "environment",
  "Green & quiet": "environment",
  Health: "health",
  Homes: "homes",
  People: "people",
  "Living costs": "living-costs",
  Council: "living-costs",
  "Living here": "safety",
  // Not sections: planning folds in the card's footer, and the home's tools live on /tools/check-a-home.
  Planning: "planning",
  "Plan & check": "check-home",
} as const;

export type SectionName = keyof typeof SECTION_IDS;

/** The card's sections in their fixed order (tab chips, sections); the header and tiles above the chips are the overview. */
export const SECTION_ORDER = [
  "price", "getting-around", "safety", "schools", "local-places", "environment", "health", "homes", "people", "living-costs",
] as const;

/** A section's heading (sections are always open; there is no toggle). */
export function sectionToggle(page: Page | Locator, name: SectionName): Locator {
  if (name === "Planning") return page.getByTestId("footer-planning").locator("summary");
  return page.getByTestId(`evidence-section-${SECTION_IDS[name]}`).locator(".area-section__title");
}

/**
 * From the map, follows the brief's "Open full area page" (keeping the
 * chosen home); on the full page already, stays.
 */
export async function openAreaPage(page: Page): Promise<Locator> {
  const full = page.getByTestId("area-full-page");
  if (await full.count() === 0) {
    // An open Layers card closes first, as a person would close it, and the area sheet comes up.
    if (await page.getByTestId("layers-panel").isVisible()) {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("layers-panel")).toBeHidden();
    }
    await backToArea(page);
    const link = page.getByTestId("open-area-page");
    await expect(link).toBeVisible({ timeout: 15_000 });
    // A phone's sheet fits its half height to the peek once the peek has loaded (map-dock.tsx usePeekFit), and the
    // footer with this link moves with it: a tap before then lands on whatever slid under the finger.
    await expect(page.getByTestId("evidence-panel").locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await link.click();
  }
  await expect(full).toBeVisible({ timeout: 30_000 });
  return full;
}

// Shared navigation for specs that operate topic or home modules: opens the
// full area page (from the map's brief when needed), scrolls the named
// section's heading to the top and returns the section.
/**
 * Opens a link's page: checks where it points, then loads it. Not a click: with every worker busy, the dev
 * server's Fast Refresh (another spec compiling a route) can leave a pending client navigation unfinished for
 * 20 s or more, so a click-and-wait fails for reasons the product does not have.
 */
export async function openLink(page: Page, link: Locator, url: RegExp): Promise<void> {
  await expect(link).toHaveAttribute("href", url);
  await page.goto((await link.getAttribute("href"))!);
  await expect(page).toHaveURL(url);
}

export async function openEvidenceSection(page: Page, name: SectionName): Promise<Locator> {
  await openAreaPage(page);
  if (name === "Plan & check") {
    // Retried: a click before hydration may land before the router is ready.
    await expect(async () => {
      if (await page.getByTestId("check-home").count() === 0) await page.getByTestId("footer-check-home").click();
      await expect(page.getByTestId("check-home")).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 40_000 });
    return page.getByTestId("check-home");
  }
  if (name === "Planning") {
    const planning = page.getByTestId("footer-planning");
    await expect(async () => {
      if ((await planning.getAttribute("open")) === null) await planning.locator("summary").click();
      await expect(planning).toHaveAttribute("open", "", { timeout: 1_000 });
    }).toPass();
    await planning.evaluate((node) => node.scrollIntoView({ block: "start" }));
    return planning;
  }
  const section = page.getByTestId(`evidence-section-${SECTION_IDS[name]}`);
  await expect(section).toBeVisible({ timeout: 15_000 });
  await section.evaluate((node) => node.scrollIntoView({ block: "start" }));
  return section;
}

/** Scrolls back to the summary (the brief's tiles, or the full page's glance). */
export async function showEvidenceSummary(page: Page): Promise<Locator> {
  const summary = page.getByTestId("evidence-summary");
  await summary.evaluate((node) => node.scrollIntoView({ block: "start" }));
  return summary;
}

// The legend's "?" opens the explainer for the layer shown (layer-explainer.tsx): the one place the
// map explains a layer, its method, source and date (v3 Fix 12, 22.8: no "About this data" fold).
export async function openLayerExplainer(page: Page): Promise<Locator> {
  const explainer = page.getByTestId("layer-explainer");
  if (!(await explainer.isVisible())) await page.getByTestId("legend-explain").click();
  await expect(explainer).toBeVisible();
  return explainer;
}

// The map's Layers button opens the Layers card (map-layers.tsx) on its Layers tab: the period,
// then "Colour the map by" (map-data-selector.tsx), a search, the groups with their items (the item
// shown opens with its views and colour key) and the "Show on map" overlays. Open it before
// operating what is inside.
export async function openLayersPanel(page: Page): Promise<Locator> {
  const toggle = page.getByTestId("layers-toggle");
  // Retried: a click before hydration lands on a button without a handler.
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass();
  return page.getByTestId("layers-panel");
}

// The item shown carries its views (actual, rank, change) or Crime's types; the colour key stays on the map.
export async function openScaleSettings(page: Page): Promise<Locator> {
  const panel = await openLayersPanel(page);
  const details = panel.getByTestId("topic-details");
  // The group holding the item shown opens with the menu; open it again if it was closed. Ask the group, not the
  // details: an item's controls can arrive after the menu (Crime's types follow its painted pack), and a click on
  // an open group's head would close it.
  const head = panel.locator(".topic-group__head[data-current]");
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  return details;
}

// Opens an item's group in the Layers menu (an accordion: one group open) and returns the item's row.
export async function topicItem(page: Page, layer: string): Promise<Locator> {
  const panel = await openLayersPanel(page);
  const item = findTopic(layer);
  if (!item) throw new Error(`No data selector item for ${layer}`);
  const row = panel.getByTestId(`layer-${item.layer}`);
  if (!(await row.isVisible())) await panel.getByTestId(`topic-group-${item.group}`).click();
  await expect(row).toBeVisible();
  return row;
}

// Choosing an item colours the map and keeps the card open; Escape closes it and focus returns to the button.
export async function chooseLayer(page: Page, id: string): Promise<void> {
  const row = await topicItem(page, id);
  await row.click();
  // A layer that is a view of its item (Social rent in Tenure, Income or Deprivation in Wealth): pick that view,
  // the item's own too, as the row keeps the view shown.
  const item = findTopic(id);
  const view = item?.views?.find((entry) => entry.layer === id);
  if (item && view) await page.getByTestId("layers-panel").getByTestId(`view-${item.id}-${view.id}`).click();
  // Choosing never closes the card: close it as a visitor would.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("layers-panel")).toBeHidden();
  await backToArea(page);
}

/**
 * One sheet at a time (v4 Task 13): on a phone the area sheet waits at its peek while Layers or Show
 * is open, and stays there when they close. Lifts it again, as a visitor taps its peek line.
 */
export async function backToArea(page: Page): Promise<void> {
  const dock = page.getByTestId("map-dock");
  // A MapSheet still open closes first, as a person would close it.
  const sheet = page.locator(".map-sheet__close");
  if (await sheet.count()) {
    await sheet.first().click();
    await expect(page.locator(".map-sheet")).toHaveCount(0);
  }
  if ((await dock.getAttribute("data-snap")) !== "collapsed" || (await dock.getAttribute("data-area")) === "empty") return;
  if (!(await page.evaluate(() => window.matchMedia("(max-width: 800px)").matches))) return;
  await page.getByTestId("evidence-sheet-reopen").click();
  await expect(dock).toHaveAttribute("data-snap", "half");
}

/**
 * The area view at full (v4 Task 12): a desktop's side panel always is; a phone's sheet shows the peek
 * (verdict, tags, 4 tiles) at half and goes full with its grabber's ArrowUp, as a visitor drags it up.
 */
export async function showFullAreaView(page: Page): Promise<Locator> {
  const panel = page.getByTestId("evidence-panel");
  await expect(panel).toHaveAttribute("data-view", /peek|full/);
  if ((await panel.getAttribute("data-view")) === "peek") {
    await page.getByTestId("sheet-handle").focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("map-dock")).toHaveAttribute("data-snap", "full");
  }
  await expect(panel).toHaveAttribute("data-view", "full");
  return panel;
}

// Picks a view of the item shown (or about to be): "rank", "change", "types", a type of home's layer id.
export async function chooseView(page: Page, layer: string, view: string): Promise<void> {
  const item = findTopic(layer)!;
  const panel = await openLayersPanel(page);
  let button = panel.getByTestId(`view-${item.id}-${view}`);
  if (!(await button.isVisible())) {
    const row = await topicItem(page, layer);
    if (!(await button.isVisible())) await row.click();
    button = panel.getByTestId(`view-${item.id}-${view}`);
  }
  // More than six views fold behind "+n".
  const more = panel.getByTestId(`views-more-${item.id}`);
  if (!(await button.isVisible()) && (await more.isVisible())) await more.click();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

// Method and caveat text sits behind (?) buttons (components/help-tip.tsx):
// open the one named "About <label>" inside scope and return its bubble.
export async function openHelp(scope: Page | Locator, label: string, id: string): Promise<Locator> {
  await scope.getByRole("button", { name: `About ${label}`, exact: true }).click();
  return scope.getByTestId(`help-${id}`);
}
