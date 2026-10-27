// Trimmed pages in each portal's real layout (seen on 2026-10-18), with made-up listing text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseHTML } from "linkedom";

import { findAnchor, placeAfter, priceLeaf, type Portal } from "../src/content/anchors";

function page(name: string): Document {
  return parseHTML(readFileSync(new URL(`./fixtures/pages/${name}.html`, import.meta.url), "utf8")).document as unknown as Document;
}

const EXPECTED: Record<Portal, (anchor: Element) => void> = {
  rightmove: (a) => {
    assert.equal(a.tagName, "ARTICLE");
    assert.ok(a.querySelector('[data-testid="primaryPrice"]'));
  },
  zoopla: (a) => assert.match(a.className, /Price_priceWrapper/),
  onthemarket: (a) => assert.ok(a.querySelector('[data-test="property-price"]')),
  spareroom: (a) => assert.match(a.className, /feature--price_room_only/),
  openrent: (a) => assert.ok(a.querySelector("h1")),
};

for (const [portal, check] of Object.entries(EXPECTED) as [Portal, (anchor: Element) => void][]) {
  test(`${portal}: the panel goes right under the price`, () => {
    const doc = page(portal);
    const anchor = findAnchor(doc, portal);
    assert.ok(anchor, "no anchor");
    check(anchor);
    const host = doc.createElement("div");
    host.id = "close-knit-inline";
    placeAfter(anchor, host);
    placeAfter(anchor, host);
    assert.equal(anchor.nextElementSibling, host);
    assert.equal(doc.querySelectorAll("#close-knit-inline").length, 1);
  });
}

test("a page without the portal's price layout has no anchor, so only the side card shows", () => {
  const { document } = parseHTML("<html><body><h1>Search results</h1></body></html>");
  for (const portal of Object.keys(EXPECTED) as Portal[]) {
    assert.equal(findAnchor(document as unknown as Document, portal), null, portal);
  }
});

test("zoopla falls back to the price text in the listing details", () => {
  const { document } = parseHTML(
    '<div aria-label="Listing details"><section><div class="x"><p>£1,400,000</p><button>See monthly cost</button></div></section></div>');
  assert.equal(findAnchor(document as unknown as Document, "zoopla")?.className, "x");
});

test("a price leaf is an element holding only a price", () => {
  const { document } = parseHTML("<div><p>Guide £600,000 or offers</p><span>£2,150 pcm</span></div>");
  assert.equal(priceLeaf(document as unknown as Document)?.textContent, "£2,150 pcm");
});
