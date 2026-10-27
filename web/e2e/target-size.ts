import type { Page } from "./fixtures";

// #15 target-size pass (WCAG 2.5.8 and DESIGN.md › Buttons and controls).
// Every visible control is measured; a checkbox or radio counts through its
// <label>. Under 24px fails (WCAG minimum); under 44px is reported as a
// warning against the house rule. Links inside running text are exempt
// (WCAG's inline exception), as is the map canvas.
export type TargetReport = { fail: string[]; warn: string[] };

export async function targetSizes(page: Page): Promise<TargetReport> {
  return page.evaluate(() => {
    const fail: string[] = [];
    const warn: string[] = [];
    const seen = new Set<Element>();
    const selector = "a[href], button, input:not([type='hidden']), select, textarea, summary, [role='button'], [role='tab'], [role='checkbox'], [role='switch'], [role='radio'], [role='option']";
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const input = element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio");
      const target = (input ? element.closest("label") : null) ?? element;
      if (seen.has(target)) continue;
      seen.add(target);
      if (target.closest("canvas, .maplibregl-canvas-container, [aria-hidden='true'], [inert]")) continue;
      if (target.getClientRects().length === 0) continue;
      const style = getComputedStyle(target);
      if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      // Visually hidden inputs styled through their label (sr-only patterns).
      const box = target.getBoundingClientRect();
      if (box.width <= 2 && box.height <= 2) continue;
      if (target.tagName === "A" && style.display === "inline" && target.parentElement
        && /\S/.test([...target.parentElement.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(""))) continue;
      const name = (target.getAttribute("aria-label") ?? target.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const label = `${Math.round(box.width)}x${Math.round(box.height)} <${target.tagName.toLowerCase()}${target.className && typeof target.className === "string" ? `.${target.className.split(" ")[0]}` : ""}> ${name}`;
      if (box.width < 24 || box.height < 24) fail.push(label);
      else if (box.width < 44 || box.height < 44) warn.push(label);
    }
    return { fail, warn };
  });
}

// Visible text rendered under the floor: HTML text under 12px, chart SVG text
// under 11px on screen (its font size times the SVG's scale).
export async function smallText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const small: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const checked = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || checked.has(parent) || !node.textContent?.trim()) continue;
      checked.add(parent);
      if (parent.closest("script, style, noscript, [aria-hidden='true'], .sr-only, .visually-hidden")) continue;
      if (parent.getClientRects().length === 0) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      let px = Number.parseFloat(style.fontSize);
      let floor = 12;
      const element: Element = parent;
      if (element instanceof SVGGraphicsElement) {
        const matrix = element.getScreenCTM();
        if (matrix) px *= Math.hypot(matrix.a, matrix.b);
        floor = 11;
      }
      if (px < floor - 0.05) {
        const owner = parent.closest("[class]");
        const where = owner && typeof owner.className === "string" ? `.${owner.className.split(" ")[0]}` : "";
        small.push(`${px.toFixed(1)}px <${parent.tagName.toLowerCase()}> in ${where} ${node.textContent.trim().slice(0, 30)}`);
      }
    }
    return small;
  });
}
