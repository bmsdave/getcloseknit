// The line inside a portal's map popup card (Rightmove, Zoopla, OnTheMarket map views), behind the server's
// `mapPopup` switch. The listing comes from the card's link; its facts from the page's data, else from the
// listing's own page, fetched here in the user's browser (never by our server). Same request and cache as
// the results line (background › badges).
import { ext } from "../api";
import { readListing } from "../adapters";
import { snapshot } from "../adapters/parse";
import { readResults, resultsAdapter, resultsSnapshot } from "../adapters/results";
import { complete, findPopups, indexItems, itemFromFacts, listingUrl, type PopupSlot } from "../adapters/results/popups";
import type { Badges, ResultItem, ResultsAdapter } from "../adapters/results/types";
import { withDaysChip } from "../local";
import { localDate } from "../memory";
import { fontFaceCss } from "../render/styles";
import { badgeView, renderBadge } from "./badge";
import { send } from "./host";

/** On our host: the listing id it shows. */
const HOST = "data-close-knit-map";
const SCAN_DELAY_MS = 120;
const ALLOWED_MS = 60 * 1000;
/** A portal that keeps dropping our line gets it back this many times per card, then is left alone. */
const MAX_REDRAWS = 3;
/** Events kept from the map and the card's own handlers (dragging the map, closing the popup, opening the listing). */
const KEPT_EVENTS = ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"];

interface CardState {
  id: string;
  shown: boolean;
  draws: number;
}

const cards = new WeakMap<HTMLElement, CardState>();
const allowed = new Map<string, { at: number; value: Promise<boolean> }>();
const fetched = new Map<string, Promise<ResultItem | null>>();
let known = new Map<string, ResultItem>();
let readFor = "";
let timer: ReturnType<typeof setTimeout> | null = null;

/** Popups are created and re-created as pins are opened: watch the page and look again after each burst. */
export function startMapPopups(): void {
  if (!resultsAdapter(location.href.split("#")[0])?.popups) return;
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
}

function schedule(): void {
  timer ??= setTimeout(() => {
    timer = null;
    scan();
  }, SCAN_DELAY_MS);
}

function scan(): void {
  const adapter = resultsAdapter(location.href.split("#")[0]);
  if (!adapter?.popups) return;
  for (const slot of findPopups(document, adapter)) {
    const state = cards.get(slot.card);
    const host = slot.card.querySelector(`:scope > [${HOST}]`);
    if (state?.id === slot.listingId) {
      // Drawn and still there, being drawn, or nothing to show: leave it. Dropped by the portal: once more.
      if (!state.shown || host?.getAttribute(HOST) === slot.listingId || state.draws >= MAX_REDRAWS) continue;
    }
    const next: CardState = { id: slot.listingId, shown: false, draws: (state?.id === slot.listingId ? state.draws : 0) + 1 };
    cards.set(slot.card, next);
    void draw(adapter, slot, next);
  }
}

async function draw(adapter: ResultsAdapter, slot: PopupSlot, state: CardState): Promise<void> {
  if (!(await lineAllowed(adapter.portal))) return;
  const item = await itemFor(adapter, slot);
  if (!item || (item.lat === null && item.postcode === null)) return;
  const result = await send<Badges>({ type: "badges", surface: "map", portal: adapter.portal, items: [item] });
  const badge = result?.items.find((entry) => entry.listingId === item.listingId);
  const view = badge && result ? badgeView(badge, result.scale) : null;
  // The card was closed, or now shows another listing, while we waited.
  if (!view || !result || !slot.card.isConnected || cards.get(slot.card) !== state) return;
  // Days on the market are counted here: the page's date is never sent.
  view.chips = withDaysChip(view.chips, item.listedOn, localDate(Date.now()));
  for (const old of slot.card.querySelectorAll(`:scope > [${HOST}]`)) old.remove();
  const host = document.createElement("div");
  host.setAttribute(HOST, slot.listingId);
  const place = adapter.popups!.place;
  host.dataset.place = place;
  // A card of fixed height (Rightmove): hung just above it, so the card keeps its size and the selected pin
  // under the card stays visible.
  if (place === "below") host.style.cssText = "position:absolute;bottom:100%;left:0;right:0;margin-bottom:6px;z-index:1;";
  // Else the card's width and no wider: a popup that sizes to its content (Zoopla's info window) keeps its width.
  else host.style.cssText = "width:0;min-width:100%;";
  for (const type of KEPT_EVENTS) host.addEventListener(type, (event) => event.stopPropagation());
  renderBadge(host.attachShadow({ mode: "open" }), view, result.scale, { compact: true });
  slot.card.append(host);
  state.shown = true;
  addFont();
}

/** The background's answer (portal mode, consent, the server's mapPopup switch), asked at most once a minute. */
function lineAllowed(portal: ResultsAdapter["portal"]): Promise<boolean> {
  const cached = allowed.get(portal);
  if (cached && Date.now() - cached.at < ALLOWED_MS) return cached.value;
  const value = send<boolean>({ type: "line-allowed", portal, surface: "map" }).then((answer) => answer === true);
  allowed.set(portal, { at: Date.now(), value });
  return value;
}

/** The page's results and pins (read again once per address when a card's listing is not among them), else its page. */
async function itemFor(adapter: ResultsAdapter, slot: PopupSlot): Promise<ResultItem | null> {
  const url = location.href.split("#")[0];
  if (!complete(known.get(slot.listingId)) && readFor !== url) {
    readFor = url;
    try {
      const page = resultsSnapshot(document, url);
      known = indexItems([...known.values()], adapter.popups?.pins?.(page) ?? [], readResults(page)?.items ?? []);
    } catch {
      // A portal changed its data: the listing's page still has the facts.
    }
  }
  const partial = known.get(slot.listingId);
  if (complete(partial)) return partial;
  const page = listingUrl(slot.href, location.href);
  if (!page) return partial ?? null;
  if (!fetched.has(page)) fetched.set(page, listingItem(page));
  return (await fetched.get(page)!) ?? partial ?? null;
}

/** One listing's page, read in the browser with the listing adapters (as on the listing page itself). */
async function listingItem(url: string): Promise<ResultItem | null> {
  try {
    const response = await fetch(url, { credentials: "include", headers: { accept: "text/html" } });
    if (!response.ok) return null;
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const facts = readListing(snapshot(doc, url));
    return facts ? itemFromFacts(facts) : null;
  } catch {
    return null;
  }
}

/** @font-face only works from the document, not inside a shadow root. */
function addFont(): void {
  if (document.getElementById("close-knit-font")) return;
  const font = document.createElement("style");
  font.id = "close-knit-font";
  font.textContent = fontFaceCss(ext.runtime.getURL("fonts/BricolageGrotesque-latin.woff2"));
  document.head.append(font);
}
