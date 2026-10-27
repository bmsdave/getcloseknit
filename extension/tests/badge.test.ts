import assert from "node:assert/strict";
import test from "node:test";

import type { Badge } from "../src/adapters/results/types";
import { BADGE_CSS, badgeView, renderBadge } from "../src/content/badge";

/** Just enough DOM for the line: elements with classes, text, attributes, dataset and children. */
class FakeNode {
  children: FakeNode[] = [];
  className = "";
  title = "";
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  private text = "";

  constructor(readonly tagName: string) {}
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }
  prepend(...nodes: FakeNode[]): void {
    this.children.unshift(...nodes);
  }
  replaceChildren(...nodes: FakeNode[]): void {
    this.children = nodes;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  all(className: string): FakeNode[] {
    const own = this.className.split(" ").includes(className) ? [this] : [];
    return [...own, ...this.children.flatMap((child) => child.all(className))];
  }
}

function render(badge: Badge, scale: "match" | "area" = "area", compact = false): FakeNode {
  const view = badgeView(badge, scale);
  assert.ok(view);
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_: string, tag: string) => new FakeNode(tag),
  };
  const root = new FakeNode("#shadow-root");
  renderBadge(root as unknown as ShadowRoot, view, scale, { compact });
  return root;
}

const CHIPS: Badge["chips"] = [
  { text: "KX 27′", band: 4, kind: "commute" },
  { text: "Gym 10′", band: null, kind: "commute" },
  { text: "upper middle", band: null, kind: "price" },
  { text: "£5.7k/mo", band: null, kind: "cost" },
  { text: "12d on market", band: null, kind: "days" },
  { text: "+9.6% 1y", band: null, kind: "trend" },
];
const PILLS: Badge["pills"] = [
  { label: "Safety", value: "8/10", band: 4 },
  { label: "Schools", value: "1 Out · 9 Good", band: 5 },
  { label: "Station", value: "9′ West Hampstead TL", band: 4 },
  { label: "Social housing", value: "21%", band: null },
];
const OFFER: Badge["offer"] = [
  { label: "Flood", value: "surface high", band: 1 },
  { label: "Listed", value: "3", band: null },
];
const BADGE: Badge = { listingId: "1", score: 82, band: 5, excluded: false, bucket: 2, flag: "Noisier", chips: CHIPS,
  pills: PILLS, offer: OFFER };

const texts = (row: FakeNode) => row.all("chip").map((chip) => [chip.className, chip.dataset.band, chip.textContent]);

test("three rows beside the ring: Close Knit's own facts, the area's pills, before you offer", () => {
  const root = render(BADGE, "match");
  const line = root.all("line")[0];
  const [first, second, third] = root.all("row");

  assert.ok(line.className.includes("v3"));
  assert.equal(line.children[0].className, "ring");
  assert.equal(line.children[0].dataset.band, "5");
  assert.equal(line.children[0].attributes["aria-label"], "82/100 for your search");
  assert.deepEqual(texts(first), [
    ["chip commute", "4", "KX 27′"], ["chip commute", "none", "Gym 10′"], ["chip price", "none", "upper middle"],
    ["chip cost", "none", "£5.7k/mo"], ["chip days", "none", "12d on market"], ["chip trend", "none", "+9.6% 1y"]]);
  assert.equal(first.children.at(-1)?.textContent, "close knit");
  assert.deepEqual(texts(second), [
    ["chip pill", "4", "Safety8/10"], ["chip pill", "5", "Schools1 Out · 9 Good"],
    ["chip pill", "4", "Station9′ West Hampstead TL"], ["chip pill", "none", "Social housing21%"]]);
  assert.equal(second.all("label")[2].textContent, "Station");
  assert.equal(third.children[0].textContent, "Before you offer");
  assert.deepEqual(texts(third), [["chip pill", "1", "Floodsurface high"], ["chip pill", "none", "Listed3"]]);
  assert.match(line.title, /^82\/100 for your search · KX 27′ · Gym 10′ · Asking price in the upper half/);
  assert.match(line.title, /Station 9′ West Hampstead TL · Social housing 21% · Flood surface high · Listed 3\nClose Knit is independent and not affiliated with this site\.$/);
});

test("compact (a map popup card): rows 1-2, at most six pills, everything still in the tooltip", () => {
  const many = [...PILLS!, ...PILLS!.map((pill) => ({ ...pill, label: `${pill.label} 2` }))];
  const root = render({ ...BADGE, pills: many }, "match", true);
  const line = root.all("line")[0];
  const rows = root.all("row");
  assert.ok(line.className.includes("v3") && line.className.includes("compact"));
  assert.equal(rows.length, 2);
  assert.equal(texts(rows[0]).length, CHIPS!.length);
  assert.equal(texts(rows[1]).length, 6);
  assert.match(line.title, /Social housing 2 21% · Flood surface high · Listed 3\n/);
  assert.match(BADGE_CSS, /:host\(\[data-place="below"\]\) \.line\.compact/);
});

test("the price chip carries the 4-segment strip with this home's segment on", () => {
  const price = render(BADGE).all("price")[0];
  assert.deepEqual(price.all("seg").map((seg) => seg.className), ["seg", "seg", "seg on", "seg"]);
  assert.equal(price.all("strip")[0].attributes["aria-label"], "Asking price in the upper half of local sales of this type");
});

test("a missed limit: a red ✕ ring, the misses lead row 1", () => {
  const chips: Badge["chips"] = [{ text: "School too far", band: 1, kind: "miss" }, ...CHIPS!];
  const root = render({ ...BADGE, score: null, band: null, excluded: true, chips }, "match");
  const ring = root.all("ring")[0];

  assert.deepEqual([ring.className, ring.dataset.band, ring.all("score")[0].textContent], ["ring excluded", "1", "✕"]);
  assert.deepEqual(texts(root.all("row")[0])[0], ["chip miss", "1", "School too far"]);
  assert.match(BADGE_CSS, /\.ring\.excluded \.score \{ color: var\(--bad\); \}/);
});

test("an API without pills draws row 1 alone; empty rows are left out", () => {
  const root = render({ ...BADGE, pills: undefined, offer: [] });

  assert.equal(root.all("row").length, 1);
  assert.equal(root.all("chip").length, CHIPS!.length);
  assert.equal(render({ ...BADGE, offer: undefined }).all("row").length, 2);
});

test("a 34 px ring and rows that wrap inside the card, never cut", () => {
  assert.match(BADGE_CSS, /\.v3 \.ring, \.v3 \.ring svg \{ width: 34px; height: 34px; \}/);
  assert.match(BADGE_CSS, /\.row \{[^}]*flex-wrap: wrap/);
  assert.match(BADGE_CSS, /\.rows \{[^}]*min-width: 0/);
  assert.doesNotMatch(BADGE_CSS, /max-height/);
  for (const band of [1, 2, 3, 4, 5]) assert.match(BADGE_CSS, new RegExp(`\\.chip\\[data-band="${band}"\\]`));
});

test("without chips the older line is drawn", () => {
  const root = render({ ...BADGE, chips: undefined });
  const line = root.all("line")[0];

  assert.ok(!line.className.includes("v3"));
  assert.equal(root.all("chip").length, 0);
  assert.equal(root.all("flag")[0].textContent, "Noisier");
  assert.equal(line.children.at(-1)?.textContent, "Close Knit");
});

test("chips alone are enough for a line; an empty chip list with nothing else is not", () => {
  const onlyChips: Badge = { listingId: "1", score: null, band: null, excluded: false, bucket: null,
    chips: [{ text: "+2.1% 1y", band: null, kind: "trend" }] };
  assert.equal(badgeView(onlyChips, "area")?.ring, "?");
  assert.equal(badgeView({ ...onlyChips, chips: [] }, "area"), null);
  assert.equal(badgeView({ ...onlyChips, chips: [], pills: PILLS }, "area")?.pills.length, PILLS!.length);
  assert.deepEqual(badgeView({ ...onlyChips, pills: [{ label: "Safety", value: "", band: 4 }] }, "area")?.pills, []);
});

test("the line has no links", () => {
  assert.equal(JSON.stringify(render(BADGE)).includes("href"), false);
});
