import type { Card, CardBlock } from "../types";
import { NOT_AFFILIATED, safeHref } from "./card";

export interface SummaryOptions {
  logoUrl: string;
  /** Links must point at Close Knit; anything else is dropped. */
  siteOrigin: string;
  /** "Full card ›": opens the floating side card. */
  onOpenCard(): void;
}

export type SummaryBlock = Extract<CardBlock, { type: "summary" }>;

/** The card's summary block, when the server sent one (older servers do not). */
export function summaryOf(card: Card): SummaryBlock | null {
  if (card.status !== "ok") return null;
  const block = card.blocks.find((b) => b.type === "summary") as SummaryBlock | undefined;
  return block && Array.isArray(block.groups) && Array.isArray(block.pills) ? block : null;
}

/**
 * The compact panel under the portal's price: up to four groups in a 2×2 grid (each marked when only Close Knit
 * has it), a wrapping row of coloured pills, and a footer with "Full card ›" and "Save". False when there is
 * nothing to draw.
 */
export function renderSummary(root: ShadowRoot | HTMLElement, card: Card, options: SummaryOptions): boolean {
  const summary = summaryOf(card);
  if (!summary || (!summary.groups.length && !summary.pills.length)) return false;
  const doc = root.ownerDocument ?? document;
  const h = maker(doc);
  const panel = summaryPanel(doc, summary);

  const foot = h("div", "cks-foot");
  const logo = h("img");
  logo.src = options.logoUrl;
  logo.alt = "";
  logo.width = 20;
  logo.height = 20;
  const open = h("button", "cks-button", "Full card ›");
  open.type = "button";
  open.addEventListener("click", () => options.onOpenCard());
  foot.append(logo, h("span", "cks-wordmark", "close knit"), h("span", "cks-spacer"), open);
  const save = saveHref(card, options.siteOrigin);
  if (save) {
    const a = h("a", "cks-button primary", "Save");
    a.href = save;
    a.target = "_blank";
    a.rel = "noopener";
    foot.append(a);
  }
  panel.append(foot, h("div", "cks-note", NOT_AFFILIATED));

  const style = root.querySelector("style");
  root.replaceChildren(...(style ? [style] : []), panel);
  return true;
}

function maker(doc: Document) {
  return <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
}

/** The groups and pills, without the footer: the inline panel's body, and the summary inside the side panel. */
export function summaryPanel(doc: Document, summary: SummaryBlock): HTMLElement {
  const h = maker(doc);
  const panel = h("section", "cks");
  panel.setAttribute("aria-label", "Close Knit summary");
  panel.setAttribute("data-testid", "close-knit-summary");

  if (summary.groups.length) {
    const grid = h("div", "cks-grid");
    for (const group of summary.groups) {
      const box = h("div", "cks-group");
      const head = h("div", "cks-head");
      // A placeholder (src/swr.ts) has no title yet, and grey bars for its rows and pills.
      head.append(group.title ? h("span", "cks-title", group.title) : h("span", "cks-skel cks-skel-title"));
      if (group.only) head.append(h("span", "cks-only", "only Close Knit"));
      const list = h("ul", "cks-rows");
      for (const row of group.rows ?? []) {
        if (row.pending) {
          const item = h("li", "cks-row pending");
          item.append(h("span", "cks-dot none"), h("span", "cks-skel"), h("span", "cks-skel"));
          list.append(item);
          continue;
        }
        const item = h("li", "cks-row");
        const tone = row.tone === "good" || row.tone === "bad" ? row.tone : "none";
        item.append(h("span", `cks-dot ${tone}`), h("span", "cks-label", row.label), h("span", "cks-value", row.value));
        list.append(item);
      }
      box.append(head, list);
      grid.append(box);
    }
    panel.append(grid);
  }

  if (summary.pills.length) {
    const pills = h("div", "cks-pills");
    for (const pill of summary.pills) {
      const band = typeof pill.band === "number" && pill.band >= 1 && pill.band <= 5 ? pill.band : 0;
      if (pill.pending) {
        pills.append(h("span", "cks-pill pending"));
        continue;
      }
      const chip = h("span", `cks-pill b${band}`);
      chip.append(h("span", "cks-pill-label", pill.label), h("strong", undefined, pill.value));
      pills.append(chip);
    }
    panel.append(pills);
  }
  const pending = summary.pills.some((p) => p.pending) || summary.groups.some((g) => (g.rows ?? []).some((r) => r.pending));
  if (pending) panel.setAttribute("aria-busy", "true");
  return panel;
}

/** The Save link from the card's actions, if it points at Close Knit. */
export function saveHref(card: Card, siteOrigin: string): string | null {
  const actions = card.blocks.find((b): b is Extract<CardBlock, { type: "actions" }> => b.type === "actions");
  const item = actions?.items?.find((i) => i.kind === "save");
  return item ? safeHref(item.href, siteOrigin) : null;
}
