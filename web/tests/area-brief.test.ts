import assert from "node:assert/strict";
import test from "node:test";

import type { AreaLocationResponse } from "../src/lib/area-location";
import {
  AREA_CARDS,
  areaPageHref,
  cardFromHash,
  costPrefill,
  legacyMapRedirect,
  mayBeLeasehold,
  planningFigure,
} from "../src/lib/area-brief";

const LSOA = "uk:lsoa:E01001209" as const;

function location(overrides: Partial<AreaLocationResponse> = {}): AreaLocationResponse {
  return {
    schemaVersion: "area-location.v1", productReleaseId: "r", geographyId: LSOA, available: true,
    notes: [], sources: [], caveats: [], ...overrides,
  };
}

test("the card's sections run in the owner's one fixed order, Overview first", () => {
  assert.deepEqual(AREA_CARDS.map((card) => card.title), [
    "Overview", "Price", "Getting around", "Safety", "Schools", "Local places",
    "Green & quiet", "Health", "Homes", "People", "Living costs",
  ]);
});

test("old #card links land on the section that holds their topic", () => {
  assert.equal(cardFromHash("#safety"), "safety");
  assert.equal(cardFromHash("#living"), "safety");
  assert.equal(cardFromHash("#around"), "getting-around");
  assert.equal(cardFromHash("#sales"), "price");
  assert.equal(cardFromHash("#council"), "living-costs");
  assert.equal(cardFromHash("#nowhere"), null);
});

test("the full page link carries the chosen home and the card to open", () => {
  assert.equal(areaPageHref(LSOA), "/area/lsoa/E01001209");
  assert.equal(
    areaPageHref(LSOA, { uprn: "12086013", addressId: "uk:addr:0b31c52c489a" }, "safety"),
    "/area/lsoa/E01001209?uprn=12086013&address=uk%3Aaddr%3A0b31c52c489a#safety",
  );
  assert.equal(areaPageHref(LSOA, null, null, { mode: "real", release: "rel-1" }), "/area/lsoa/E01001209?mode=real&release=rel-1");
  // An address id standing in for a UPRN never travels as one.
  assert.equal(areaPageHref(LSOA, { uprn: "uk:addr:0b31c52c489a", addressId: "uk:addr:0b31c52c489a" }),
    "/area/lsoa/E01001209?address=uk%3Aaddr%3A0b31c52c489a");
});

test("old area links with map settings still open the map; plain ones get the page", () => {
  assert.equal(legacyMapRedirect(LSOA, new URLSearchParams("")), null);
  assert.equal(legacyMapRedirect(LSOA, new URLSearchParams("uprn=1")), null);
  assert.equal(legacyMapRedirect(LSOA, new URLSearchParams("layer=crime&mode=real")),
    "/?layer=crime&mode=real&selected=uk%3Alsoa%3AE01001209");
});

test("planning header says the rules and activity in words, never an internal label", () => {
  assert.equal(planningFigure(null), "…");
  assert.equal(planningFigure("unknown"), "No planning figures for this area");
  assert.equal(planningFigure(location({
    conservation: { share: 0.25, presence: "partly", areas: [] },
    planning: { applications: 23, householder: 18, full: 2, priorApproval: 1, windowStart: "", windowEnd: "", regionMedian: 18 },
  })), "Partly in a conservation area · 23 applications in 2 years");
  assert.equal(planningFigure(location()), "Not in a conservation area");
});

test("the worksheet starts from real figures for a buyer and stays empty otherwise", () => {
  assert.deepEqual(costPrefill({ market: "buy", price: 535_000, rate: 4.784 }),
    { price: 535_000, deposit: 54_000, termYears: 25, annualInterestRatePct: 4.78 });
  assert.deepEqual(costPrefill({ market: "buy", price: 535_000, rate: null }), { price: 535_000, deposit: 54_000, termYears: 25 });
  assert.deepEqual(costPrefill({ market: "buy", price: null, rate: 4.7 }), {});
  assert.deepEqual(costPrefill({ market: "rent", price: 535_000, rate: 4.7 }), {});
});

test("leasehold diligence applies unless the home is known freehold", () => {
  assert.equal(mayBeLeasehold("Freehold"), false);
  assert.equal(mayBeLeasehold("Leasehold"), true);
  assert.equal(mayBeLeasehold(null), true);
});

test("typical home prices by type: the area's own, a wider area's named once, never a home's", async () => {
  const { typicalPriceItems } = await import("../src/lib/area-brief");
  const items = typicalPriceItems([
    { propertyType: "all", price: 650_000, sales: 41, geographyId: "uk:lsoa:E01000001", carrier: "lsoa", since: "2023-01", adjustedTo: "2026-06" },
    { propertyType: "flat", price: 455_000, sales: 90, geographyId: "uk:msoa:E02000001", carrier: "msoa", since: "2023-01", adjustedTo: "2026-06" },
    { propertyType: "detached", price: 1_830_000, sales: 6, geographyId: "uk:lad:E09000001", carrier: "lad", since: "2023-01", adjustedTo: "2026-06" },
  ], "lsoa");
  assert.deepEqual(items, [
    { key: "all", label: "All homes", price: "£650k", wider: false },
    { key: "flat", label: "Flats", price: "£455k", wider: true },
    { key: "detached", label: "Detached", price: "£1.83m", wider: true },
  ]);
  // A borough's own bands are its own, not a wider area's.
  assert.equal(typicalPriceItems([
    { propertyType: "all", price: 500_000, sales: 900, geographyId: "uk:lad:E09000001", carrier: "lad", since: "2023-01", adjustedTo: "2026-06" },
  ], "lad")[0].wider, false);
  for (const item of items) assert.doesNotMatch(`${item.label} ${item.price}`, /worth|value|valuation|estimate|would be/i);
});

test("the breadcrumb names the wider area, or its level when it shares the area's own title", async () => {
  const { partOfLabel } = await import("../src/lib/area-labels");
  assert.equal(partOfLabel({ title: "Hounslow", carrier: "lad" }, "Chiswick South East · W4"), "Hounslow");
  assert.equal(partOfLabel({ title: "Chiswick South East · W4", carrier: "msoa" }, "Chiswick South East · W4"),
    "the wider neighbourhood");
  assert.equal(partOfLabel({ title: null, carrier: "lad" }, "Chiswick South East · W4"), "the borough");
});
