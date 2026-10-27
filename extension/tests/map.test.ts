// Map popup cards, trimmed from each portal's real map view on 2026-10-19 (fixtures/map/*.html), and the pins in
// the page's data (shapes as read in Chrome; values from the same pages).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";

import { resultsAdapter } from "../src/adapters/results";
import { complete, findPopups, indexItems, inPopup, itemFromFacts, listingUrl } from "../src/adapters/results/popups";
import type { ResultItem, ResultsAdapter, ResultsSnapshot } from "../src/adapters/results/types";
import { FALLBACK_CONFIG, lineAllowed, parseConfig } from "../src/mode";

const PAGES = {
  rightmove: "https://www.rightmove.co.uk/property-for-sale/map.html?locationIdentifier=REGION%5E87490&viewport=-0.56%2C0.82%2C51.37%2C51.76",
  zoopla: "https://www.zoopla.co.uk/for-sale/map/property/london/se24/herne-hill/",
  onthemarket: "https://www.onthemarket.com/for-sale/property/se24/?page=3&view=map-list",
};

function page(name: keyof typeof PAGES): { document: Document; adapter: ResultsAdapter } {
  const html = readFileSync(new URL(`./fixtures/map/${name}.html`, import.meta.url), "utf8");
  const adapter = resultsAdapter(PAGES[name]);
  assert.ok(adapter?.popups, `${name} has map popups`);
  return { document: parseHTML(html).document as unknown as Document, adapter };
}

function snapshot(url: string, nextData: unknown): ResultsSnapshot {
  return { url, scripts: [], nextData: JSON.stringify(nextData), listingData: [] };
}

test("rightmove: the pin's card and its listing, the line hung below the fixed card", () => {
  const { document, adapter } = page("rightmove");
  const slots = findPopups(document, adapter);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].listingId, "94413489");
  assert.match(slots[0].card.className, /singlePinCardContainer/);
  assert.equal(adapter.popups?.place, "below");
  assert.equal(listingUrl(slots[0].href, PAGES.rightmove), "https://www.rightmove.co.uk/properties/94413489");
});

test("zoopla: the info window's mini card; the results list's own card is not a popup", () => {
  const { document, adapter } = page("zoopla");
  const slots = findPopups(document, adapter);
  assert.deepEqual(slots.map((slot) => [slot.listingId, slot.card.getAttribute("data-testid")]), [["74082621", "minicard-74082621"]]);
  assert.equal(adapter.popups?.place, "append");
  assert.equal(listingUrl(slots[0].href, PAGES.zoopla), "https://www.zoopla.co.uk/for-sale/details/74082621/");
  const [listLink, popupLink] = [...document.querySelectorAll("a[href*='/details/']")];
  assert.equal(inPopup(listLink, adapter), false);
  assert.equal(inPopup(popupLink, adapter), true);
});

test("onthemarket: each slide of the info box, not the results list's cards", () => {
  const { document, adapter } = page("onthemarket");
  const slots = findPopups(document, adapter);
  assert.deepEqual(slots.map((slot) => [slot.listingId, slot.card.tagName]), [["17558361", "LI"]]);
  assert.equal(listingUrl(slots[0].href, PAGES.onthemarket), "https://www.onthemarket.com/details/17558361/");
});

test("a card that links to two listings is skipped; a portal without popups finds none", () => {
  const { document, adapter } = page("zoopla");
  const card = document.querySelector("[data-testid^='minicard-']")!;
  card.insertAdjacentHTML("beforeend", '<a href="/for-sale/details/99999999/">other</a>');
  assert.deepEqual(findPopups(document, adapter), []);
  const openrent = resultsAdapter("https://www.openrent.co.uk/properties-to-rent/london")!;
  assert.deepEqual(findPopups(document, openrent), []);
  assert.equal(inPopup(card, openrent), false);
});

test("rightmove: map pins from geoJsonProperties, as results (a pin says its channel)", () => {
  const feature = (id: number, extra: object) => ({ type: "Feature", geometry: { type: "Point", coordinates: [0.05422, 51.52665] },
    properties: { id, price: { amount: 538000, frequency: "not specified" }, location: { latitude: 51.52665, longitude: 0.05422 },
      bedrooms: 3, propertySubType: "Terraced", channel: "BUY", ...extra } });
  const data = { props: { pageProps: { searchResults: { properties: [], geoJsonProperties: { type: "FeatureCollection", features: [
    feature(94358451, {}),
    feature(94413489, { channel: "RENT", price: { amount: 600, frequency: "weekly" }, propertySubType: "End of Terrace" }),
    { type: "Feature", properties: { name: "no id" } },
  ] } } } } };
  const pins = resultsAdapter(PAGES.rightmove)!.popups!.pins!(snapshot(PAGES.rightmove, data));
  assert.deepEqual(pins[0], {
    listingId: "94358451", url: "https://www.rightmove.co.uk/properties/94358451", lat: 51.52665, lng: 0.05422,
    postcode: null, market: "buy", askingPrice: 538000, bedrooms: 3, propertyType: "terraced",
  });
  assert.deepEqual([pins[1].market, pins[1].askingPrice, pins[1].propertyType], ["rent", 2600, "terraced"]);
  assert.equal(pins.length, 2);
});

test("onthemarket: map pins from maps.list give the point only (their price is rounded)", () => {
  const data = { props: { pageProps: { initialReduxState: { maps: { list: [
    { page: 3, id: "17558361", location: { lon: -0.095519, lat: 51.452701 }, price: "£720k" },
    { page: 4, id: "advert", location: { lon: 0, lat: 0 } },
  ] } } } } };
  const pins = resultsAdapter(PAGES.onthemarket)!.popups!.pins!(snapshot(PAGES.onthemarket, data));
  assert.deepEqual(pins, [{
    listingId: "17558361", url: "https://www.onthemarket.com/details/17558361/", lat: 51.452701, lng: -0.095519,
    postcode: null, market: "buy", askingPrice: null, bedrooms: null, propertyType: "unknown",
  }]);
  assert.equal(complete(pins[0]), false);
});

test("a complete result wins over a partial pin; a listing page's facts become a result", () => {
  const pin: ResultItem = { listingId: "1", url: "u", lat: 51.5, lng: -0.1, postcode: null, market: "buy", askingPrice: null,
    bedrooms: null, propertyType: "unknown" };
  const result: ResultItem = { ...pin, askingPrice: 719999, bedrooms: 3, propertyType: "terraced" };
  assert.equal(indexItems([pin], [result]).get("1"), result);
  assert.equal(indexItems([result], [pin]).get("1"), result);
  assert.equal(complete({ ...result, lat: null }), false);
  assert.equal(complete({ ...result, lat: null, postcode: "SE24 9AA" }), true);
  const item = itemFromFacts({ portal: "zoopla", listingId: "74082621", url: "https://www.zoopla.co.uk/for-sale/details/74082621/",
    address: "Delawyk Crescent", lat: 51.45, lng: -0.09, postcode: null, market: "buy", askingPrice: 420000, bedrooms: 1,
    floorAreaSqm: 42, tenure: "leasehold", propertyType: "bungalow", listedOn: "2026-08-27", epcRating: "D" });
  assert.deepEqual(item, { listingId: "74082621", url: "https://www.zoopla.co.uk/for-sale/details/74082621/", lat: 51.45,
    lng: -0.09, postcode: null, market: "buy", askingPrice: 420000, bedrooms: 1, propertyType: "bungalow", listedOn: "2026-08-27" });
  assert.equal(listingUrl("http://[bad", "not a url"), null);
});

test("features: on by default and when the server is unreachable; each switched alone", () => {
  assert.deepEqual(FALLBACK_CONFIG.features, { resultsLine: true, mapPopup: true });
  assert.deepEqual(parseConfig({ v: 1 }).features, { resultsLine: true, mapPopup: true });
  assert.deepEqual(parseConfig({ features: { mapPopup: false, resultsLine: "no", other: false } }).features,
    { resultsLine: true, mapPopup: false });
});

test("the lines show whenever the portal is not off, whatever the user chose for listing pages", () => {
  const on = FALLBACK_CONFIG.features;
  for (const mode of ["inline", "side-panel", "side-card"] as const) {
    assert.equal(lineAllowed(mode, true, on, "results"), true, mode);
    assert.equal(lineAllowed(mode, true, on, "map"), true, mode);
  }
  assert.equal(lineAllowed("off", true, on, "results"), false);
  assert.equal(lineAllowed("inline", false, on, "map"), false);
  assert.equal(lineAllowed("inline", true, { ...on, mapPopup: false }, "map"), false);
  assert.equal(lineAllowed("inline", true, { ...on, mapPopup: false }, "results"), true);
  assert.equal(lineAllowed("side-panel", true, { ...on, resultsLine: false }, "results"), false);
});
