import assert from "node:assert/strict";
import test from "node:test";

import { parseHTML } from "linkedom";

import { NOT_AFFILIATED, renderCard } from "../src/render/card";
import { renderSummary, saveHref, summaryOf, summaryPanel } from "../src/render/summary";
import type { Card, CardBlock } from "../src/types";

const SITE = "https://getcloseknit.com";

const SUMMARY: CardBlock = {
  type: "summary",
  groups: [
    { title: "For your search", only: true, rows: [{ label: "Fit", value: "Misses 2 of your limits", tone: "bad" },
      { label: "King's Cross", value: "27 min · you said 80 ✓", tone: "good" }] },
    { title: "The price", only: true, rows: [{ label: "Vs sales", value: "Upper middle of 12 flat sales", tone: "neutral" }] },
    { title: "The money", only: false, rows: [{ label: "A month", value: "£2,745 all in", tone: "neutral" }] },
    { title: "Before you offer", only: true, rows: [{ label: "Planning", value: "40 in 2 years · London 25", tone: "neutral" }] },
  ],
  pills: [{ label: "Safety", value: "2/10", band: 1 }, { label: "Station", value: "4 min", band: 5 },
    { label: "Gigabit", value: "87%", band: null }],
};
const SAVE_HREF = `${SITE}/save-listing?utm_source=extension#listing=v1.x`;
const ACTIONS: CardBlock = { type: "actions", items: [
  { kind: "save", label: "Save to Close Knit", href: SAVE_HREF },
  { kind: "link", label: "Open area", href: `${SITE}/area` }] };

function card(blocks: CardBlock[], status: Card["status"] = "ok"): Card {
  return { v: 1, status, blocks };
}

function draw(c: Card, onOpenCard = () => {}) {
  const { document } = parseHTML("<html><body><div id='root'><style></style></div></body></html>");
  const root = document.getElementById("root") as unknown as HTMLElement;
  const drawn = renderSummary(root, c, { logoUrl: "logo.svg", siteOrigin: SITE, onOpenCard });
  return { drawn, root };
}

test("four groups in a grid, each marked when only Close Knit has it", () => {
  const { drawn, root } = draw(card([SUMMARY, ACTIONS]));
  assert.ok(drawn);
  const groups = [...root.querySelectorAll(".cks-group")];
  assert.deepEqual(groups.map((g) => g.querySelector(".cks-title")?.textContent),
    ["For your search", "The price", "The money", "Before you offer"]);
  assert.deepEqual(groups.map((g) => Boolean(g.querySelector(".cks-only"))), [true, true, false, true]);
  assert.equal(root.querySelector(".cks-row .cks-dot")?.className, "cks-dot bad");
  assert.ok(root.querySelector("style"), "the shadow root keeps its styles");
});

test("pills are coloured by band, with no colour when there is no band", () => {
  const { root } = draw(card([SUMMARY, ACTIONS]));
  assert.deepEqual([...root.querySelectorAll(".cks-pill")].map((p) => [p.className, p.textContent]),
    [["cks-pill b1", "Safety2/10"], ["cks-pill b5", "Station4 min"], ["cks-pill b0", "Gigabit87%"]]);
});

test("the footer opens the full card and saves through Close Knit only", () => {
  let opened = 0;
  const { root } = draw(card([SUMMARY, ACTIONS]), () => { opened += 1; });
  const button = root.querySelector(".cks-foot button") as HTMLButtonElement;
  assert.equal(button.textContent, "Full card ›");
  button.click();
  assert.equal(opened, 1);
  assert.equal((root.querySelector(".cks-foot a") as HTMLAnchorElement).getAttribute("href"), SAVE_HREF);
  const outside: CardBlock = { type: "actions", items: [{ kind: "save", label: "Save", href: "https://evil.example/" }] };
  assert.equal(saveHref(card([SUMMARY, outside]), SITE), null);
});

test("an older card or an error has no summary, and nothing is drawn", () => {
  assert.equal(summaryOf(card([ACTIONS])), null);
  assert.equal(summaryOf(card([SUMMARY], "error")), null);
  assert.equal(draw(card([ACTIONS])).drawn, false);
  assert.equal(draw(card([{ type: "summary", groups: [], pills: [] }])).drawn, false);
});

test("every panel says Close Knit is not affiliated; the side panel card has the summary and no minimise", () => {
  const { root } = draw(card([SUMMARY, ACTIONS]));
  assert.equal(root.querySelector(".cks-note")?.textContent, NOT_AFFILIATED);
  const { document } = parseHTML("<html><body><div id='panel'><style></style></div></body></html>");
  const panel = document.getElementById("panel") as unknown as HTMLElement;
  renderCard(panel, card([{ type: "header", title: "Kilburn" }, SUMMARY, ACTIONS]), { logoUrl: "logo.svg", siteOrigin: SITE,
    collapsed: true, summary: (block) => summaryPanel(document as unknown as Document, block) });
  assert.equal(panel.querySelector(".icon-button"), null);
  assert.equal(panel.querySelector(".pill"), null);
  const order = [...panel.querySelector(".card")!.children].map((n) => n.className);
  assert.deepEqual(order.slice(1, 3), ["", "cks"]);
  assert.equal(panel.querySelector(".not-affiliated")?.textContent, NOT_AFFILIATED);
  // No links to anywhere but Close Knit.
  for (const a of panel.querySelectorAll("a")) assert.ok((a as HTMLAnchorElement).href.startsWith(SITE));
});
