// Chrome's side panel: the card for the active tab's listing (header, summary, sections, actions), drawn with
// the same renderers as the page. The content script reads the page and hands the facts to the background.
import { apiBase, ENABLED_KEY, ext } from "../api";
import { NOT_AFFILIATED, renderCard } from "../render/card";
import { summaryPanel } from "../render/summary";
import { CARD_CSS, PANEL_CSS, SUMMARY_CSS } from "../render/styles";
import { PORTAL_NAMES, PORTALS, SETTINGS_KEY } from "../settings";
import type { PanelView } from "../types";

const host = document.getElementById("panel")!;
const root = host.attachShadow({ mode: "open" });
const style = document.createElement("style");
style.textContent = CARD_CSS + SUMMARY_CSS + PANEL_CSS;
root.append(style);

const MESSAGES: Record<Exclude<PanelView["state"], "ok">, string> = {
  "no-listing": `Open a listing on ${PORTALS.map((p) => PORTAL_NAMES[p]).join(", ")} to see its area.`,
  off: "Close Knit is not available on this site right now.",
  disabled: "Close Knit is off. Turn it on from the toolbar button.",
  "no-consent": "Close Knit needs to send the listing's coordinates and price to show area data. That is off in Settings.",
  error: "Could not load the area. Try again in a moment.",
};

let drawing = 0;

async function refresh(): Promise<void> {
  const turn = ++drawing;
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const view = tab?.id === undefined ? null :
    ((await ext.runtime.sendMessage({ type: "panel-card", tabId: tab.id }).catch(() => null)) as PanelView | null);
  if (turn !== drawing) return;
  if (view?.state === "ok" && view.card) {
    renderCard(root, view.card, {
      logoUrl: ext.runtime.getURL("icons/icon.svg"),
      siteOrigin: apiBase,
      collapsed: false,
      summary: (block) => summaryPanel(document, block),
    });
    return;
  }
  const state = view?.state && view.state !== "ok" ? view.state : "no-listing";
  message(view?.state === "off" && view.notice ? view.notice : MESSAGES[state], state === "no-consent");
}

function message(text: string, withSettings: boolean): void {
  const h = (tag: string, className: string, content?: string) => {
    const node = document.createElement(tag);
    node.className = className;
    if (content) node.textContent = content;
    return node;
  };
  const shell = h("div", "ck");
  const card = h("section", "card");
  const brand = h("div", "brand");
  const img = document.createElement("img");
  img.src = ext.runtime.getURL("icons/icon.svg");
  img.alt = "";
  brand.append(img, h("span", "wordmark", "close knit"));
  card.append(brand, h("p", "muted", text));
  if (withSettings) {
    const button = h("button", "button", "Settings") as HTMLButtonElement;
    button.type = "button";
    button.addEventListener("click", () => void ext.runtime.openOptionsPage());
    card.append(button);
  }
  card.append(h("div", "footnote not-affiliated", NOT_AFFILIATED));
  shell.append(card);
  root.replaceChildren(style, shell);
}

ext.tabs.onActivated.addListener(() => void refresh());
ext.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") void refresh();
});
ext.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === "panel-update") void refresh();
  return undefined;
});
ext.storage.onChanged.addListener((changes) => {
  if (SETTINGS_KEY in changes || ENABLED_KEY in changes) void refresh();
});
void refresh();
