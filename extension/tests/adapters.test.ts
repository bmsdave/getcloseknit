// Synthetic pages in each portal's data format (as seen on 2026-10-14; SpareRoom and OpenRent on 2026-10-17),
// not copies of real listings.
import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { readListing } from "../src/adapters";
import {
  councilTaxBandOf, epcRatingOf, isoDateOf, leaseYearsOf, objectAfter, parseArea, parsePrice, propertyTypeOf, yearlyAmountOf,
} from "../src/adapters/parse";
import { unflatten } from "../src/adapters/rightmove";
import { MEMORY_KEY, MEMORY_LIMIT, mergeChanges, remember, type Store } from "../src/memory";
import type { ListingFacts, PageSnapshot } from "../src/types";

function page(url: string, parts: Partial<PageSnapshot> = {}): PageSnapshot {
  return { url, scripts: [], jsonLd: [], nextData: null, title: "", mapData: null, ...parts };
}

/** Rightmove's flattened model: the first item is the root, objects hold indexes. */
function flattenedRightmove(property: Record<string, unknown>): string {
  const values: unknown[] = [];
  const add = (value: unknown): number => {
    const index = values.length;
    values.push(null);
    if (Array.isArray(value)) values[index] = value.map(add);
    else if (value && typeof value === "object") {
      values[index] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, add(v)]));
    } else values[index] = value;
    return index;
  };
  add({ propertyData: property, isAuthenticated: false });
  const model = JSON.stringify({ data: JSON.stringify(values) });
  return `\n    window.__PAGE_MODEL = ${model};\n    window.adInfo = [{"key":"a","value":["b}"]}];\n`;
}

const RIGHTMOVE_PROPERTY = {
  id: "90000001", transactionType: "BUY", bedrooms: 2,
  address: { displayAddress: "Example Road, London, E8", outcode: "E8", incode: "4ZZ" },
  location: { latitude: 51.5407, longitude: -0.0748, pinType: "ACCURATE_POINT" },
  prices: { primaryPrice: "£600,000", displayPriceQualifier: "Offers in Excess of" },
  tenure: { tenureType: "SHARE_OF_FREEHOLD" },
  sizings: [{ unit: "sqft", minimumSize: 700 }, { unit: "sqm", minimumSize: 65 }],
};

test("Rightmove: the flattened page model gives the listing's facts", () => {
  const facts = readListing(page("https://www.rightmove.co.uk/properties/90000001#/?channel=RES_BUY",
    { scripts: ["var x = 1;", flattenedRightmove(RIGHTMOVE_PROPERTY)] }));

  assert.deepEqual(facts, {
    portal: "rightmove", listingId: "90000001", url: "https://www.rightmove.co.uk/properties/90000001",
    address: "Example Road, London, E8", lat: 51.5407, lng: -0.0748, postcode: "E8 4ZZ", market: "buy",
    askingPrice: 600000, bedrooms: 2, floorAreaSqm: 65, tenure: "share-of-freehold",
  });
});

test("Rightmove: rent is monthly, and a model for another listing is ignored", () => {
  const rent = { ...RIGHTMOVE_PROPERTY, transactionType: "RENT", prices: { primaryPrice: "£2,925 pcm" } };
  const facts = readListing(page("https://www.rightmove.co.uk/properties/90000001", { scripts: [flattenedRightmove(rent)] }));
  assert.equal(facts?.market, "rent");
  assert.equal(facts?.askingPrice, 2925);

  assert.equal(readListing(page("https://www.rightmove.co.uk/properties/12345",
    { scripts: [flattenedRightmove(RIGHTMOVE_PROPERTY)] })), null);
});

test("Rightmove: a plain (not flattened) model works too", () => {
  const script = `window.__PAGE_MODEL = ${JSON.stringify({ propertyData: RIGHTMOVE_PROPERTY })}`;
  assert.equal(readListing(page("https://www.rightmove.co.uk/properties/90000001", { scripts: [script] }))?.bedrooms, 2);
});

const ZOOPLA_LD = {
  "@context": "https://schema.org", "@type": "RealEstateListing",
  name: "2 bed flat for sale Example Road, London E8",
  mainEntityOfPage: "https://www.zoopla.co.uk/for-sale/details/70000001/",
  offers: { "@type": "Offer", price: 375000, priceCurrency: "GBP" },
  additionalProperty: [
    { "@type": "PropertyValue", name: "Bedrooms", value: "2" },
    { "@type": "PropertyValue", name: "Floor size", value: "484 sq. ft" },
  ],
};
const ZOOPLA_STREAM = 'self.__next_f.push([1,"{\\"location\\":{\\"coordinates\\":{\\"latitude\\":51.548315,\\"longitude\\":-0.055905},\\"outcode\\":\\"E8\\"}}"])';
// Nearby EV chargers come later in the stream with their own coordinates.
const ZOOPLA_CHARGERS = 'self.__next_f.push([1,"{\\"postcode\\":\\"E8 1JP\\",\\"coordinates\\":{\\"latitude\\":51.5529,\\"longitude\\":-0.0565}}"])';

test("Zoopla: JSON-LD for price and size, the streamed data for the point", () => {
  const facts = readListing(page("https://www.zoopla.co.uk/for-sale/details/70000001/?search_identifier=x",
    { jsonLd: [JSON.stringify({ "@type": "BreadcrumbList" }), JSON.stringify(ZOOPLA_LD)], scripts: [ZOOPLA_STREAM, ZOOPLA_CHARGERS] }));

  assert.deepEqual(facts, {
    portal: "zoopla", listingId: "70000001", url: "https://www.zoopla.co.uk/for-sale/details/70000001/",
    address: "Example Road, London E8", lat: 51.548315, lng: -0.055905, postcode: null, market: "buy",
    askingPrice: 375000, bedrooms: 2, floorAreaSqm: 45, tenure: "unknown",
  });
});

test("Zoopla: a weekly rent becomes monthly, and the page's own listing is required", () => {
  const weekly = { ...ZOOPLA_LD, mainEntityOfPage: "https://www.zoopla.co.uk/to-rent/details/70000001/",
    offers: { price: 600, eligibleDuration: { unitCode: "WEE", value: "1" } } };
  const facts = readListing(page("https://www.zoopla.co.uk/to-rent/details/70000001/", { jsonLd: [JSON.stringify(weekly)] }));
  assert.equal(facts?.market, "rent");
  assert.equal(facts?.askingPrice, 2600);

  assert.equal(readListing(page("https://www.zoopla.co.uk/for-sale/details/99/", { jsonLd: [JSON.stringify(ZOOPLA_LD)] })), null);
});

test("OnTheMarket: the Redux state in __NEXT_DATA__", () => {
  const nextData = JSON.stringify({ props: { pageProps: { initialReduxState: {
    property: { id: "18000001", displayAddress: "Example Square, London", bedrooms: 2, price: "£650,000",
      location: { lon: -0.073829, lat: 51.545726 }, agent: { location: { lon: -0.12, lat: 51.51 } } },
    metadata: { dataLayer: { channel: "sale", postcode: "E8 3ZZ", price: "650,000" } },
  } } } });
  const facts = readListing(page("https://www.onthemarket.com/details/18000001/", { nextData }));

  assert.deepEqual(facts, {
    portal: "onthemarket", listingId: "18000001", url: "https://www.onthemarket.com/details/18000001/",
    address: "Example Square, London", lat: 51.545726, lng: -0.073829, postcode: "E8 3ZZ", market: "buy",
    askingPrice: 650000, bedrooms: 2, floorAreaSqm: null, tenure: "unknown",
  });
  assert.equal(readListing(page("https://www.onthemarket.com/details/1/", { nextData })), null);
});

/** SpareRoom's `_sr.page`: a JavaScript object literal, with the ad first and the searched place after it. */
function spareroomScript(advert: { id: string; type?: string }): string {
  return `_sr.checkout = { context: { platform: 'desktop' } };  _sr.page = {
    loginReturnPath: '\\x2Fflatshare',
, advert: {has_photos: "1" === "1" ? true : false,id: "${advert.id}",is_expired: "" === "1" ? true : false,` +
    `location: {latitude: "51.5501234",longitude: "-0.0601234",},share_title: "double room in Hackney (E8)",` +
    `type: "${advert.type ?? "offered"}",},localisations: {done: 'Done',},location: {id: "",latitude: "51.5",longitude: "-0.1",},` +
    `page_name: "detail",page_type: "listing",  };`;
}

test("SpareRoom: the ad's point, marked approximate, and no rent to compare", () => {
  const facts = readListing(page("https://www.spareroom.co.uk/flatshare/london/hackney/19000001?listing_click=1",
    { scripts: ["var x = 1;", spareroomScript({ id: "19000001" })] }));

  assert.deepEqual(facts, {
    portal: "spareroom", listingId: "19000001", url: "https://www.spareroom.co.uk/flatshare/london/hackney/19000001",
    address: "Hackney, E8", lat: 51.5501234, lng: -0.0601234, postcode: null, market: "rent",
    askingPrice: null, bedrooms: null, floorAreaSqm: null, tenure: "unknown", locationApproximate: true,
  });
});

test("SpareRoom: the detail.pl address works; wanted ads and another ad's data are ignored", () => {
  const detail = "https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=19000001&search_id=5";
  assert.equal(readListing(page(detail, { scripts: [spareroomScript({ id: "19000001" })] }))?.url,
    "https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=19000001");
  assert.equal(readListing(page(detail, { scripts: [spareroomScript({ id: "19000001", type: "wanted" })] })), null);
  assert.equal(readListing(page("https://www.spareroom.co.uk/flatshare/london/hackney/123",
    { scripts: [spareroomScript({ id: "19000001" })] })), null);
});

const OPENRENT_MAP = { mapLoadLocation: "/listing/justmapandstreetview/3900001", lat: "51.50551", lng: "-0.1148",
  streetviewLat: "51.5056", streetviewLng: "-0.1143", isInLondon: "true" };

test("OpenRent: the #map element's point, and kind, address and rent from the title", () => {
  const facts = readListing(page("https://www.openrent.co.uk/property-to-rent/london/1-bed-flat-example-road-se1/3900001",
    { title: "London - 1 Bed Flat, Example Road, SE1 - To Rent Now for £2,750.00 p/m", mapData: OPENRENT_MAP }));

  assert.deepEqual(facts, {
    portal: "openrent", listingId: "3900001",
    url: "https://www.openrent.co.uk/property-to-rent/london/1-bed-flat-example-road-se1/3900001",
    address: "Example Road, SE1", lat: 51.50551, lng: -0.1148, postcode: null, market: "rent",
    askingPrice: 2750, bedrooms: 1, floorAreaSqm: null, tenure: "unknown", propertyType: "flat",
  });
});

test("OpenRent: a studio has no bedroom, a room sends no rent, another listing's map is ignored", () => {
  const url = "https://www.openrent.co.uk/property-to-rent/london/x/3900001";
  const studio = readListing(page(url, { title: "London - Studio Flat, Example Street, WC2N - To Rent Now for £1,900.00 p/m",
    mapData: OPENRENT_MAP }));
  assert.deepEqual([studio?.bedrooms, studio?.askingPrice], [0, 1900]);

  const room = readListing(page(url, { title: "London - Room in a Shared Flat, London, W1B - To Rent Now for £900.00 p/m",
    mapData: OPENRENT_MAP }));
  assert.deepEqual([room?.bedrooms, room?.askingPrice, room?.address, room?.lat], [null, null, "London, W1B", 51.50551]);

  assert.equal(readListing(page("https://www.openrent.co.uk/property-to-rent/london/x/3900002", { mapData: OPENRENT_MAP })), null);
});

test("search pages and broken data give no listing", () => {
  assert.equal(readListing(page("https://www.rightmove.co.uk/property-for-sale/find.html?x=1")), null);
  assert.equal(readListing(page("https://www.zoopla.co.uk/for-sale/property/e8/")), null);
  assert.equal(readListing(page("https://www.onthemarket.com/details/1/", { nextData: "{not json" })), null);
  assert.equal(readListing(page("https://www.spareroom.co.uk/flatshare/london/hackney", { scripts: [spareroomScript({ id: "1" })] })), null);
  assert.equal(readListing(page("https://www.openrent.co.uk/properties-to-rent/london?term=SE1", { mapData: OPENRENT_MAP })), null);
});

test("parsing helpers", () => {
  assert.equal(parsePrice("£450 pw", "rent"), 1950);
  assert.equal(parsePrice("POA", "buy"), null);
  assert.equal(parseArea("45 sq. m"), 45);
  assert.deepEqual(objectAfter('x = {"a":"}{","b":{"c":1}}; y = 2', "x ="), { a: "}{", b: { c: 1 } });
  assert.deepEqual(unflatten(JSON.stringify([{ a: 1, b: 2 }, "x", [3], 4])), { a: "x", b: [4] });
});

// Listing facts v2, from trimmed real page data (tests/fixtures, read 2026-10-18).

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const V2_KEYS = ["propertyType", "councilTaxBand", "serviceChargeYearly", "groundRentYearly", "leaseYearsRemaining",
  "epcRating", "listedOn", "priceChanges"] as const;

/** Only the v2 facts (and tenure), so each case states exactly what the page gave. */
function v2(facts: ListingFacts | null): Record<string, unknown> {
  assert.ok(facts);
  const out: Record<string, unknown> = { tenure: facts.tenure };
  for (const key of V2_KEYS) if (key in facts) out[key] = facts[key];
  return out;
}

test("Rightmove v2: living costs, lease, sub-type, key-feature EPC and the reduced / added date", () => {
  const rm = fixture("rightmove.json");
  const read = (id: string) => readListing(page(`https://www.rightmove.co.uk/properties/${id}`,
    { scripts: [flattenedRightmove(rm[id])] }));

  assert.deepEqual(v2(read("90332700")), {
    tenure: "leasehold", propertyType: "flat", councilTaxBand: "D", serviceChargeYearly: 3494, groundRentYearly: 610,
    leaseYearsRemaining: 109, epcRating: "C", priceChanges: [{ date: "2026-10-16", price: 700000 }],
  });
  // "Added on": a listing date; no band given; "EPC RATING C" in its features.
  assert.deepEqual(v2(read("94199202")), {
    tenure: "leasehold", propertyType: "flat", leaseYearsRemaining: 101, epcRating: "C", listedOn: "2026-10-12",
  });
  // A freehold's "0 years" is no lease figure.
  assert.deepEqual(v2(read("92497806")), {
    tenure: "freehold", propertyType: "semi-detached", councilTaxBand: "E", epcRating: "D",
    priceChanges: [{ date: "2026-10-14", price: 1750000 }],
  });
});

/** Zoopla streams its data as Next.js chunks; an earlier listing's data (client-side navigation) comes first. */
function zooplaPage(data: Record<string, any>, id: string): PageSnapshot {
  const chunk = (text: string) => `self.__next_f.push(${JSON.stringify([1, text])})`;
  const stale = { ...data.analyticsTaxonomy, listingId: 1, propertyType: "detached", epcRating: "A" };
  const listing = (taxonomy: unknown) =>
    `7b:["$","$L8f",null,{"epc":{"image":null},"analyticsTaxonomy":${JSON.stringify(taxonomy)},` +
    `"ntsInfo":${JSON.stringify(data.ntsInfo)},"derived":{"buyerIncentives":null}}]\n`;
  return page(`https://www.zoopla.co.uk/for-sale/details/${id}/`, {
    jsonLd: [JSON.stringify({ "@type": "BreadcrumbList" }), JSON.stringify(data.ld)],
    scripts: [chunk(listing(stale)), "var x = 1;", chunk(listing(data.analyticsTaxonomy)),
      chunk(`80:["$","div",null,{"staticWidgets":[],"priceHistory":${JSON.stringify(data.priceHistory)}}]\n`)],
  });
}

test("Zoopla v2: analytics summary, material information, JSON-LD date and the latest price change", () => {
  const z = fixture("zoopla.json");
  assert.deepEqual(v2(readListing(zooplaPage(z["74027384"], "74027384"))), {
    tenure: "leasehold", propertyType: "flat", councilTaxBand: "C", leaseYearsRemaining: 111, epcRating: "B",
    listedOn: "2026-08-20", priceChanges: [{ date: "2026-09-15", price: 450000 }],
  });
  assert.deepEqual(v2(readListing(zooplaPage(z["67222934"], "67222934"))), {
    tenure: "leasehold", propertyType: "flat", serviceChargeYearly: 5291, groundRentYearly: 480, leaseYearsRemaining: 238,
    listedOn: "2024-04-28",
  });
  assert.deepEqual(v2(readListing(zooplaPage(z["73421491"], "73421491"))), {
    tenure: "leasehold", propertyType: "flat", epcRating: "D", listedOn: "2026-07-14",
    priceChanges: [{ date: "2026-09-25", price: 650000 }],
  });
});

test("OnTheMarket v2: key information, humanised type and EPC; no dates on the page", () => {
  const otm = fixture("onthemarket.json");
  const read = (id: string) => readListing(page(`https://www.onthemarket.com/details/${id}/`, { nextData: JSON.stringify(otm[id]) }));
  assert.deepEqual(v2(read("18872270")), {
    tenure: "leasehold", propertyType: "flat", councilTaxBand: "D", serviceChargeYearly: 4399, groundRentYearly: 405, epcRating: "B",
  });
  assert.deepEqual(v2(read("19344065")), {
    tenure: "leasehold", propertyType: "flat", councilTaxBand: "D", leaseYearsRemaining: 112, epcRating: "C",
  });
  assert.deepEqual(v2(read("19520649")), { tenure: "unknown", propertyType: "flat" });
});

test("SpareRoom and OpenRent v2: only the kind of home", () => {
  const { spareroom, openrent } = fixture("spareroom-openrent.json");
  const sr = (id: string) => readListing(page(`https://www.spareroom.co.uk/flatshare/london/hackney/${id}`,
    { scripts: [spareroomScript({ id }), spareroom[id]] }));
  assert.deepEqual(v2(sr("17106996")), { tenure: "unknown", propertyType: "flat" });
  assert.deepEqual(v2(sr("16647628")), { tenure: "unknown" }); // a plain "house" is no kind

  const or = (id: string) => readListing(page(`https://www.openrent.co.uk/property-to-rent/london/x/${id}`,
    { title: openrent[id], mapData: { ...OPENRENT_MAP, mapLoadLocation: `/listing/justmapandstreetview/${id}` } }))?.propertyType;
  assert.deepEqual(["3067386", "3066986", "3035419", "3066681"].map(or), ["flat", "semi-detached", "terraced", "flat"]);
});

test("v2 parsing helpers", () => {
  assert.deepEqual(["Detached Bungalow", "End of Terrace", "detached_house", "Town House", "Land", 7].map(propertyTypeOf),
    ["bungalow", "terraced", "detached", null, "other", null]);
  assert.deepEqual(["Band D", "c", "TBC", "Ask agent", "J"].map(councilTaxBandOf), ["D", "C", null, null, null]);
  assert.deepEqual(["EPC Rating = C", "EPC: b", "EPC rating TBC", "Energy efficient", "e"].map(epcRatingOf), ["C", "B", null, null, "E"]);
  assert.deepEqual([3494, "£120 per month", "£1,000 per quarter", "Ask agent", "£0"].map(yearlyAmountOf), [3494, 1440, 4000, null, 0]);
  assert.deepEqual([109, 0, "Leasehold (Ask agent)", "Leasehold | 99 yrs left"].map((v) => leaseYearsOf(v)), [109, null, null, 99]);
  const today = new Date(2026, 9, 18, 9);
  assert.deepEqual(["Reduced on 31/02/2026", "Added today", "Reduced yesterday", "2024-04-28T20:04:29"].map((v) => isoDateOf(v, today)),
    [null, "2026-10-18", "2026-10-17", "2024-04-28"]);
});

// Local memory of listings seen on this device.

function fakeStore(): Store & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const LISTING: ListingFacts = {
  portal: "rightmove", listingId: "90000001", url: "https://www.rightmove.co.uk/properties/90000001", address: null,
  lat: null, lng: null, postcode: null, market: "buy", askingPrice: 600000, bedrooms: 2, floorAreaSqm: null, tenure: "unknown",
};
const day = (d: number) => new Date(2026, 9, d, 12).getTime();

test("memory: first seen, then only real price changes, merged with the page's own (page wins a day)", async () => {
  const store = fakeStore();
  assert.deepEqual(await remember(store, LISTING, day(1)),
    { firstSeen: { date: "2026-10-01", price: 600000 }, priceChanges: [] });
  assert.deepEqual((await remember(store, LISTING, day(2))).priceChanges, []);
  await remember(store, { ...LISTING, askingPrice: 575000 }, day(5));
  const seen = await remember(store, { ...LISTING, askingPrice: 560000,
    priceChanges: [{ date: "2026-10-05", price: 576000 }, { date: "2026-09-20", price: 610000 }] }, day(9));
  assert.deepEqual(seen, {
    firstSeen: { date: "2026-10-01", price: 600000 },
    priceChanges: [{ date: "2026-09-20", price: 610000 }, { date: "2026-10-05", price: 576000 }, { date: "2026-10-09", price: 560000 }],
  });
  // No price, nothing new remembered; another listing is its own.
  assert.deepEqual(await remember(store, { ...LISTING, listingId: "2", askingPrice: null }, day(9)), { firstSeen: null, priceChanges: [] });
  assert.deepEqual(Object.keys(store.data[MEMORY_KEY] as object), ["rightmove:90000001"]);
});

test("memory: at most 500 listings, the longest unseen dropped; at most 20 changes, oldest first", async () => {
  const store = fakeStore();
  for (let i = 0; i <= MEMORY_LIMIT; i++) await remember(store, { ...LISTING, listingId: String(i) }, day(1) + i);
  const kept = Object.keys(store.data[MEMORY_KEY] as object);
  assert.equal(kept.length, MEMORY_LIMIT);
  assert.ok(!kept.includes("rightmove:0") && kept.includes(`rightmove:${MEMORY_LIMIT}`));

  const points = Array.from({ length: 25 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, price: 1000 + i }));
  const merged = mergeChanges(points.slice(10), points.slice(0, 12).reverse());
  assert.equal(merged.length, 20);
  assert.deepEqual([merged[0].date, merged[19].date], ["2026-01-06", "2026-01-25"]);
});
