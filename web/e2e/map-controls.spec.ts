import { expect, test, type Page } from "./fixtures";
import { continueToReview } from "./wizard";
import { openMapSettings, openMatchBuilderByKeyboard, showTimeline } from "./top-bar";

// UX-20: map chrome must never block interactive dock content. Two blocks
// sit over the map — the top bar and the dock — with the map's own Layers
// button and legend chip, so those are the chrome that could cover the dock. A rect overlap alone is not a failure;
// the assertion is hit-tested — it fails only when the bar would actually
// eat the pointer event.
const viewports = [
  { name: "320", size: { width: 320, height: 568 } },
  { name: "390", size: { width: 390, height: 844 } },
  { name: "768", size: { width: 768, height: 1024 } },
  { name: "1280", size: { width: 1280, height: 720 } },
] as const;

interface BlockReport {
  control: string;
  blocked: string;
}

async function blockingIntersections(page: Page, state: string): Promise<BlockReport[]> {
  return page.evaluate((stateName: string): BlockReport[] => {
    void stateName;
    const controls = [...document.querySelectorAll(
      "[data-block='top-bar'], [data-block='intro'], .map-layers-button, .map-key",
    )].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && window.getComputedStyle(el).visibility !== "hidden";
    });
    const interactives = [...document.querySelectorAll(
      ".map-dock button, .map-dock input, .map-dock select, .map-dock a[href], .match-sheet button, .match-sheet input, .match-sheet select",
    )].filter((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && style.pointerEvents !== "none";
    });
    const describe = (el: Element): string => {
      const labelled = (el.getAttribute("aria-label") ?? "").trim();
      return `<${el.tagName.toLowerCase()}> ${(labelled || (el.textContent ?? "").trim()).slice(0, 40)}`;
    };
    const reports: BlockReport[] = [];
    for (const control of controls) {
      const c = control.getBoundingClientRect();
      for (const item of interactives) {
        if (control.contains(item) || item.contains(control)) continue;
        const r = (item as HTMLElement).getBoundingClientRect();
        const left = Math.max(c.left, r.left);
        const right = Math.min(c.right, r.right);
        const top = Math.max(c.top, r.top);
        const bottom = Math.min(c.bottom, r.bottom);
        if (right - left <= 1 || bottom - top <= 1) continue;
        // Sample the overlap through the paint stack: a collision is any
        // point where control chrome and sheet content paint in different
        // subtrees, either order — a covered map control is as broken as a
        // covered sheet action. An item scrolled out of a clipped container
        // is absent from the stack, so it can never report.
        const points = [
          [(left + right) / 2, (top + bottom) / 2],
          [left + 2, top + 2],
          [right - 2, bottom - 2],
        ];
        const blocked = points.some(([x, y]) => {
          if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
          const stack = document.elementsFromPoint(x, y);
          const controlDepth = stack.findIndex((el) => control.contains(el));
          const itemDepth = stack.findIndex((el) => el === item || item.contains(el));
          return controlDepth !== -1 && itemDepth !== -1;
        });
        if (blocked) reports.push({ control: describe(control), blocked: describe(item) });
      }
    }
    return reports;
  }, state);
}

for (const { name, size } of viewports) {
  test(`map controls block nothing at ${name}px`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    const explorer = page.getByTestId("close-knit");

    // Operate map chrome with pointer and keyboard, asserting effects.
    await openMapSettings(page);
    await page.getByRole("button", { name: "Flatten map" }).click();
    await expect(explorer).toHaveAttribute("data-map-pitch", "0");
    await page.getByRole("button", { name: "Tilt map" }).click();
    await expect(explorer).toHaveAttribute("data-map-pitch", "45");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("map-settings")).toBeHidden();
    await showTimeline(page);
    await page.getByLabel("Price period").press("Home");
    await expect(explorer).toHaveAttribute("data-active-period", "2006-06");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("layers-panel")).toBeHidden();
    expect(await blockingIntersections(page, "empty"), `blocked in empty state at ${name}px`).toEqual([]);

    await page.getByRole("combobox", { name: "Search", exact: true }).fill("SW1A");
    await page.getByRole("option", { name: /SW1A 1AA.*Westminster/ }).click();
    await page.getByTestId("selected-area").waitFor();
    expect(await blockingIntersections(page, "evidence"), `blocked in evidence state at ${name}px`).toEqual([]);

    await page.goto("/");
    await openMatchBuilderByKeyboard(page);
    // The map's buttons and legend slide up above the My match sheet (320 ms): measured once they have arrived.
    await expect.poll(() => blockingIntersections(page, "my match"), { message: `blocked with My match open at ${name}px` }).toEqual([]);
    await continueToReview(page);
    expect(await blockingIntersections(page, "match"), `blocked in match state at ${name}px`).toEqual([]);
    await page.getByRole("checkbox", { name: "Compare North London preview" }).click();
    await page.getByRole("checkbox", { name: "Compare South Bank preview" }).click();
    expect(await blockingIntersections(page, "comparison"), `blocked in comparison state at ${name}px`).toEqual([]);
    // The side-by-side is /compare now (v3 Fix 22), off the map.
    await expect(page.getByTestId("comparison-tray").getByRole("link", { name: "Compare areas" })).toBeVisible();
  });
}
