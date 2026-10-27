// On the portals' search pages: one line under each result (canvas variant K). The results come from
// the page's data; the layout is used only to find each result's card to put the line in.
import { ext } from "../api";
import { readResults, resultsAdapter, resultsSnapshot } from "../adapters/results";
import { inPopup } from "../adapters/results/popups";
import type { Badges, ResultItem, ResultsAdapter } from "../adapters/results/types";
import { MAX_BATCH } from "../badges";
import { withDaysChip } from "../local";
import { localDate } from "../memory";
import { fontFaceCss } from "../render/styles";
import { badgeView, renderBadge } from "./badge";
import { send } from "./host";
import { lazyBatcher, visibilityWatcher } from "./lazy";
import { startMapPopups } from "./mapPopup";

const CHECK_MS = 1000;
/** On a result's card: "pending" until it comes into view, "shown" with a line, "none" when there was nothing to show. */
const MARK = "data-close-knit-badge";
const HOST = "data-close-knit-badge-host";
/** A card is the largest box around a result's link that links to no other result; never climb further. */
const MAX_CLIMB = 12;

let lastKey = "";
let busy = false;
let fetchedFor: string | null = null;
let fetched: ResultItem[] = [];

/** Pages change without reloading (next page, infinite scroll), so the results are checked every second. */
function check(): void {
  if (busy) return;
  const url = location.href.split("#")[0];
  const adapter = resultsAdapter(url);
  if (!adapter) return;
  dropLostLines();
  const links = resultLinks(adapter);
  const key = `${url}|${[...links.keys()].join(",")}|${document.querySelectorAll(`[${MARK}]`).length}`;
  if (key === lastKey) return;
  lastKey = key;
  busy = true;
  void run(adapter, url, links).finally(() => {
    busy = false;
  });
}

async function run(adapter: ResultsAdapter, url: string, links: Map<string, HTMLAnchorElement>): Promise<void> {
  let items = readResults(resultsSnapshot(document, url))?.items ?? [];
  if (fetchedFor === url) items = merge(items, fetched);
  const known = new Set(items.map((item) => item.listingId));
  const unknown = [...links.keys()].filter((id) => !known.has(id)).length;
  if (fetchedFor !== url && unknown > links.size / 2) {
    // Client-side navigation leaves the first page's data in the document: read this address's own page
    // once. (A few unknown links, such as adverts or recently viewed homes, are not a reason to.)
    fetchedFor = url;
    fetched = await freshItems(url);
    items = merge(items, fetched);
  }
  for (const item of items) {
    const anchor = links.get(item.listingId);
    if (!anchor || (item.lat === null && item.postcode === null)) continue;
    const card = cardOf(anchor, adapter, item.listingId);
    if (card.hasAttribute(MARK)) continue;
    // Fetched only once the card comes into view (the lazy results line).
    card.setAttribute(MARK, "pending");
    waiting.set(card, { item, url, portal: adapter.portal });
    watcher.watch(card);
  }
}

interface Waiting {
  item: ResultItem;
  url: string;
  portal: ResultsAdapter["portal"];
}
type Visible = Waiting & { card: HTMLElement };

const waiting = new WeakMap<Element, Waiting>();
const batcher = lazyBatcher<Visible>({ max: MAX_BATCH, flush: draw });
const watcher = visibilityWatcher((card) => {
  const entry = waiting.get(card);
  waiting.delete(card);
  if (entry) batcher.add({ ...entry, card: card as HTMLElement });
});

/** One request for the results that came into view together; the line goes into each one's card. */
async function draw(batch: Visible[]): Promise<void> {
  const here = location.href.split("#")[0];
  const live = batch.filter(({ card, url }) => url === here && card.isConnected);
  // A card left behind by navigation is unmarked, so it is found again if it comes back.
  for (const entry of batch) if (!live.includes(entry)) entry.card.removeAttribute(MARK);
  if (!live.length) return;
  const result = await send<Badges>({ type: "badges", surface: "results", portal: live[0].portal,
    items: live.map(({ item }) => item) });
  if (!result || location.href.split("#")[0] !== here) {
    for (const { card } of live) card.removeAttribute(MARK);
    return;
  }
  const today = localDate(Date.now());
  const byId = new Map(result.items.map((badge) => [badge.listingId, badge]));
  for (const { item, card } of live) {
    const badge = byId.get(item.listingId);
    const view = badge ? badgeView(badge, result.scale) : null;
    card.setAttribute(MARK, view ? "shown" : "none");
    if (!view) continue;
    // Days on the market are counted here: the page's date is never sent.
    view.chips = withDaysChip(view.chips, item.listedOn, today);
    const host = document.createElement("div");
    host.setAttribute(HOST, item.listingId);
    renderBadge(host.attachShadow({ mode: "open" }), view, result.scale);
    card.append(host);
  }
  addFont();
}

/** Each result link on the page by listing id (the first one found), outside our own lines. */
function resultLinks(adapter: ResultsAdapter): Map<string, HTMLAnchorElement> {
  const links = new Map<string, HTMLAnchorElement>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (inPopup(anchor, adapter)) continue; // a map popup card has its own line (mapPopup.ts)
    const id = adapter.linkId(anchor.getAttribute("href") ?? "");
    if (id && !links.has(id)) links.set(id, anchor);
  }
  return links;
}

function cardOf(anchor: HTMLElement, adapter: ResultsAdapter, id: string): HTMLElement {
  let card = anchor;
  for (let i = 0; i < MAX_CLIMB; i++) {
    const parent = card.parentElement;
    if (!parent || parent === document.body || linksElsewhere(parent, adapter, id)) break;
    card = parent;
  }
  return card;
}

function linksElsewhere(box: HTMLElement, adapter: ResultsAdapter, id: string): boolean {
  for (const anchor of box.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const other = adapter.linkId(anchor.getAttribute("href") ?? "");
    if (other && other !== id) return true;
  }
  return false;
}

/** A portal that re-renders a card drops our line: its card is marked again as new. */
function dropLostLines(): void {
  for (const card of document.querySelectorAll<HTMLElement>(`[${MARK}="shown"]`)) {
    if (!card.querySelector(`:scope > [${HOST}]`)) card.removeAttribute(MARK);
  }
}

async function freshItems(url: string): Promise<ResultItem[]> {
  try {
    const response = await fetch(url, { credentials: "include", headers: { accept: "text/html" } });
    if (!response.ok) return [];
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    return readResults(resultsSnapshot(doc, url))?.items ?? [];
  } catch {
    return [];
  }
}

function merge(first: ResultItem[], second: ResultItem[]): ResultItem[] {
  const ids = new Set(first.map((item) => item.listingId));
  return [...first, ...second.filter((item) => !ids.has(item.listingId))];
}

/** @font-face only works from the document, not inside a shadow root. */
function addFont(): void {
  if (document.getElementById("close-knit-font")) return;
  const font = document.createElement("style");
  font.id = "close-knit-font";
  font.textContent = fontFaceCss(ext.runtime.getURL("fonts/BricolageGrotesque-latin.woff2"));
  document.head.append(font);
}

check();
setInterval(check, CHECK_MS);
startMapPopups();
