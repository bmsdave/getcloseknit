import assert from "node:assert/strict";
import test from "node:test";

import { arrangeBlocks, priceChange, renderCard, safeHref, shortMoney } from "../src/render/card";
import type { Card, CardBlock } from "../src/types";

const SITE = "https://getcloseknit.com";

/** Just enough DOM for the renderer: elements with classes, text, attributes, children and click listeners. */
class FakeElement {
  children: FakeElement[] = [];
  className = "";
  hidden = false;
  attributes: Record<string, string> = {};
  listeners: (() => void)[] = [];
  [prop: string]: unknown;
  private text = "";

  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument | null = null) {}
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  get childElementCount(): number {
    return this.children.length;
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children = nodes;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }
  click(): void {
    this.listeners.forEach((listener) => listener());
  }
  querySelector(): null {
    return null;
  }
  findAll(className: string): FakeElement[] {
    const own = this.className.split(" ").includes(className) ? [this] : [];
    return [...own, ...this.children.flatMap((child) => child.findAll(className))];
  }
  find(className: string): FakeElement {
    const found = this.findAll(className)[0];
    assert.ok(found, `no .${className}`);
    return found;
  }
}

class FakeDocument {
  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }
}

function draw(blocks: CardBlock[]): FakeElement {
  const root = new FakeElement("div", new FakeDocument());
  const card: Card = { v: 1, status: "ok", blocks };
  renderCard(root as unknown as HTMLElement, card, { logoUrl: "logo.svg", siteOrigin: SITE, collapsed: false, onToggle() {} });
  return root;
}

const HEADER: CardBlock = { type: "header", title: "De Beauvoir · E8", href: `${SITE}/area/lsoa/E1` };
const CTA: CardBlock = { type: "cta", text: "See how this area fits", label: "Personalise", href: `${SITE}/` };
const FACTS: CardBlock = { type: "facts", rows: [{ label: "Crime", value: "Higher than most of London", tone: "bad" }] };
const PRICE: CardBlock = { type: "price", verdict: "in-line", text: "The asking price is in line with recent sales." };
const POSITION: CardBlock = {
  type: "pricePosition", homeType: "flat", bucket: 2, label: "Upper middle of flat sales here", sales: 12,
  q1: 450000, median: 520000, q3: 610000, perSqm: { asking: 10000, area: 8000, band: "10-25-above" },
};
const FLAGS: CardBlock = { type: "flags", items: [
  { text: "Lease has 72 years left", tone: "bad" }, { text: "Inside the ULEZ", tone: "neutral" }] };
const STORY: CardBlock = { type: "priceStory", changes: [{ date: "2026-10-10", price: 575000 }], text: "On the market 30 days." };
const COSTS: CardBlock = {
  type: "costs", monthly: 3107, parts: [{ label: "Mortgage", amount: 2736 }], upfront: [{ label: "Stamp duty", amount: 20000 }],
  assumptions: { depositPct: 10, ratePct: 4.5, years: 30, firstTime: false, additionalHome: false }, chips: ["Inside ULEZ"],
};
const SECTIONS: CardBlock = { type: "sections", columns: [
  { title: "This home", rows: [{ label: "Type", value: "Flat" }] },
  { title: "Before you offer", rows: [{ label: "Ask", value: "Service charge" }] }] };
const ACTIONS: CardBlock = { type: "actions", items: [
  { kind: "save", label: "Save to Close Knit", href: `${SITE}/save-listing`, primary: false },
  { kind: "link", label: "Elsewhere", href: "https://evil.example/" }] };
const FOOTNOTE: CardBlock = { type: "footnote", text: "Not a valuation." };
const FULL = [HEADER, CTA, POSITION, FLAGS, FACTS, PRICE, STORY, COSTS, SECTIONS, ACTIONS, FOOTNOTE];

test("only Close Knit links are kept in a card", () => {
  assert.equal(safeHref("https://getcloseknit.com/area/lsoa/E1?utm_source=extension", "https://getcloseknit.com"),
    "https://getcloseknit.com/area/lsoa/E1?utm_source=extension");
  assert.equal(safeHref("https://evil.example/", "https://getcloseknit.com"), null);
  assert.equal(safeHref("javascript:alert(1)", "https://getcloseknit.com"), null);
  assert.equal(safeHref(42, "https://getcloseknit.com"), null);
});

test("everything shows at once, in reading order, with no More toggle", () => {
  const { main, tail } = arrangeBlocks(FULL);

  assert.deepEqual(main.map((b) => b.type), ["header", "cta", "pricePosition", "priceStory", "flags", "sections"]);
  assert.equal((main[4] as Extract<CardBlock, { type: "flags" }>).items.length, 2);
  assert.deepEqual(tail.map((b) => b.type), ["actions", "footnote"]);
  const root = draw(FULL);
  assert.equal(root.findAll("more-toggle").length, 0);
  assert.match(root.textContent, /Before you offer/);
  assert.equal(arrangeBlocks(FULL.filter((b) => b.type !== "sections")).main.map((b) => b.type).includes("costs"), true);
});

test("the price story line shows days on the market and the change since the first known price", () => {
  const story = { type: "priceStory", daysOnMarket: 41, text: "",
    changes: [{ date: "2026-09-07", price: 1150000 }, { date: "2026-10-12", price: 1100000 }] } as Extract<CardBlock, { type: "priceStory" }>;
  assert.deepEqual(priceChange(story), { amount: -50000, percent: -4.3, since: "7 Sep 2026" });
  const seen = { ...story, changes: [{ date: "2026-10-12", price: 1100000 }], firstSeen: { date: "2026-10-03", price: 1150000 } };
  assert.equal(priceChange(seen)?.since, "you first saw it");
  assert.equal(priceChange({ ...story, changes: [{ date: "2026-10-12", price: 1100000 }] }), null);
  const root = draw([HEADER, story, ACTIONS]);
  assert.match(root.find("story-line").textContent, /41 days on the market · ↓ £50,000 \(-4.3%\) since 7 Sep 2026/);
});

test("an old card keeps its facts and price line", () => {
  const blocks = [HEADER, CTA, FACTS, PRICE, ACTIONS, FOOTNOTE];
  assert.deepEqual(arrangeBlocks(blocks).main.map((b) => b.type), ["header", "cta", "facts", "price"]);

  const root = draw(blocks);
  assert.equal(root.findAll("more-toggle").length, 0);
  assert.match(root.textContent, /in line with recent sales/);
});

test("the price position is one four-part strip with a marker in the asking price's part", () => {
  const root = draw(FULL);
  const segments = root.find("strip").children;

  assert.equal(segments.length, 4);
  assert.deepEqual(segments.map((s) => s.className.includes("on")), [false, false, true, false]);
  assert.equal(segments[2].findAll("marker").length, 1);
  assert.deepEqual(root.findAll("tick").map((t) => t.textContent), ["£450k", "£520k", "£610k"]);
  assert.match(root.find("position").textContent, /£10,000\/m² asking, 10–25% above the area's £8,000\/m²/);
});

test("unknown blocks are skipped and outside links are not links", () => {
  const root = draw([HEADER, { type: "hologram", text: "nope" }, ACTIONS]);

  assert.doesNotMatch(root.textContent, /nope/);
  const buttons = root.findAll("button");
  assert.equal(buttons.find((b) => b.textContent === "Elsewhere")?.tagName, "span");
  assert.equal(buttons.find((b) => b.textContent === "Save to Close Knit")?.tagName, "a");
});

test("tick labels are short", () => {
  assert.deepEqual([shortMoney(450000), shortMoney(1_000_000), shortMoney(1_250_000)], ["£450k", "£1m", "£1.25m"]);
});
