import type { Card, CardBlock, PricePoint, Tone } from "../types";

export interface RenderOptions {
  logoUrl: string;
  /** Links must point at Close Knit; anything else in a card is dropped. */
  siteOrigin: string;
  collapsed: boolean;
  /** Minimise and reopen; without it (the side panel) the card is always open and has no minimise button. */
  onToggle?(collapsed: boolean): void;
  /** Draws the summary block after the header (the side panel); without it the block is skipped. */
  summary?(block: Block<"summary">): El | null;
}

/** Every panel says it (2026-10-18-extension-legal-strategy.md §1). */
export const NOT_AFFILIATED = "Close Knit is independent and not affiliated with this site.";

type El = HTMLElement;
type Block<T extends string> = Extract<CardBlock, { type: T }>;
type H = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];

/** With the "everything" panel (sections) these blocks would repeat it, so the panel replaces them. */
const COVERED_BY_SECTIONS = new Set(["facts", "costs", "price"]);
const PER_SQM_WORDS: Record<string, string> = {
  "in-line": "in line with", "10-25-above": "10–25% above", "over-25-above": "over 25% above",
  "10-25-below": "10–25% below", "over-25-below": "over 25% below",
};
/** Reading order in the card; blocks not listed keep the server's order after these. */
const ORDER = ["header", "summary", "match", "cta", "pricePosition", "priceStory", "flags", "home", "facts", "price", "costs", "sections"];

export interface Arranged {
  main: CardBlock[];
  tail: CardBlock[];
}

/**
 * Everything shows at once (owner, 2026-10-18: no "More"): blocks in reading order, then what stays at the
 * bottom (actions and anything after them). The old price line gives way to the price position strip, and the
 * "everything" panel (sections, one column) replaces the facts and costs it repeats.
 */
export function arrangeBlocks(blocks: CardBlock[]): Arranged {
  const position = blocks.some((b) => b.type === "pricePosition");
  const sections = blocks.some((b) => b.type === "sections");
  const actionsAt = blocks.findIndex((b) => b.type === "actions");
  const body = (actionsAt >= 0 ? blocks.slice(0, actionsAt) : blocks)
    .filter((b) => !(sections && COVERED_BY_SECTIONS.has(b.type)) && !(b.type === "price" && position));
  const rank = (b: CardBlock) => { const i = ORDER.indexOf(b.type); return i < 0 ? ORDER.length : i; };
  return { main: [...body].sort((x, y) => rank(x) - rank(y)), tail: actionsAt >= 0 ? blocks.slice(actionsAt) : [] };
}

/** Draws a listing-card.v1 card. Block types it does not know are skipped, so the server can add new ones. */
export function renderCard(root: ShadowRoot | El, card: Card, options: RenderOptions): void {
  const doc = root.ownerDocument ?? document;
  const h: H = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const link = (href: unknown, className: string, text: string): El => {
    const safe = safeHref(href, options.siteOrigin);
    if (!safe) return h("span", className, text);
    const a = h("a", className, text);
    a.href = safe;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  };

  const shell = h("div", "ck");
  shell.setAttribute("data-testid", "close-knit-card");
  const header = card.blocks.find((b): b is Block<"header"> => b.type === "header");

  if (options.collapsed && options.onToggle) {
    const toggle = options.onToggle;
    const pill = h("button", "pill");
    pill.type = "button";
    pill.setAttribute("aria-expanded", "false");
    pill.append(logo(h, options.logoUrl), h("span", undefined, `close knit · ${header?.title ?? "area facts"}`));
    pill.title = NOT_AFFILIATED;
    pill.addEventListener("click", () => toggle(false));
    shell.append(pill);
    replace(root, shell);
    return;
  }

  const body = h("section", "card");
  body.setAttribute("aria-label", "Close Knit area facts");
  const brand = h("div", "brand");
  brand.append(logo(h, options.logoUrl), h("span", "wordmark", "close knit"), h("span", "spacer"));
  if (options.onToggle) {
    const toggle = options.onToggle;
    const close = h("button", "icon-button", "–");
    close.type = "button";
    close.setAttribute("aria-label", "Minimise Close Knit");
    close.addEventListener("click", () => toggle(true));
    brand.append(close);
  }
  body.append(brand);

  const draw = (block: CardBlock): El | null =>
    block.type === "summary" ? options.summary?.(block as Block<"summary">) ?? null : drawBlock(block, h, link);
  const { main, tail } = arrangeBlocks(card.blocks);
  for (const block of main) appendIf(body, draw(block));
  for (const block of tail) appendIf(body, draw(block));
  body.append(h("div", "footnote not-affiliated", NOT_AFFILIATED));
  shell.append(body);
  replace(root, shell);
}

function drawBlock(block: CardBlock, h: H, link: (href: unknown, className: string, text: string) => El): El | null {
  switch (block.type) {
    case "header": {
      const b = block as Block<"header">;
      const wrap = h("div");
      wrap.append(link(b.href, "title", b.title));
      if (b.subtitle) wrap.append(h("div", "subtitle", b.subtitle));
      return wrap;
    }
    case "cta": {
      const b = block as Block<"cta">;
      const wrap = h("div", "cta");
      wrap.append(h("p", undefined, b.text), link(b.href, "button primary", b.label));
      return wrap;
    }
    case "match": {
      const b = block as Block<"match">;
      const wrap = h("div", "match");
      const score = h("div", "score");
      if (b.excluded || b.score === null) score.append(h("strong", undefined, "Misses your limits"));
      else score.append(h("strong", undefined, String(b.score)), h("span", undefined, "/ 100 for your search"));
      wrap.append(score);
      if (b.rankText && !b.excluded) wrap.append(h("div", "muted", b.rankText));
      const chips = h("div", "chips");
      for (const pro of b.pros) chips.append(h("span", "chip good", `✓ ${pro}`));
      for (const con of b.cons) chips.append(h("span", "chip bad", `✕ ${con}`));
      if (chips.childElementCount) wrap.append(chips);
      return wrap;
    }
    case "facts": {
      const b = block as Block<"facts">;
      return rows(h, "facts", b.rows);
    }
    case "price": {
      const b = block as Block<"price">;
      const wrap = h("div", "price");
      wrap.append(h("div", undefined, b.text));
      if (b.detail) wrap.append(h("div", "detail", b.detail));
      return wrap;
    }
    case "pricePosition":
      return pricePosition(block as Block<"pricePosition">, h);
    case "flags": {
      const b = block as Block<"flags">;
      const list = h("ul", "flags");
      for (const item of b.items ?? []) {
        const row = h("li", "flag");
        row.append(h("span", `dot ${tone(item.tone)}`), h("span", undefined, item.text));
        list.append(row);
      }
      return list.childElementCount ? list : null;
    }
    case "priceStory": {
      // One line in view, as Area360 shows it: days on the market and the change since the first known price.
      const b = block as Block<"priceStory">;
      const wrap = h("div", "story");
      const line = h("div", "story-line");
      if (b.daysOnMarket !== undefined && b.daysOnMarket !== null) {
        line.append(h("strong", undefined, `${b.daysOnMarket} days`), h("span", "muted", " on the market"));
      }
      const change = priceChange(b);
      if (change) {
        const down = change.amount < 0;
        line.append(h("span", "muted", " · "),
          h("strong", down ? "down" : "up", `${down ? "↓" : "↑"} ${money(Math.abs(change.amount))} (${change.percent}%)`),
          h("span", "muted", ` since ${change.since}`));
      } else if (line.childElementCount) line.append(h("span", "muted", " · no price change seen"));
      if (line.childElementCount) wrap.append(line);
      const changes = b.changes ?? [];
      if (changes.length > 1) {
        const list = h("ul", "changes");
        for (const point of changes) {
          const row = h("li");
          row.append(h("span", "muted", point.date), h("span", undefined, money(point.price)));
          list.append(row);
        }
        wrap.append(list);
      }
      return wrap.childElementCount ? wrap : null;
    }
    case "costs": {
      const b = block as Block<"costs">;
      const wrap = h("div", "costs");
      const total = h("div", "costs-total");
      total.append(h("strong", undefined, money(b.monthly)), h("span", "muted", "a month"));
      wrap.append(h("div", "heading", "Costs"), total);
      const line = (parts: { label: string; amount: number }[]) =>
        parts.map((part) => `${part.label.toLowerCase()} ${money(part.amount)}`).join(" · ");
      if (b.parts?.length) wrap.append(h("div", undefined, line(b.parts)));
      if (b.upfront?.length) wrap.append(h("div", undefined, `Upfront: ${line(b.upfront)}`));
      const a = b.assumptions;
      if (a) {
        const who = [a.firstTime ? "first-time buyer" : null, a.additionalHome ? "additional home" : null].filter(Boolean);
        wrap.append(h("div", "muted", [`${a.depositPct}% deposit`, `${a.ratePct}% over ${a.years} years`, ...who].join(" · ")));
      }
      return wrap;
    }
    case "sections": {
      const b = block as Block<"sections">;
      const wrap = h("div", "sections");
      for (const column of b.columns ?? []) {
        const section = h("div", "section");
        section.append(h("div", "heading", column.title), rows(h, "facts", column.rows ?? []));
        wrap.append(section);
      }
      return wrap.childElementCount ? wrap : null;
    }
    case "home": {
      // Behind server flags (address match, home value): drawn only when the server sends it.
      const b = block as Block<"home">;
      const wrap = h("div", "home");
      wrap.append(h("div", "heading", "This home"));
      if (b.address) wrap.append(h("div", "home-address", b.address));
      const facts: { label: string; value: string }[] = [{ label: "Match", value: b.confidence }];
      if (typeof b.epc === "string") facts.push({ label: "EPC", value: b.epc });
      else if (b.epc) {
        const epc = [b.epc.rating, b.epc.floorAreaSqm ? `${b.epc.floorAreaSqm} m²` : null, b.epc.date?.slice(0, 4)].filter(Boolean);
        if (epc.length) facts.push({ label: "EPC", value: epc.join(" · ") });
      }
      if (b.value) facts.push({ label: "Range", value: `${shortMoney(b.value.low)}–${shortMoney(b.value.high)}` });
      for (const sale of b.sales ?? []) facts.push({ label: sale.date.slice(0, 7), value: `Sold ${money(sale.price)}` });
      wrap.append(rows(h, "facts", facts));
      if (b.value?.method) wrap.append(h("div", "muted", b.value.method));
      return wrap;
    }
    case "actions": {
      const b = block as Block<"actions">;
      const wrap = h("div", "actions");
      for (const item of b.items) wrap.append(link(item.href, item.primary ? "button primary" : "button", item.label));
      return wrap;
    }
    case "footnote": {
      const b = block as Block<"footnote">;
      const wrap = h("div", "footnote", b.text);
      if (b.href && b.label) wrap.append(link(b.href, "", b.label));
      return wrap;
    }
    default:
      return null;
  }
}

/** One strip of four equal parts (below, lower middle, upper middle, above) with a marker in the asking price's part. */
function pricePosition(b: Block<"pricePosition">, h: H): El {
  const wrap = h("div", "position");
  wrap.append(h("div", "position-label", b.label));
  const strip = h("div", "strip");
  strip.setAttribute("role", "img");
  strip.setAttribute("aria-label", b.label);
  for (let part = 0; part < 4; part += 1) {
    const segment = h("span", part === 1 || part === 2 ? "segment middle" : "segment");
    if (part === b.bucket) {
      segment.className += " on";
      segment.append(h("span", "marker"));
    }
    strip.append(segment);
  }
  const ticks = h("div", "ticks");
  ticks.append(h("span", "tick t1", shortMoney(b.q1)), h("span", "tick t2", shortMoney(b.median)),
    h("span", "tick t3", shortMoney(b.q3)));
  wrap.append(strip, ticks);
  const notes = [`${b.sales} ${b.homeType} sales in 12 months`];
  if (b.perSqm) {
    const words = PER_SQM_WORDS[b.perSqm.band];
    notes.push(words ? `${money(b.perSqm.asking)}/m² asking, ${words} the area's ${money(b.perSqm.area)}/m²` :
      `${money(b.perSqm.asking)}/m² asking`);
  }
  wrap.append(h("div", "muted", notes.join(" · ")));
  return wrap;
}

/** The change from the first known price (the page's history or this device's first sight) to the latest. */
export function priceChange(b: Block<"priceStory">): { amount: number; percent: number; since: string } | null {
  const changes = b.changes ?? [];
  const latest = changes.length ? changes[changes.length - 1] : null;
  const first = [changes[0], b.firstSeen].filter((p): p is PricePoint => Boolean(p)).sort((x, y) => x.date.localeCompare(y.date))[0];
  if (!latest || !first || first.price === latest.price || first.date >= latest.date) return null;
  const amount = latest.price - first.price;
  const since = first === b.firstSeen && first !== changes[0] ? "you first saw it" : shortDate(first.date);
  return { amount, percent: Math.round((amount / first.price) * 1000) / 10, since };
}

function shortDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
  return name ? `${day} ${name} ${year}` : iso;
}

function rows(h: H, className: string, items: { label: string; value: string; tone?: Tone | string }[]): El {
  const list = h("ul", className);
  for (const row of items) {
    const item = h("li", "fact");
    // Only a good or bad row gets a coloured dot; a neutral one keeps the column empty.
    item.append(h("span", `dot ${row.tone === "good" || row.tone === "bad" ? row.tone : "none"}`), h("span", "label", row.label),
      h("span", undefined, row.value));
    list.append(item);
  }
  return list;
}

export function money(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

/** £450k, £1.25m: the strip's tick labels. */
export function shortMoney(value: number): string {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}m`;
  return `£${Math.round(value / 1000)}k`;
}

export function safeHref(href: unknown, siteOrigin: string): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    return url.origin === new URL(siteOrigin).origin ? url.href : null;
  } catch {
    return null;
  }
}

function appendIf(parent: El, node: El | null): void {
  if (node) parent.append(node);
}

function tone(value: Tone | string): string {
  return value === "good" || value === "bad" ? value : "neutral";
}

function logo(h: (tag: "img", className?: string) => HTMLImageElement, url: string): HTMLImageElement {
  const img = h("img");
  img.src = url;
  img.alt = "";
  img.width = 26;
  img.height = 26;
  return img;
}

function replace(root: ShadowRoot | El, node: El): void {
  const style = root.querySelector("style");
  root.replaceChildren(...(style ? [style] : []), node);
}
