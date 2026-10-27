import assert from "node:assert/strict";
import test from "node:test";

import type { SearchResult, StreetMatch } from "../src/lib/fixtures";
import {
  isPostcodeQuery,
  kindOf,
  noMatchMessage,
  parsePostcodeLookup,
  postcodeHref,
  searchGroups,
  searchOptions,
  searchResultHref,
  searchWithPostcodeFallback,
  streetHref,
  tidyAddressLabel,
} from "../src/lib/postcode-search";

function searchResult(id: SearchResult["geographyId"], label: string): SearchResult {
  return {
    id,
    label,
    secondaryLabel: "real geography",
    geographyId: id,
    uprn: null,
    addressId: null,
    center: [-0.1, 51.5],
  };
}

const POSTCODES_IO_BODY: {
  status: number;
  result: {
    postcode: string;
    longitude: number;
    latitude: number;
    lsoa: string;
    msoa: string;
    admin_district: string;
    codes: Record<string, string | null>;
  };
} = {
  status: 200,
  result: {
    postcode: "SE1 7PB",
    longitude: -0.089,
    latitude: 51.503,
    lsoa: "Southwark 001A",
    msoa: "Southwark 001",
    admin_district: "Southwark",
    codes: {
      admin_district: "E09000028",
      lsoa: "E01000003",
      msoa: "E02000003",
      lsoa11: "E01000003",
      msoa11: "E02000003",
      lsoa21: "E01000004",
      msoa21: "E02000004",
    },
  },
};

test("postcode-shaped queries are detected and area names are not", () => {
  for (const query of ["SE1 7PB", "se17pb", "E8 4BX", "M1 1AA", "W1A 0AX"]) {
    assert.equal(isPostcodeQuery(query), true, query);
  }
  for (const query of ["Camden", "E8", "SE1", "", "12345"]) {
    assert.equal(isPostcodeQuery(query), false, query);
  }
});

test("postcode lookup prefers the 2021 LSOA code", () => {
  const found = parsePostcodeLookup(POSTCODES_IO_BODY);

  assert.deepEqual(found?.area, { carrier: "lsoa", code: "E01000004" });
  assert.equal(found?.postcode, "SE1 7PB");
  assert.deepEqual([found?.longitude, found?.latitude], [-0.089, 51.503]);
});

test("postcode lookup falls back to MSOA, then borough, then nothing", () => {
  const withoutLsoa = structuredClone(POSTCODES_IO_BODY);
  withoutLsoa.result.codes.lsoa21 = null;
  withoutLsoa.result.codes.lsoa = null;
  withoutLsoa.result.codes.lsoa11 = null;
  assert.deepEqual(parsePostcodeLookup(withoutLsoa)?.area, { carrier: "msoa", code: "E02000004" });

  const boroughOnly = structuredClone(POSTCODES_IO_BODY);
  for (const key of ["lsoa", "lsoa11", "lsoa21", "msoa", "msoa11", "msoa21"] as const) {
    boroughOnly.result.codes[key] = null;
  }
  assert.deepEqual(parsePostcodeLookup(boroughOnly)?.area, { carrier: "lad", code: "E09000028" });

  assert.equal(parsePostcodeLookup({ status: 404, result: null }), null);
  assert.equal(parsePostcodeLookup({}), null);
});

test("direct upstream hits never trigger a postcode lookup", async () => {
  let lookups = 0;
  const results = await searchWithPostcodeFallback({
    query: "SE1 7PB",
    searchUpstream: async () => [searchResult("uk:lsoa:E01000003", "South Bank")],
    lookupPostcode: async () => {
      lookups += 1;
      return null;
    },
  });

  assert.equal(results.length, 1);
  assert.equal(lookups, 0);
});

test("empty upstream results resolve a postcode through its LSOA code", async () => {
  const searched: string[] = [];
  const results = await searchWithPostcodeFallback({
    query: "SE1 7PB",
    searchUpstream: async (query) => {
      searched.push(query);
      return query === "E01000004" ? [searchResult("uk:lsoa:E01000004", "Southwark 001A")] : [];
    },
    lookupPostcode: async () => parsePostcodeLookup(POSTCODES_IO_BODY),
  });

  assert.deepEqual(searched, ["SE1 7PB", "E01000004"]);
  assert.equal(results[0]?.geographyId, "uk:lsoa:E01000004");
  // The row reads as the postcode that was typed, with its area as detail.
  assert.equal(results[0]?.label, "SE1 7PB");
  assert.match(results[0]?.secondaryLabel ?? "", /^Southwark 001A/);
});

test("an unknown postcode code still selects its coordinates", async () => {
  const results = await searchWithPostcodeFallback({
    query: "SE1 7PB",
    searchUpstream: async () => [],
    lookupPostcode: async () => parsePostcodeLookup(POSTCODES_IO_BODY),
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.geographyId, "uk:lsoa:E01000004");
  assert.equal(results[0]?.label, "SE1 7PB");
  assert.deepEqual(results[0]?.center, [-0.089, 51.503]);
});

test("non-postcode queries and failed lookups stay empty", async () => {
  const empty = await searchWithPostcodeFallback({
    query: "Camden",
    searchUpstream: async () => [],
    lookupPostcode: async () => {
      throw new Error("must not be called");
    },
  });
  assert.deepEqual(empty, []);

  const failed = await searchWithPostcodeFallback({
    query: "SE1 7PB",
    searchUpstream: async () => [],
    lookupPostcode: async () => null,
  });
  assert.deepEqual(failed, []);
});

test("search offers a full postcode's page first, then its addresses without the doubled town", () => {
  const address: SearchResult = {
    id: "uk:addr:1", label: "Flat 16, Kinross House Bemerton Estate, London, London, N1 0AA", secondaryLabel: "N1 0AA · 1 recorded sales",
    geographyId: "uk:lsoa:E01002715", uprn: null, addressId: "uk:addr:1" as SearchResult["addressId"], center: [-0.12, 51.54],
  };
  const options = searchOptions("n1 0aa", [address]);
  assert.equal(options[0].label, "N1 0AA");
  assert.equal(options[0].secondaryLabel, "Prices & sales");
  assert.equal(options[0].href, "/postcode/N1-0AA");
  assert.equal(options[1].label, "Flat 16, Kinross House Bemerton Estate, London, N1 0AA");
  assert.equal(options[1].secondaryLabel, "N1 0AA · 1 recorded sale");
  assert.ok(options.every((option) => !option.label.includes("London, London")));
  assert.equal(postcodeHref("E3 2DA"), "/postcode/E3-2DA");
  assert.equal(postcodeHref("Canonbury"), null);
  assert.equal(tidyAddressLabel("124 Meadvale Road, London, London, W5 1LR"), "124 Meadvale Road, London, W5 1LR");
});

test("areas collapse to one row per neighbourhood name, with no ONS codes or official names", () => {
  const area = (id: SearchResult["geographyId"], label: string, secondary: string): SearchResult => ({
    id, label, secondaryLabel: secondary, geographyId: id, uprn: null, addressId: null, center: [-0.09, 51.54],
  });
  const options = searchOptions("Canonbury", [
    area("uk:msoa:E02000567", "Canonbury East & Mildmay Park · N1", "Islington 014 · E02000567"),
    area("uk:lsoa:E01002716", "Canonbury East & Mildmay Park · N1", "Islington 014A · E01002716"),
    area("uk:lsoa:E01002780", "Canonbury East & Mildmay Park · N5", "Islington 014F · E01002780"),
    area("uk:lsoa:E01002717", "Islington 016A", "E01002717 · lsoa"),
    area("uk:lad:E09000019", "Islington", "E09000019 · borough"),
  ]);
  assert.deepEqual(options.map((option) => option.label), ["Canonbury East & Mildmay Park · N1", "Islington"]);
  assert.equal(options[0].geographyId, "uk:msoa:E02000567", "the MSOA stands for its LSOAs");
  assert.equal(options[1].geographyId, "uk:lad:E09000019", "the borough wins over an unnamed LSOA in it");
  const text = options.map((option) => `${option.label} ${option.secondaryLabel}`).join(" ");
  assert.doesNotMatch(text, /E0\d|\d{3}[A-Z]\b/);
});

test("a postcode nothing confirms is never offered as a page: the box says so instead", () => {
  assert.deepEqual(searchOptions("ZZ9 9ZZ", []), []);
  // An unrelated hit (a street that happens to match) does not confirm the postcode either.
  const elsewhere = searchResult("uk:lsoa:E01000001", "Zetland Street · E14");
  assert.ok(searchOptions("ZZ9 9ZZ", [elsewhere]).every((option) => !option.href));
  // The lookup's own row ("SW1A 1AA") or an address in it does.
  assert.equal(searchOptions("sw1a1aa", [searchResult("uk:lsoa:E01000001", "SW1A 1AA")])[0].href, "/postcode/SW1A-1AA");
  assert.equal(noMatchMessage("zz99zz"), "We can't find ZZ9 9ZZ — check it, or try a street or area name.");
  assert.equal(noMatchMessage(" Narnia "), "Nothing matches “Narnia”.");
});

test("a partial postcode offers the full postcodes its results name, up to five (G33)", () => {
  const home = (label: string, secondary: string): SearchResult => ({
    ...searchResult("uk:lsoa:E01004736", label), id: label, secondaryLabel: secondary,
    addressId: `uk:addr:${label.length}` as SearchResult["addressId"],
  });
  const results = [
    home("10 Cleveland Row, London, SW1A 1AA", "SW1A 1AA · 2 recorded sales"),
    home("11 Cleveland Row, London, SW1A 1AA", "SW1A 1AA · 1 recorded sale"),
    home("1 Charing Cross, London, SW1A 1AB", "SW1A 1AB · 1 recorded sale"),
    home("2 Sample Street, London, SW1E 5AA", "SW1E 5AA · 1 recorded sale"),
  ];
  const pages = searchOptions("SW1A", results).filter((option) => option.kind === "postcode");
  assert.deepEqual(pages.map((option) => [option.label, option.href]), [
    ["SW1A 1AA", "/postcode/SW1A-1AA"],
    ["SW1A 1AB", "/postcode/SW1A-1AB"],
  ]);
  // A sector keeps its own inward digit; anything that is not a partial postcode offers none.
  assert.deepEqual(searchOptions("sw1a 1", results).filter((option) => option.kind === "postcode").length, 2);
  assert.deepEqual(searchOptions("sw1a 2", results).filter((option) => option.kind === "postcode"), []);
  assert.deepEqual(searchOptions("Cleveland", results).filter((option) => option.kind === "postcode"), []);
  const many = Array.from({ length: 8 }, (_, index) => home(`${index} Row, SW1A ${index}AA`, ""));
  assert.equal(searchOptions("SW1A", many).filter((option) => option.kind === "postcode").length, 5);
});

test("options come grouped by kind: postcode pages first, then groups as the search ranked them", () => {
  const hackney = { ...searchResult("uk:lad:E09000012", "Hackney"), secondaryLabel: "E09000012 · borough" };
  const road = { ...searchResult("uk:lsoa:E01001750", "1 Hackney Road, London, E2 7NX"), id: "home",
    secondaryLabel: "E2 7NX · 1 recorded sale", addressId: "uk:addr:aaaaaaaaaaaa" as SearchResult["addressId"] };
  const station: SearchResult = { ...searchResult("uk:lsoa:E01001849", "Hackney"), id: "station:osm:n1",
    kind: "station", secondaryLabel: "Rail · Hackney", center: [-0.02, 51.54] };
  const school: SearchResult = { ...searchResult("uk:lsoa:E01001750", "Hackney New Primary School"), id: "school:142112",
    kind: "school", secondaryLabel: "Primary · Hackney", href: "/school/142112" };
  const park: SearchResult = { ...searchResult("uk:lsoa:E01001786", "Hackney Marshes"), id: "place:w1",
    kind: "place", secondaryLabel: "Park · Hackney" };
  const options = searchOptions("Hackney", [hackney, road, school, station, park]);
  assert.deepEqual(searchGroups(options).map((group) => group.label), ["Areas", "Homes", "Schools", "Stations", "Places"]);
  // A station named like an area stays its own row, not folded into the area.
  assert.equal(options.filter((option) => option.label === "Hackney").length, 2);
  assert.deepEqual(options.map((option) => kindOf(option)), ["lad", "address", "school", "station", "place"]);
  // A postcode page leads, whatever the search ranked first.
  const withPage = searchOptions("E2 7NX", [hackney, road]);
  assert.deepEqual(searchGroups(withPage).map((group) => group.label), ["Postcode", "Areas", "Homes"]);
  assert.deepEqual(searchGroups(withPage).flatMap((group) => group.options), withPage, "groups keep the options' order");
});

test("off the map, a result leads to its postcode, home or area page", () => {
  const area = searchResult("uk:msoa:E02000567", "Canonbury");
  assert.equal(searchResultHref(area), "/area/msoa/E02000567");
  assert.equal(searchResultHref({ ...area, uprn: "100000000001" }), "/property/100000000001");
  assert.equal(searchResultHref({ ...area, href: "/postcode/N1-0AA" }), "/postcode/N1-0AA");
  // A station or park opens the map at its point, with the area it is in chosen.
  const station: SearchResult = { ...searchResult("uk:lsoa:E01004750", "Victoria"), kind: "station", center: [-0.1448, 51.4965] };
  assert.equal(searchResultHref(station), "/?lat=51.4965&lng=-0.1448&zoom=15&selected=uk%3Alsoa%3AE01004750");
});

function streetResult(street: Partial<StreetMatch>): SearchResult {
  return {
    id: "uk:lsoa:E01000004", label: "120 Valley Road", secondaryLabel: "Kentish Town · Camden · likely NW5 1AA",
    geographyId: "uk:lsoa:E01000004", uprn: null, addressId: null, center: [-0.14, 51.55],
    street: { name: "Valley Road", number: 120, locality: "Kentish Town", borough: "Camden", postcodeDistrict: "NW5",
      likelyPostcode: null, neighbours: [], numberPostcodes: [], postcodes: [], ...street },
  };
}

test("an unsold home with a likely postcode opens that postcode's page, naming the home", () => {
  const [option, ...rest] = searchOptions("120 Valley Road", [streetResult({
    likelyPostcode: "NW5 1AA", neighbours: [118, 122], postcodes: ["NW5 1AA", "NW5 1AB"] })]);
  assert.equal(rest.length, 0);
  assert.equal(option.label, "120 Valley Road");
  assert.equal(option.secondaryLabel, "Likely NW5 1AA · Kentish Town, Camden · no recorded sale");
  assert.equal(option.href, "/property/at/NW5-1AA/120-valley-road");
  assert.equal(option.street, undefined);
});

test("without a likely postcode each of the street's postcodes is a row", () => {
  const options = searchOptions("130 Valley Road", [streetResult({
    number: 130, postcodes: ["NW5 1AA", "NW5 1AB", "NW5 1AC", "NW5 1AD", "NW5 1AE"] })]);
  assert.deepEqual(options.map((option) => option.label),
    ["Valley Road, NW5 1AA", "Valley Road, NW5 1AB", "Valley Road, NW5 1AC", "Valley Road, NW5 1AD"]);
  assert.equal(options[0].secondaryLabel, "No recorded sale for no. 130 · Kentish Town, Camden");
  assert.equal(options[1].href, "/property/at/NW5-1AB/130-valley-road");
  assert.equal(new Set(options.map((option) => option.id)).size, options.length);
});

test("a street without a number or recorded homes", () => {
  const [plain] = searchOptions("Valley Road", [streetResult({ number: null, postcodes: ["NW5 1AA"] })]);
  assert.equal(plain.label, "Valley Road, NW5 1AA");
  assert.equal(plain.secondaryLabel, "Street · Kentish Town, Camden");
  assert.equal(plain.href, "/postcode/NW5-1AA");
  const [bare] = searchOptions("120 New Lane", [streetResult({ name: "New Lane", borough: "Kentish Town" })]);
  assert.equal(bare.label, "120 New Lane");
  assert.equal(bare.secondaryLabel, "Street · Kentish Town · no recorded sales");
  assert.equal(bare.href, "/area/lsoa/E01000004");
  assert.equal(streetHref("NW5 1AA", { ...streetResult({}).street!, likelyPostcode: "NW5 1AB", neighbours: [118, 122] }),
    "/property/at/NW5-1AA/120-valley-road");
  assert.equal(streetHref("NW5 1AA", { ...streetResult({}).street!, number: null }), "/postcode/NW5-1AA");
});

test("flats sharing the number open their postcode without calling the home unsold", () => {
  const [option] = searchOptions("Flat 9, 122 Valley Road", [streetResult({
    number: 122, likelyPostcode: "NW5 1AA", neighbours: [122], postcodes: ["NW5 1AA"] })]);
  assert.equal(option.secondaryLabel, "Recorded homes at no. 122 in NW5 1AA · Kentish Town, Camden");
  assert.equal(option.href, "/postcode/NW5-1AA");
});

test("a tower's flats at one number get one row per postcode, never 'no recorded sale'", () => {
  const options = searchOptions("10 Marsh Wall, London E14", [streetResult({
    name: "Marsh Wall", number: 10, locality: null, borough: "Tower Hamlets", postcodeDistrict: "E14",
    likelyPostcode: null, neighbours: [10], numberPostcodes: ["E14 9GU", "E14 9PG"],
    postcodes: ["E14 9GU", "E14 9PG", "E14 9PR"] })]);
  assert.equal(options.length, 2);
  assert.deepEqual(options.map((option) => option.secondaryLabel), [
    "Recorded homes at no. 10 in E14 9GU · Tower Hamlets",
    "Recorded homes at no. 10 in E14 9PG · Tower Hamlets",
  ]);
  assert.ok(options.every((option) => !/no recorded sale/i.test(option.secondaryLabel)));
  assert.deepEqual(options.map((option) => option.href), ["/postcode/E14-9GU", "/postcode/E14-9PG"]);
});

test("several streets get one row each; a street's only postcode is said so", () => {
  const kenley = streetResult({ number: 130, borough: "Croydon", locality: null, postcodes: ["CR8 5BU", "CR8 5BY"] });
  const streatham = streetResult({ number: 130, borough: "Lambeth", locality: "Streatham", postcodes: ["SW16 2XR"] });
  const options = searchOptions("130 Valley Road", [kenley, streatham]);
  assert.deepEqual(options.map((option) => [option.label, option.secondaryLabel, option.href]), [
    ["130 Valley Road", "Croydon · no recorded sale", "/property/at/CR8-5BU/130-valley-road"],
    ["130 Valley Road", "Streatham, Lambeth · no recorded sale", "/property/at/SW16-2XR/130-valley-road"],
  ]);
});
