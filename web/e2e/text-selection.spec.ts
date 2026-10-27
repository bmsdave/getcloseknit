import { expect, pause, test, type Locator, type Page } from "./fixtures";

import { showFullAreaView } from "./evidence";

// Spec slice F: text in the area block is for reading and copying. A mouse drag
// over it selects it at every width; only the grabber, the head and the peek
// line move the phone sheet (sheet-gestures.spec.ts covers the finger).

async function openArea(page: Page) {
  await page.goto("/?selected=uk%3Alsoa%3AE01000001");
  await expect(page.getByTestId("selected-area")).toContainText(/St James's|Westminster/);
  // The verdict comes with the area's standouts, a moment after the name.
  await expect(page.locator(".dock-area [data-testid=area-verdict-line]")).toBeVisible({ timeout: 15_000 });
}

/** The first visible element in the dock's text matching `selector` with some words in it. */
async function visibleText(page: Page, selector: string): Promise<Locator> {
  const all = page.locator(`.dock-area ${selector}`);
  const count = await all.count();
  for (let index = 0; index < count; index += 1) {
    const item = all.nth(index);
    if (await item.isVisible() && ((await item.textContent()) ?? "").trim().length > 8) return item;
  }
  throw new Error(`no visible ${selector} with text in the dock`);
}

/**
 * Presses the mouse at the start of `element`'s first line of text and drags along its words,
 * or (`down`) down the page over the next lines, the way a reader selects a few lines.
 */
async function dragSelect(page: Page, element: Locator, down = 0, beforeUp?: () => Promise<void>) {
  await element.scrollIntoViewIfNeeded();
  const line = await element.evaluate((node) => {
    // The first words, not an icon before them (a tile's trend arrow leads its line).
    const words = document.createTreeWalker(node, NodeFilter.SHOW_TEXT,
      { acceptNode: (text) => (text.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) }).nextNode();
    const range = document.createRange();
    range.selectNodeContents(words ?? node);
    const { x, y, width, height } = range.getClientRects()[0];
    return { x, y, width, height };
  });
  const y = line.y + line.height / 2;
  await page.mouse.move(line.x + 1, y);
  await page.mouse.down();
  if (down) {
    await page.mouse.move(line.x + 10, y + down, { steps: 12 });
  } else {
    await page.mouse.move(line.x + line.width / 2, y, { steps: 6 });
    await page.mouse.move(line.x + line.width - 1, y, { steps: 6 });
  }
  await beforeUp?.();
  await page.mouse.up();
}

const selection = (page: Page) => page.evaluate(() => getSelection()?.toString().trim() ?? "");

test("a mouse drag over a paragraph in the area block selects it", async ({ page }) => {
  await openArea(page);
  await dragSelect(page, await visibleText(page, "p"));
  expect((await selection(page)).length).toBeGreaterThan(3);
});

test("figures in the sections' rows select like any text", async ({ page }) => {
  await openArea(page);
  // v4 Task 12: the tiles are links to their sections; the figures to copy are the sections' rows.
  await showFullAreaView(page);
  await expect(page.locator(".dock-area .key-numbers dd").first()).toBeVisible({ timeout: 15_000 });
  // Retried: the sections below load on their own and re-render their rows, so a row picked a moment ago can be
  // replaced before the drag reaches it.
  await expect(async () => {
    const value = await visibleText(page, ".key-numbers dd");
    expect(await value.evaluate((node) => getComputedStyle(node).userSelect)).not.toBe("none");
    await dragSelect(page, value);
    expect((await selection(page)).length).toBeGreaterThan(3);
  }).toPass({ timeout: 15_000 });
});

test("on a phone a mouse drag in the sheet's text selects it and leaves the sheet where it rests", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the phone sheet");
  await openArea(page);
  const dock = page.getByTestId("map-dock");
  await expect(dock).toHaveAttribute("data-snap", "half");
  await expect.poll(() => dock.evaluate((node) => getComputedStyle(node).transform)).toBe("none");
  const top = (await dock.boundingBox())!.y;
  // Down over a few lines: a press in the text never starts a sheet drag.
  await dragSelect(page, await visibleText(page, "p"), 40, async () => {
    // Mid-drag the sheet has not moved: the text is being selected.
    expect(await dock.evaluate((node) => node.dataset.dragging ?? "")).toBe("");
    expect((await dock.boundingBox())!.y).toBeCloseTo(top, 0);
  });
  expect((await selection(page)).length).toBeGreaterThan(3);
  await expect(dock).toHaveAttribute("data-snap", "half");
  // The grabber still drags the sheet (by mouse too) and it snaps.
  const grip = (await page.getByTestId("sheet-handle").boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Most of the way down: the half grows to show the whole peek (usePeekFit, up to 72% of the screen),
  // so a slow release must land nearer the peek than the half.
  await page.mouse.move(x, page.viewportSize()!.height - 40, { steps: 20 });
  await pause(200);
  await page.mouse.up();
  await expect(dock).toHaveAttribute("data-snap", "collapsed");
});
