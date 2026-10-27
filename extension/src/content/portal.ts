// On Rightmove, Zoopla, OnTheMarket, SpareRoom and OpenRent: find the listing on the page and show its area card,
// where the portal's mode says: under the price (with the side card), in Chrome's side panel (a small pill on the
// page opens it), as the floating side card alone (Safari), or not at all.
import { apiBase, ENABLED_KEY, ext } from "../api";
import { readListing } from "../adapters";
import { snapshot } from "../adapters/parse";
import { NOT_AFFILIATED, renderCard } from "../render/card";
import { renderSummary, summaryOf } from "../render/summary";
import { SETTINGS_KEY } from "../settings";
import { skeletonCard } from "../swr";
import type { Card, ListingFacts, ListingView } from "../types";
import { findAnchor } from "./anchors";
import { mountHost, mountInline, send, unmountInline } from "./host";

const HOST_ID = "close-knit-extension";
const INLINE_ID = "close-knit-inline";
const COLLAPSED_KEY = "close-knit.collapsed";
const CHECK_MS = 1000;

let shownFor: string | null = null;
let clearedFor: string | null = null;
let root: ShadowRoot | null = null;
/** The side card is open beside the inline panel ("Full card ›"), so a redraw keeps it open. */
let sideOpen = false;

/** Portals change pages without reloading, so the address is checked every second. */
function check(): void {
  const url = location.href.split("#")[0];
  if (url === shownFor) return;
  if (shownFor !== null) clear();
  const facts = readListing(snapshot(document, url));
  if (!facts) {
    // Searches and other pages: no card, and the side panel hears there is no listing here (once per address).
    // A listing whose data has not arrived yet is tried again.
    shownFor = null;
    if (clearedFor !== url) {
      clearedFor = url;
      void send({ type: "listing", facts: null });
    }
    return;
  }
  shownFor = url;
  clearedFor = null;
  void show(facts);
}

function clear(): void {
  sideOpen = false;
  unmountInline(INLINE_ID);
  root?.replaceChildren(...[...root.children].filter((n) => n.tagName === "STYLE"));
}

async function show(facts: ListingFacts): Promise<void> {
  const url = shownFor;
  const current = () => location.href.split("#")[0] === url && shownFor === url;
  const view = await send<ListingView>({ type: "listing", facts });
  // Without consent to send the listing, nothing shows on the page (the popup and side panel say why).
  if (!view || !view.consent || !current()) return;
  if (view.mode === "side-panel") {
    // The card lives in the side panel; on the page, only the pill that opens it.
    root ??= mountHost(HOST_ID);
    drawPanelPill(root);
    return;
  }
  if (view.mode === "off") return;
  // The kept card at once, else a placeholder of the same size; then the up-to-date card when it differs.
  const kept = view.card && view.card.status !== "error" ? view.card : null;
  if (kept || view.refresh) render(facts, view.mode, kept ?? skeletonCard());
  if (!view.refresh) return;
  const fresh = await send<Card>({ type: "listing-card", facts });
  if (!current()) return;
  if (!fresh || fresh.status === "error") {
    if (!kept) clear();
    return;
  }
  if (!kept || JSON.stringify(fresh) !== JSON.stringify(kept)) render(facts, view.mode, fresh);
}

/** Draws the card where the mode says; drawn again (the same places, no flicker) when a fresher card arrives. */
function render(facts: ListingFacts, mode: ListingView["mode"], card: Card): void {
  root ??= mountHost(HOST_ID);
  const draw = (collapsed: boolean) => {
    sideOpen = !collapsed;
    renderCard(root!, card, {
      logoUrl: ext.runtime.getURL("icons/icon.svg"),
      siteOrigin: apiBase,
      collapsed,
      onToggle: (next) => {
        try {
          sessionStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
        } catch {
          // Storage blocked: the choice lasts for this page only.
        }
        // With the panel under the price, minimising the side card hides it: nothing stays at the side.
        if (next && shown) hideSideCard();
        else draw(next);
      },
    });
  };
  // On the page, the inline panel under the price is all that shows; "Full card ›" opens the side card.
  const inline = mode === "inline" && summaryOf(card) ? mountInline(INLINE_ID, () => findAnchor(document, facts.portal)) : null;
  const shown = inline !== null && renderSummary(inline, card, {
    logoUrl: ext.runtime.getURL("icons/icon.svg"),
    siteOrigin: apiBase,
    onOpenCard: () => draw(false),
  });
  if (!shown) unmountInline(INLINE_ID);
  // A side card the user opened stays open, with the fresher card in it.
  if (shown && !sideOpen) hideSideCard();
  else draw(shown ? false : collapsedAtStart(card));
}

/** Empties the side card's host (keeps its styles), so nothing shows at the side of the page. */
function hideSideCard(): void {
  sideOpen = false;
  root?.replaceChildren(...[...root.children].filter((n) => n.tagName === "STYLE"));
}

function collapsedAtStart(card: Card): boolean {
  let collapsed = card.status !== "ok";
  try {
    collapsed = collapsed || sessionStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    // Keep the default.
  }
  return collapsed;
}

/** "Close Knit ›": opens Chrome's side panel (the click's user gesture travels with the message). */
function drawPanelPill(target: ShadowRoot): void {
  const shell = document.createElement("div");
  shell.className = "ck";
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "pill";
  pill.title = `Open Close Knit beside the page. ${NOT_AFFILIATED}`;
  const img = document.createElement("img");
  img.src = ext.runtime.getURL("icons/icon.svg");
  img.alt = "";
  const label = document.createElement("span");
  label.textContent = "Close Knit ›";
  pill.append(img, label);
  pill.addEventListener("click", () => void send({ type: "open-side-panel" }));
  shell.append(pill);
  target.replaceChildren(...[...target.children].filter((n) => n.tagName === "STYLE"), shell);
}

// A changed setting or the on/off switch redraws the listing in its new place.
ext.storage.onChanged.addListener((changes) => {
  if (SETTINGS_KEY in changes || ENABLED_KEY in changes) {
    if (shownFor !== null) clear();
    shownFor = null;
  }
});

check();
setInterval(check, CHECK_MS);
