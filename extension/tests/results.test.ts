// Search-results pages, trimmed from each portal's real page on 2026-10-18 (only the keys the adapters
// read: no photos, descriptions or agents). Zoopla's was read in Chrome; the others with curl.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readResults, resultsAdapter } from "../src/adapters/results";
import { flightText, listedOnOf, objectsWithKey, propertyTypeOf } from "../src/adapters/results/common";
import type { ResultsSnapshot } from "../src/adapters/results/types";
import { badgeView } from "../src/content/badge";

function fixture(name: string): ResultsSnapshot {
  return JSON.parse(readFileSync(new URL(`fixtures/results/${name}.json`, import.meta.url), "utf8")) as ResultsSnapshot;
}

test("rightmove: results from __NEXT_DATA__ searchResults", () => {
  const page = readResults(fixture("rightmove"));
  assert.equal(page?.portal, "rightmove");
  assert.equal(page?.items.length, 5);
  assert.deepEqual(page?.items[1], {
    listingId: "91737435", url: "https://www.rightmove.co.uk/properties/91737435", lat: 51.485254, lng: 0.163125,
    postcode: null, market: "buy", askingPrice: 375000, bedrooms: 3, propertyType: "terraced", listedOn: "2026-09-14",
  });
  assert.deepEqual(page?.items.map((item) => item.propertyType), ["flat", "terraced", "terraced", "unknown", "flat"]);
});

test("rightmove: a weekly rent becomes a monthly one", () => {
  const snapshot = fixture("rightmove");
  const data = JSON.parse(snapshot.nextData!);
  const first = data.props.pageProps.searchResults.properties[0];
  Object.assign(first, { transactionType: "RENT", price: { amount: 600, frequency: "weekly" } });
  const page = readResults({ ...snapshot, url: "https://www.rightmove.co.uk/property-to-rent/find.html?x=1", nextData: JSON.stringify(data) });
  assert.equal(page?.items[0].market, "rent");
  assert.equal(page?.items[0].askingPrice, 2600);
});

test("zoopla: results from the streamed page data, each once, featured ones too", () => {
  const page = readResults(fixture("zoopla"));
  assert.equal(page?.portal, "zoopla");
  assert.deepEqual(page?.items.map((item) => item.listingId), ["71243134", "67222934", "72722308", "72079749"]);
  assert.deepEqual(page?.items[0], {
    listingId: "71243134", url: "https://www.zoopla.co.uk/for-sale/details/71243134/", lat: 51.551101, lng: -0.053289,
    postcode: null, market: "buy", askingPrice: 600000, bedrooms: 2, propertyType: "flat", listedOn: "2026-10-03",
  });
  assert.deepEqual([page?.items[1].lat, page?.items[1].lng], [51.544235, -0.074077]);
  assert.equal(page?.items[2].propertyType, "unknown");
  assert.equal(page?.items[3].propertyType, "terraced");
});

test("onthemarket: results from initialReduxState, adverts skipped", () => {
  const page = readResults(fixture("onthemarket"));
  assert.equal(page?.portal, "onthemarket");
  assert.deepEqual(page?.items.map((item) => item.listingId), ["4446213", "20571821", "20444550", "18182906"]);
  assert.deepEqual(page?.items[0], {
    listingId: "4446213", url: "https://www.onthemarket.com/details/4446213/", lat: 51.5387645, lng: -0.058092,
    postcode: null, market: "buy", askingPrice: 730000, bedrooms: 2, propertyType: "flat", listedOn: "2026-10-12",
  });
});

test("the day each result was first listed, sent only when known (a reduction is not a listing date)", () => {
  const listed = (name: string) => readResults(fixture(name))?.items.map((item) => item.listedOn ?? null);
  // Rightmove: firstVisibleDate first, then "Added on …"; "Reduced on …" alone says nothing.
  assert.deepEqual(listed("rightmove"), ["2026-10-06", "2026-09-14", "2026-08-02", null, null]);
  assert.deepEqual(listed("zoopla"), ["2026-10-03", null, null, null]);
  assert.deepEqual(listed("onthemarket"), ["2026-10-12", null, null, null]);
  assert.ok(!("listedOn" in readResults(fixture("rightmove"))!.items[4]));
  assert.deepEqual([listedOnOf("Listed on 1st Mar 2026"), listedOnOf("Added today", "x") !== null, listedOnOf("Added > 14 days")],
    ["2026-03-01", true, null]);
});

test("openrent: results from the page's arrays; a room sends no rent or bedrooms", () => {
  const page = readResults(fixture("openrent"));
  assert.equal(page?.portal, "openrent");
  assert.equal(page?.items.length, 5);
  assert.deepEqual(page?.items[0], {
    listingId: "2972018", url: "https://www.openrent.co.uk/2972018", lat: 51.548786, lng: -0.059813, postcode: null,
    market: "rent", askingPrice: 4250, bedrooms: 2, propertyType: "unknown",
  });
  assert.deepEqual([page?.items[1].askingPrice, page?.items[1].bedrooms], [null, null]);
  assert.equal(page?.items[2].bedrooms, 0);
});

test("spareroom: results from data-listing attributes, with no location to look up", () => {
  const page = readResults(fixture("spareroom"));
  assert.equal(page?.portal, "spareroom");
  assert.deepEqual(page?.items.map((item) => item.listingId), ["17091268", "18465659", "18466130", "18465764"]);
  assert.ok(page?.items.every((item) => item.lat === null && item.postcode === null && item.askingPrice === null));
  const wanted = fixture("spareroom");
  wanted.listingData = wanted.listingData.map((data) => ({ ...data, listingType: "wanted" }));
  assert.equal(readResults(wanted), null);
});

test("listing pages and other sites are not results pages", () => {
  assert.equal(resultsAdapter("https://www.zoopla.co.uk/for-sale/details/67222934/"), null);
  assert.equal(resultsAdapter("https://www.rightmove.co.uk/properties/89918394"), null);
  assert.equal(resultsAdapter("https://www.onthemarket.com/details/4446213/"), null);
  assert.equal(resultsAdapter("https://example.com/for-sale/"), null);
  assert.equal(readResults({ ...fixture("rightmove"), nextData: "{}" }), null);
});

test("each portal's result links name their listing", () => {
  const id = (url: string, href: string) => resultsAdapter(url)?.linkId(href);
  assert.equal(id("https://www.rightmove.co.uk/property-for-sale/find.html", "/properties/89918394#/?channel=RES_BUY"), "89918394");
  assert.equal(id("https://www.zoopla.co.uk/for-sale/property/london/", "/new-homes/details/66754046/?search_identifier=x"), "66754046");
  assert.equal(id("https://www.onthemarket.com/for-sale/property/hackney/", "/details/4446213/"), "4446213");
  assert.equal(id("https://www.openrent.co.uk/properties-to-rent/hackney-london",
    "/property-to-rent/london/2-bed-flat-academy-apartments-e8/2972018"), "2972018");
  assert.equal(id("https://www.spareroom.co.uk/flatshare/london/hackney", "/flatshare/london/hackney/18465659"), "18465659");
  assert.equal(id("https://www.spareroom.co.uk/flatshare/london/hackney",
    "/flatshare/fad_click.pl?fad_id=17091268&search_id=&offset=0"), "17091268");
  assert.equal(id("https://www.rightmove.co.uk/property-for-sale/find.html", "/property-for-sale/London.html"), null);
});

test("property types from the portals' words", () => {
  assert.deepEqual(["Apartment", "End of Terrace", "Semi-Detached", "Detached", "Detached bungalow", "House", "Studio"]
    .map(propertyTypeOf), ["flat", "terraced", "semi-detached", "detached", "bungalow", "unknown", "flat"]);
});

test("streamed objects are found across pushes, and broken ones skipped", () => {
  const text = flightText([
    'self.__next_f.push([1,"a:{\\"x\\":{\\"listingId\\":\\"1\\",\\"n\\":"])',
    'self.__next_f.push([1,"2}}\\nb:{\\"listingId\\":"])',
  ]);
  assert.deepEqual(objectsWithKey(text, "listingId"), [{ listingId: "1", n: 2 }]);
});

test("the line: a score ring, the price strip and one flag", () => {
  const area = badgeView({ listingId: "1", score: 7, band: 4, excluded: false, bucket: 1, flag: "Noisier" }, "area");
  assert.equal(area?.ring, "7");
  assert.equal(area?.label, "Area 7/10 against London");
  const north = badgeView({ listingId: "1", score: 7, band: 4, excluded: false, bucket: 1, rankScope: { code: "E12000002", name: "North West" } }, "area");
  assert.equal(north?.label, "Area 7/10 against North West", "against the area's region (rankScope)");
  assert.match(area?.bucketLabel ?? "", /lower half/);
  assert.equal(area?.flag, "Noisier");

  const match = badgeView({ listingId: "1", score: 82, band: 5, excluded: false, bucket: null }, "match");
  assert.deepEqual([match?.ring, match?.label, match?.bucketLabel], ["82", "82/100 for your search", null]);

  const excluded = badgeView({ listingId: "1", score: null, band: null, excluded: true, bucket: null }, "match");
  assert.deepEqual([excluded?.ring, excluded?.band], ["✕", 1]);

  assert.equal(badgeView({ listingId: "1", score: null, band: null, excluded: false, bucket: null }, "area"), null);
});

test("the line never says worth or fair", () => {
  for (const bucket of [0, 1, 2, 3] as const) {
    const view = badgeView({ listingId: "1", score: 5, band: 3, excluded: false, bucket }, "area");
    assert.doesNotMatch(view?.bucketLabel ?? "", /worth|fair|overpay/i);
  }
});
