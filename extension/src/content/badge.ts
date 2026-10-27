// The line under a search result. With the API's chips: a mini version of the listing card's summary in three
// rows beside a 34 px score ring. Row 1 is what only Close Knit has (missed limits, minutes to each place, the
// price strip and position, the monthly cost, days on the market, the area's price change); row 2 the area's
// pills; row 3 "Before you offer". Each item is coloured by its band. An API without the pills draws row 1
// alone. Without chips (older API): canvas variant K, a small ring, the price strip and one flag.
import type { Badge, Chip, Pill } from "../adapters/results/types";
import { NOT_AFFILIATED } from "../render/card";
import { FONT_FAMILY } from "../render/styles";

export interface BadgeView {
  /** The ring's text ("82", "7"), "✕" when the search's limits rule the area out. */
  ring: string;
  /** 1-5, the site's diverging ramp (bad → good); null: grey. */
  band: Badge["band"];
  excluded: boolean;
  /** What the ring means, said in full for screen readers and the tooltip. */
  label: string;
  bucket: Badge["bucket"];
  bucketLabel: string | null;
  flag: string | null;
  /** The API's row 1; null when it sent none (the older line is drawn). */
  chips: Chip[] | null;
  /** Rows 2 and 3; empty from older APIs. */
  pills: Pill[];
  offer: Pill[];
}

const BUCKET_LABELS = [
  "Asking price below most local sales of this type",
  "Asking price in the lower half of local sales of this type",
  "Asking price in the upper half of local sales of this type",
  "Asking price above most local sales of this type",
];

/** Nothing to show (no score, no strip, no flag, no chips): null, and the result gets no line. */
export function badgeView(badge: Badge, scale: "match" | "area"): BadgeView | null {
  const flag = badge.flag ?? null;
  const bucketLabel = badge.bucket === null ? null : BUCKET_LABELS[badge.bucket] ?? null;
  const chips = Array.isArray(badge.chips) ? badge.chips.filter((chip) => chip && typeof chip.text === "string" && chip.text) : null;
  const pills = validPills(badge.pills);
  const offer = validPills(badge.offer);
  if (badge.score === null && !badge.excluded && bucketLabel === null && flag === null && !chips?.length && !pills.length) {
    return null;
  }
  let ring = "?";
  let label = "No area rating";
  if (badge.excluded) [ring, label] = ["✕", "Misses your search's limits"];
  else if (badge.score !== null && scale === "match") [ring, label] = [String(badge.score), `${badge.score}/100 for your search`];
  else if (badge.score !== null) [ring, label] = [String(badge.score), `Area ${badge.score}/10 against ${badge.rankScope?.name || "London"}`];
  return { ring, band: badge.excluded ? 1 : badge.band, excluded: badge.excluded, label, bucket: badge.bucket, bucketLabel,
    flag, chips, pills: chips ? pills : [], offer: chips ? offer : [] };
}

function validPills(pills: Pill[] | undefined): Pill[] {
  if (!Array.isArray(pills)) return [];
  return pills.filter((pill) => pill && typeof pill.label === "string" && typeof pill.value === "string" && pill.value);
}

const RING_RADIUS = 9;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Pills kept in the compact line (a map popup is about 280 px wide); the tooltip still lists them all. */
export const COMPACT_PILLS = 6;

/**
 * Not a link: cards are often links themselves (OpenRent), and the listing's own page has the full card.
 * `compact` (a map popup card): the card's full width, a smaller ring, rows 1-2 with at most COMPACT_PILLS pills.
 */
export function renderBadge(root: ShadowRoot, view: BadgeView, scale: "match" | "area", options: { compact?: boolean } = {}): void {
  if (view.chips) {
    const line = rowsLine(view, view.chips, options.compact === true);
    if (options.compact) line.className += " compact";
    root.replaceChildren(styleTag(), line);
    return;
  }
  const line = el("span", options.compact ? "line compact" : "line");
  line.title = [view.label, view.bucketLabel, view.flag].filter(Boolean).join(" · ") + `\n${NOT_AFFILIATED}`;
  line.append(ringNode(view), el("span", "kind", scale === "match" ? "match" : "/10 area"));
  const strip = stripNode(view);
  if (strip) line.append(strip);
  if (view.flag) line.append(el("span", "flag", view.flag));
  line.append(el("span", "brand", "Close Knit"));
  root.replaceChildren(styleTag(), line);
}

/** The ring, then up to three rows; each row wraps inside the card's width, so nothing is cut. */
function rowsLine(view: BadgeView, chips: Chip[], compact: boolean): HTMLElement {
  const line = el("div", "line v3");
  const words = chips.map((chip) => (chip.kind === "price" && view.bucketLabel ? view.bucketLabel : chip.text));
  line.title = [view.label, ...words, ...[...view.pills, ...view.offer].map((pill) => `${pill.label} ${pill.value}`)].join(" · ")
    + `\n${NOT_AFFILIATED}`;
  const rows = el("div", "rows");
  const first = el("div", "row r1");
  for (const chip of chips) {
    const node = el("span", `chip ${chip.kind}`);
    node.dataset.band = String(chip.band ?? "none");
    const strip = chip.kind === "price" ? stripNode(view) : null;
    if (strip) node.append(strip);
    node.append(el("span", "text", chip.text));
    first.append(node);
  }
  first.append(el("span", "brand", "close knit"));
  rows.append(first);
  if (view.pills.length) rows.append(pillRow("row r2", compact ? view.pills.slice(0, COMPACT_PILLS) : view.pills));
  if (view.offer.length && !compact) {
    const offer = pillRow("row r3", view.offer);
    offer.prepend(el("span", "lead", "Before you offer"));
    rows.append(offer);
  }
  line.append(ringNode(view), rows);
  return line;
}

function pillRow(className: string, pills: Pill[]): HTMLElement {
  const row = el("div", className);
  for (const pill of pills) {
    const node = el("span", "chip pill");
    node.dataset.band = String(pill.band ?? "none");
    node.append(el("span", "label", pill.label), el("span", "text", pill.value));
    row.append(node);
  }
  return row;
}

function ringNode(view: BadgeView): HTMLElement {
  const ring = el("span", view.excluded ? "ring excluded" : "ring");
  ring.dataset.band = String(view.band ?? "none");
  ring.setAttribute("role", "img");
  ring.setAttribute("aria-label", view.label);
  // A missed limit draws the whole ring red; a score fills it by band.
  const fill = view.excluded ? 1 : view.band === null ? 0 : view.band / 5;
  const svg = svgNode("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  svg.append(svgNode("circle", { cx: "12", cy: "12", r: String(RING_RADIUS), class: "track" }),
    svgNode("circle", { cx: "12", cy: "12", r: String(RING_RADIUS), class: "arc",
      "stroke-dasharray": `${(fill * RING_LENGTH).toFixed(1)} ${RING_LENGTH.toFixed(1)}` }));
  ring.append(svg, el("span", "score", view.ring));
  return ring;
}

function stripNode(view: BadgeView): HTMLElement | null {
  if (view.bucket === null || !view.bucketLabel) return null;
  const strip = el("span", "strip");
  strip.setAttribute("role", "img");
  strip.setAttribute("aria-label", view.bucketLabel);
  for (let i = 0; i < 4; i++) strip.append(el("span", i === view.bucket ? "seg on" : "seg"));
  return strip;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgNode(tag: string, attributes: Record<string, string>): SVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function styleTag(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = BADGE_CSS;
  return style;
}

// Day tokens and the rating ramp of the site (web/src/styles/rating.css).
export const BADGE_CSS = `
:host { all: initial; display: block; margin: 6px 0 2px; }
.line {
  --ink: #22252c; --muted: #5b6270; --chip: #eef2f7; --wool: #dfe7f0;
  --bad: #c0352c; --good: #2f5bd3; --neutral: #6b7787;
  display: inline-flex; align-items: center; gap: 8px; max-width: 100%; box-sizing: border-box;
  padding: 3px 10px 3px 4px; border: 1px solid var(--wool); border-radius: 999px; background: #fff;
  font-family: "${FONT_FAMILY}", system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 12px; line-height: 1.2;
  color: var(--ink); white-space: nowrap; overflow: hidden; cursor: default;
}
.ring { --c: var(--muted); position: relative; width: 24px; height: 24px; flex: none; }
.ring[data-band="1"], .chip[data-band="1"] { --c: var(--bad); }
.ring[data-band="2"], .chip[data-band="2"] { --c: color-mix(in srgb, var(--bad) 55%, var(--neutral)); }
.ring[data-band="3"], .chip[data-band="3"] { --c: var(--neutral); }
.ring[data-band="4"], .chip[data-band="4"] { --c: color-mix(in srgb, var(--good) 55%, var(--neutral)); }
.ring[data-band="5"], .chip[data-band="5"] { --c: var(--good); }
.ring svg { width: 24px; height: 24px; transform: rotate(-90deg); }
.ring circle { fill: none; stroke-width: 3; }
.ring .track { stroke: var(--chip); }
.ring .arc { stroke: var(--c); stroke-linecap: round; }
.ring .score { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 700; font-size: 10px; }
.ring.excluded .score { color: var(--bad); }
.kind { color: var(--muted); }
.strip { display: inline-flex; gap: 2px; }
.seg { width: 9px; height: 7px; border-radius: 2px; background: #c9d2de; }
.seg.on { background: var(--good); }
.flag { padding: 1px 7px; border-radius: 999px; background: var(--chip); overflow: hidden; text-overflow: ellipsis; }
.brand { color: var(--muted); font-size: 11px; }
/* Three rows beside a 34 px ring; every row wraps inside the card (300-1000 px), no item is cut. */
.line.v3 { display: flex; align-items: flex-start; width: fit-content; gap: 8px; padding: 5px 10px 5px 5px;
  border-radius: 14px; white-space: normal; }
.v3 .ring, .v3 .ring svg { width: 34px; height: 34px; }
.v3 .ring .score { font-size: 12px; }
.rows { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding-top: 2px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.chip { --c: var(--neutral); display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px;
  border-radius: 999px; background: var(--chip); color: var(--ink); font-weight: 600; font-size: 11.5px;
  white-space: nowrap; flex: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.chip:not([data-band="none"]) { background: color-mix(in srgb, var(--c) 13%, #fff);
  color: color-mix(in srgb, var(--c) 80%, #000); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 35%, #fff); }
.chip.price, .chip.cost, .chip.days, .chip.trend { font-weight: 500; }
.pill .label { font-weight: 500; opacity: 0.75; }
.r3 .lead { color: var(--muted); font-size: 11px; margin-right: 2px; }
.v3 .brand { margin-left: 2px; }
/* In a map popup card: the card's own width, no pill outline of its own; hung under a fixed card, it closes it. */
:host([data-close-knit-map]) { margin: 0; }
.line.compact { display: flex; width: 100%; max-width: none; box-sizing: border-box; gap: 6px; padding: 6px 8px;
  border: 0; border-top: 1px solid var(--wool); border-radius: 0; }
:host([data-place="below"]) .line.compact { border: 1px solid var(--wool); border-top-color: var(--chip);
  border-radius: 0 0 12px 12px; box-shadow: 0 6px 14px rgba(34, 37, 44, 0.16); }
.compact .ring, .compact .ring svg { width: 28px; height: 28px; }
.compact .ring .score { font-size: 11px; }
.compact .rows { gap: 3px; padding-top: 1px; }
.compact .chip { height: 18px; padding: 0 6px; font-size: 11px; }
.compact .brand { font-size: 10.5px; }
`;
