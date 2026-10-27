import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { AddressHistory, PropertySummary } from "../src/lib/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomePage } from "../src/components/home-page";
import { LISTING_LINKS_NOTE, areaListingLinks, districtSoldPricesUrl, homeCardLinks, homeListingLinks, listingLinks, pricePaidSearchUrl } from "../src/lib/listing-links";
import { demoPropertyProfile } from "../src/lib/property-profile-fixture";

// The API's home_search.home_listing_links builds the same links for Claude; both read this fixture.
const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/home-listing-links.json", import.meta.url), "utf8")) as {
  cases: { name: string; postcode: string; links: Record<string, string> | null }[];
};

for (const item of fixture.cases) {
  test(`home listing links ${item.name} match the shared fixture`, () => {
    assert.deepEqual(homeListingLinks(item.postcode), item.links);
  });
}

test("the HM Land Registry link searches Price Paid for the home's postcode", () => {
  assert.equal(pricePaidSearchUrl("W5 1QT"), "https://landregistry.data.gov.uk/app/ppd/search?postcode=W5+1QT");
});

const address = { postcode: "W5 1QT", displayAddress: "18 Barnfield Road, London, W5 1QT" } as AddressHistory;
const property = { displayAddress: "18 Barnfield Road, London, W5 1QT" } as PropertySummary;

test("the card's links come from the address postcode, else the property's address", () => {
  const fromAddress = homeCardLinks(null, address);
  const fromProperty = homeCardLinks(property, null);
  assert.deepEqual(fromAddress, fromProperty);
  assert.equal(fromAddress?.priceRecord, "https://landregistry.data.gov.uk/app/ppd/search?postcode=W5+1QT");
  assert.deepEqual(fromAddress?.portals.map(({ label, href }) => [label, href]), [
    ["Rightmove", "https://www.rightmove.co.uk/house-prices/w5-1qt.html"],
    ["Zoopla", "https://www.zoopla.co.uk/for-sale/property/w5/?q=W5%201QT"],
    ["OnTheMarket", "https://www.onthemarket.com/for-sale/property/w5-1qt/"],
  ]);
});

test("a hidden home (the API returns nothing for it) or one without a postcode gets no links", () => {
  assert.equal(homeCardLinks(null, null), null);
  assert.equal(homeCardLinks({ displayAddress: "Flat 2, Somewhere" } as PropertySummary, null), null);
});

test("the note says the links go out and nothing is hosted, with no value words", () => {
  assert.equal(LISTING_LINKS_NOTE, "Links to the portals; Close Knit doesn't host listings.");
  assert.doesNotMatch(LISTING_LINKS_NOTE, /Estimated price|worth|would be around|Now ~|confidence/i);
});

test("listingLinks builds the same links from a bare postcode, and none without one", () => {
  assert.deepEqual(listingLinks("w5 1qt"), homeCardLinks(null, address));
  assert.equal(listingLinks(null), null);
  assert.equal(listingLinks("not a postcode"), null);
});

test("the property page shows the same View listing photos section as the map card, links only", () => {
  const profile = demoPropertyProfile("100000000001")!.profile;
  const html = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile }, mode: "demo", release: "test" }));
  const section = /<section[^>]*data-testid="property-listings"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.match(section, />View listing photos</);
  const links = [...section.matchAll(/<a [^>]*>/g)].map(([tag]) => tag);
  assert.equal(links.length, 3);
  for (const tag of links) {
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noopener noreferrer"/);
  }
  const code = profile.postcode!;
  assert.deepEqual(links.map((tag) => /href="([^"]+)"/.exec(tag)![1].replace(/&amp;/g, "&")), Object.values(homeListingLinks(code)!));
  assert.match(section, /Links to the portals; Close Knit doesn&#x27;t host listings\./);
  assert.doesNotMatch(section, /<img|£|m²|worth|Estimated/);
});

test("a property page without a postcode gets no listing links", () => {
  const profile = { ...demoPropertyProfile("100000000001")!.profile, postcode: null };
  const html = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile }, mode: "demo", release: "test" }));
  assert.doesNotMatch(html, /property-listings|rightmove/);
});

// The API's home_search.portal_links builds the same area searches for Claude; both read this fixture.
const areaFixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/area-listing-links.json", import.meta.url), "utf8")) as {
  cases: { name: string; outcode: string; market: "buy" | "rent"; maxPrice: number; minBedrooms: number; links: Record<string, string>; sold: string }[];
};

for (const item of areaFixture.cases) {
  test(`area listing links ${item.name} match the shared fixture`, () => {
    const links = areaListingLinks(item.outcode, { market: item.market, maxPrice: item.maxPrice, minBedrooms: item.minBedrooms });
    assert.deepEqual(Object.fromEntries(links.map(({ portal, href }) => [portal, href])), item.links);
    assert.equal(districtSoldPricesUrl(item.outcode), item.sold);
  });
}

test("without a search the area's portal searches are left open", () => {
  const links = areaListingLinks("e8", { market: "buy", maxPrice: null, minBedrooms: null });
  assert.deepEqual(links.map(({ href }) => href), [
    "https://www.rightmove.co.uk/property-for-sale/E8.html",
    "https://www.zoopla.co.uk/for-sale/property/e8/?q=E8",
    "https://www.onthemarket.com/for-sale/property/e8/",
  ]);
  assert.deepEqual(areaListingLinks("not a district", { market: "buy", maxPrice: null, minBedrooms: null }), []);
  assert.equal(districtSoldPricesUrl("E8 3AA"), null);
});
