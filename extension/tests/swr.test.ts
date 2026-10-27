import assert from "node:assert/strict";
import test from "node:test";

import { parseHTML } from "linkedom";

import { renderSummary } from "../src/render/summary";
import { CardMemory, KEEP_MS, areaOnly, cellOf, skeletonCard } from "../src/swr";
import type { Card, ListingFacts } from "../src/types";

const FACTS: ListingFacts = {
  portal: "rightmove", listingId: "1", url: "https://www.rightmove.co.uk/properties/1", address: null,
  lat: 51.5308, lng: -0.1238, postcode: null, market: "buy", askingPrice: 650000, bedrooms: 2, floorAreaSqm: null,
  tenure: "unknown",
};

const CARD: Card = {
  v: 1, status: "ok",
  blocks: [
    { type: "header", title: "King's Cross", subtitle: "Camden" },
    { type: "pricePosition", homeType: "flat", bucket: 2, label: "Upper middle", sales: 12, q1: 1, median: 2, q3: 3 },
    { type: "facts", rows: [{ label: "Crime", value: "Low", tone: "good" }] },
    { type: "summary", groups: [
      { title: "For your search", only: true, rows: [{ label: "Fit", value: "Top 5%", tone: "good" }] },
      { title: "The price", only: true, rows: [{ label: "Vs sales", value: "Upper middle", tone: "neutral" },
        { label: "Per m²", value: "In line", tone: "neutral" }] },
      { title: "Before you offer", only: true, rows: [{ label: "Planning", value: "40 in 2 years", tone: "neutral" }] },
    ], pills: [{ label: "Safety", value: "8/10", band: 4 }] },
    { type: "actions", items: [{ kind: "save", label: "Save", href: "https://getcloseknit.com/save" }] },
  ],
};

function clock(start = 1_000_000) {
  const time = { now: start };
  return { time, now: () => time.now };
}

test("a ~150 m cell holds nearby points and tells farther ones apart", () => {
  assert.equal(cellOf({ lat: 51.5308, lng: -0.1238 }), cellOf({ lat: 51.53085, lng: -0.12385 }));
  assert.notEqual(cellOf({ lat: 51.5308, lng: -0.1238 }), cellOf({ lat: 51.5338, lng: -0.1238 }));
  assert.equal(cellOf({ lat: null, lng: -0.1 }), null);
});

test("a listing's card is kept for an hour, then forgotten", () => {
  const { time, now } = clock();
  const memory = new CardMemory(now);
  memory.set(FACTS, "p", CARD);
  time.now += 1000;
  assert.deepEqual(memory.get(FACTS, "p"), { card: CARD, age: 1000, provisional: false });
  assert.equal(memory.get(FACTS, "other-profile"), null);
  time.now += KEEP_MS;
  assert.equal(memory.get(FACTS, "p"), null);
});

test("a neighbour in the same cell lends its area facts, with this home's rows as placeholders", () => {
  const memory = new CardMemory(clock().now);
  memory.set(FACTS, "p", CARD);
  const kept = memory.get({ ...FACTS, listingId: "2", lat: 51.53085 }, "p");

  assert.ok(kept?.provisional);
  assert.deepEqual(kept.card.blocks.map((b) => b.type), ["header", "facts", "summary"]);
  const summary = kept.card.blocks[2] as Extract<Card["blocks"][number], { type: "summary" }>;
  assert.deepEqual(summary.groups[0], (CARD.blocks[3] as typeof summary).groups[0]);
  assert.deepEqual(summary.groups[1].rows, [{ label: "", value: "", pending: true }, { label: "", value: "", pending: true }]);
  assert.deepEqual(summary.pills, [{ label: "Safety", value: "8/10", band: 4 }]);
  // Not for a rental, nor far away.
  assert.equal(memory.get({ ...FACTS, listingId: "2", market: "rent" }, "p"), null);
  assert.equal(memory.get({ ...FACTS, listingId: "2", lat: 51.54 }, "p"), null);
});

test("errors are not kept and an outside card lends nothing", () => {
  const memory = new CardMemory(clock().now);
  memory.set(FACTS, "p", { v: 1, status: "error", blocks: [] });
  assert.equal(memory.get(FACTS, "p"), null);
  assert.equal(areaOnly({ v: 1, status: "outside-coverage", blocks: [{ type: "header", title: "London only" }] }), null);
});

test("the skeleton draws the summary panel's boxes with no text", () => {
  const { document } = parseHTML("<!doctype html><html><body><div id=host></div></body></html>");
  const host = document.getElementById("host") as unknown as HTMLElement;
  const drawn = renderSummary(host, skeletonCard(), { logoUrl: "x.svg", siteOrigin: "https://getcloseknit.com", onOpenCard() {} });

  assert.ok(drawn);
  assert.equal(host.querySelectorAll(".cks-group").length, 4);
  assert.equal(host.querySelectorAll(".cks-row.pending").length, 11);
  assert.equal(host.querySelectorAll(".cks-pill.pending").length, 5);
  assert.equal(host.querySelector(".cks")?.getAttribute("aria-busy"), "true");
  assert.equal(host.querySelector(".cks-grid")?.textContent, "");
});
