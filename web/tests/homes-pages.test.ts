// v4.3 homes-pages track: Tasks 34 (owned v4 blocks), 44 (Check a home card), 49 (price labels), 51 (watch without an agent).
import assert from "node:assert/strict";
import test from "node:test";

import { watchDistrict, watchLinks } from "../src/components/watch-listings";
import { shortAddress, topHomes } from "../src/components/postcode-homes-here";
import { ballparkLabel, homeSize } from "../src/lib/brief-model";
import { guideAction, guideMore, guideTile } from "../src/lib/guide-routes";
import { GUIDE_SLUGS } from "../src/lib/guide-slugs";
import { homesNearPath, homesWord, nearDistance, readHomesNear } from "../src/lib/homes-near";
import type { PostcodeHome } from "../src/lib/property-profile";
import { checkHomeHref, datedSalePrefill, readCheckHome, readPrefill, saleMonth, soldWords, toolHref, toolPrefill } from "../src/lib/tools";

// ---- Task 34 -------------------------------------------------------------------------------------

test("homes near: postcodes with homes, nearest first; bad rows are dropped", () => {
  const rows = readHomesNear({
    schemaVersion: "homes-near.v1", productReleaseId: "r", point: { latitude: 51.5, longitude: -0.1 }, radiusMetres: 800, caveats: [],
    postcodes: [
      { postcode: "BR6 9SD", geographyId: "uk:lsoa:E01000757", homes: 3, metres: 310 },
      { postcode: "BR6 9SB", geographyId: "uk:lsoa:E01000757", homes: 14, metres: 120 },
      { postcode: "not a postcode", geographyId: "uk:lsoa:E01000757", homes: 3, metres: 20 },
      { postcode: "BR6 9SA", geographyId: "uk:lsoa:E01000757", homes: 0, metres: 5 },
    ],
  });
  assert.deepEqual(rows?.map((row) => row.postcode), ["BR6 9SB", "BR6 9SD"]);
  assert.equal(readHomesNear({ schemaVersion: "other" }), null);
  assert.equal(readHomesNear(null), null);
});

test("homes near: the API path, distances and counts in words", () => {
  assert.equal(homesNearPath(51.371234, 0.098123), "/api/v1/homes/near?latitude=51.37123&longitude=0.09812&limit=4");
  assert.equal(nearDistance(123), "120 m");
  assert.equal(nearDistance(4), "10 m");
  assert.equal(nearDistance(1240), "1.2 km");
  assert.equal(homesWord(1), "1 home");
  assert.equal(homesWord(14), "14 homes");
});

const home = (address: string, uprn: string | null, sale: { date: string; price: number } | null = null): PostcodeHome => ({
  addressId: `uk:addr:${address.length.toString(16).padStart(12, "0")}` as PostcodeHome["addressId"], uprn, displayAddress: address,
  propertyType: "Flat or maisonette", tenure: null, floorAreaSquareMetres: null, energyRating: null, saleCount: sale ? 1 : 0, lastSale: sale,
});

test("homes here: homes with a page first, at most five, the address up to its street", () => {
  const homes = [home("Flat 1, 2 A Road, London, SW1A 1AB", null), ...Array.from({ length: 6 }, (_, index) => home(`${index + 3} A Road, London, SW1A 1AB`, `10000000000${index}`))];
  const shown = topHomes(homes);
  assert.equal(shown.length, 5);
  assert.ok(shown.every((entry) => entry.uprn));
  assert.equal(topHomes(homes.slice(0, 2)).at(-1)?.uprn, null);
  assert.equal(shortAddress("Flat 3, 14 Sample Street, Westminster, London, SW1A 1AB"), "Flat 3, 14 Sample Street");
  // A house has no flat part: the town after its street goes too (real Land Registry addresses).
  assert.equal(shortAddress("10 Sample Street, Westminster, London, SW1A 1AB"), "10 Sample Street");
  assert.equal(shortAddress("31 Sevenoaks Road, Orpington, Orpington, BR6 9JH"), "31 Sevenoaks Road");
  assert.equal(shortAddress("Basement And Ground Floor Shop, 1a Parkway, London, NW1 7PG"), "Basement And Ground Floor Shop, 1a Parkway");
  assert.equal(shortAddress("2nd Floor Flat, 5 Hill Road, London, N1 0AA"), "2nd Floor Flat, 5 Hill Road");
  assert.equal(shortAddress("Rose Cottage, High Street, London, N1 0AA"), "Rose Cottage, High Street");
});

test("guide Use it: every article has a main action; the extras never rank income or social renting", () => {
  for (const slug of GUIDE_SLUGS) assert.ok(guideAction(slug).href.startsWith("/"), slug);
  assert.deepEqual(guideMore("crime"), { href: "/rankings/lowest-crime", label: "Safest areas", kind: "tool" });
  assert.equal(guideMore("stamp-duty")?.href, "/tools/check-a-home");
  assert.equal(guideMore("income"), null);
  assert.equal(guideMore("social-renting"), null);
  assert.equal(guideTile("crime"), "safety");
  assert.equal(guideTile("income"), null);
  assert.equal(guideTile("social-renting"), null);
});

// ---- Task 49 -------------------------------------------------------------------------------------

test("price labels say the home: typical 2-bed, studio, 5+ bed, rent", () => {
  assert.equal(homeSize(0), "studio");
  assert.equal(homeSize(2), "2-bed");
  assert.equal(homeSize(7), "5+ bed");
  assert.equal(homeSize(null), null);
  assert.equal(ballparkLabel(497_000, { bedrooms: 2 }), "typical 2-bed ~£497k");
  assert.equal(ballparkLabel(497_000, { bedrooms: 2, short: true }), "2-bed ~£497k");
  assert.equal(ballparkLabel(2_100, { bedrooms: 1, monthly: true }), "1-bed rent ~£2,100/mo");
  assert.equal(ballparkLabel(497_000, { bedrooms: null }), "~£497k");
});

test("a home's tools start only from a dated sale, and carry its month", () => {
  assert.deepEqual(datedSalePrefill({ price: 570_000, date: "2022-11-15" }, "10 Sample Street"), { price: 570_000, from: "10 Sample Street", sold: "2022-11" });
  assert.deepEqual(datedSalePrefill({ price: 570_000, date: null }, "10 Sample Street"), {});
  assert.deepEqual(datedSalePrefill({ price: 570_000, date: "unknown" }, "10 Sample Street"), {});
  assert.deepEqual(datedSalePrefill(null, "10 Sample Street"), {});
  const href = checkHomeHref({ uprn: "100000000001", ...datedSalePrefill({ price: 570_000, date: "2022-11-15" }, "10 Sample Street") });
  assert.equal(href, "/tools/check-a-home?uprn=100000000001&price=570000&from=10+Sample+Street&sold=2022-11");
  assert.equal(toolHref("stamp-duty", { price: 570_000, sold: "2022-11" }), "/tools/stamp-duty?price=570000&sold=2022-11");
  // No price: no sale month either.
  assert.equal(toolHref("stamp-duty", { price: null, sold: "2022-11" }), "/tools/stamp-duty");
});

test("the tools read the sale month back, and only with a price", () => {
  assert.deepEqual(readPrefill({ price: "570000", from: "10 Sample Street", sold: "2022-11" }), { price: 570_000, from: "10 Sample Street", sold: "2022-11" });
  assert.equal(readPrefill({ price: "570000", sold: "2022-13" }).sold, null);
  assert.equal(readPrefill({ sold: "2022-11" }).sold, null);
  assert.equal(readCheckHome({ price: "570000", sold: "2022-11" }).sold, "2022-11");
  assert.equal(saleMonth("2022-11-15"), "2022-11");
  assert.equal(soldWords("2022-11"), "Nov 2022");
});

test("toolPrefill keeps the record's sale month", () => {
  const prefill = toolPrefill({ address: "10 Sample Street", geographyId: "uk:lsoa:E01000001", sourceVersion: "v", transactions: [{ date: "2022-11-15", nominalPrice: 570_000, floorAreaSquareMetres: null }] }, null, null);
  assert.deepEqual(prefill, { price: 570_000, from: "10 Sample Street", sold: "2022-11" });
});

// ---- Task 51 -------------------------------------------------------------------------------------

test("watch: the district comes from a postcode or an area title", () => {
  assert.equal(watchDistrict("SW1A 1AB"), "SW1A");
  assert.equal(watchDistrict("sw1a1ab"), "SW1A");
  assert.equal(watchDistrict("Highbury · N5"), "N5");
  assert.equal(watchDistrict("St James's"), null);
});

test("watch: portal alert links carry the area, price and beds through /go; no price opens the district", () => {
  const priced = watchLinks("N5", { market: "buy", maxPrice: 650_000, minBedrooms: 2 });
  assert.deepEqual(priced.map((link) => link.portal), ["rightmove", "zoopla", "onthemarket"]);
  for (const { href } of priced) {
    const url = new URL(href, "https://example.test");
    assert.match(url.pathname, /^\/go\/(rightmove|zoopla|onthemarket)$/);
    assert.equal(url.searchParams.get("outcode"), "N5");
    assert.equal(url.searchParams.get("max_price"), "650000");
    assert.equal(url.searchParams.get("beds"), "2");
    assert.equal(url.searchParams.get("market"), "buy");
  }
  const rent = watchLinks("N5", { market: "rent", maxPrice: 2_500, minBedrooms: null });
  assert.equal(new URL(rent[0].href, "https://example.test").searchParams.get("beds"), "0");
  const open = watchLinks("N5", { market: "buy", maxPrice: null, minBedrooms: null });
  assert.equal(open.length, 3);
  assert.equal(open[0].href, "https://www.rightmove.co.uk/property-for-sale/N5.html");
});
