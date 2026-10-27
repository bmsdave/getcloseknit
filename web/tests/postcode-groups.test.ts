import assert from "node:assert/strict";
import test from "node:test";

import type { AddressHistory, AddressSale } from "../src/lib/contracts";
import { addressPlace, cleanAddress, distinctDisclaimers, groupByBuilding, LONG_GROUP_ROWS } from "../src/lib/postcode-groups";

const DISCLAIMER = "Recorded achieved sale prices, not valuations or asking prices.";

function history(id: string, displayAddress: string, transactions: AddressSale[]): AddressHistory {
  return {
    addressId: `uk:addr:${id.padStart(12, "0")}` as AddressHistory["addressId"], displayAddress, postcode: "E3 2DA",
    geographyId: "uk:lsoa:E01004229", saleCount: transactions.length, coordinatesPrecision: "postcode",
    transactions, estimateDisclaimer: DISCLAIMER, sourceVersion: "test",
  };
}

const sale = (date: string, nominalPrice: number, floor: number | null = null): AddressSale => ({
  date, nominalPrice, floorAreaSquareMetres: floor,
});

test("repeated address parts are said once", () => {
  assert.equal(cleanAddress("17 Coborn Road, London, London, E3 2DA"), "17 Coborn Road, London, E3 2DA");
  assert.equal(cleanAddress("Flat 3, Oval House Rushcroft Road, London, London, SW2 1JU"), "Flat 3, Oval House Rushcroft Road, London, SW2 1JU");
});

test("an address names its building and the home inside it", () => {
  assert.deepEqual(addressPlace("Flat 3, Oval House Rushcroft Road, London, London, SW2 1JU", "SW2 1JU"),
    { key: "oval house rushcroft road", building: "Oval House Rushcroft Road", home: "Flat 3", line: "Flat 3, Oval House Rushcroft Road" });
  assert.deepEqual(addressPlace("11b Coborn Road, London, E3 2DA", "E3 2DA"),
    { key: "11 coborn road", building: "11 Coborn Road", home: "11b Coborn Road", line: "11b Coborn Road" });
  assert.equal(addressPlace("5th And 6th Floors, British Telecom, 3 Harbour Exchange Square, London, E14 9GE", "E14 9GE").building,
    "3 Harbour Exchange Square");
  assert.equal(addressPlace("10 Sample Street, Westminster, London, SW1A 1AB", "SW1A 1AB").line, "10 Sample Street, Westminster");
});

test("sales group by building; empty columns and long groups are folded away", () => {
  const groups = groupByBuilding([
    history("1", "11b Coborn Road, London, E3 2DA", [sale("2020-01-01", 400_000)]),
    history("2", "11 Coborn Road, London, London, E3 2DA", [sale("2010-05-01", 250_000), sale("2019-03-01", 1_250_000)]),
    history("3", "2 Coborn Road, London, E3 2DA", [sale("2021-01-01", 500_000, 50)]),
  ], "E3 2DA");

  assert.deepEqual(groups.map((group) => group.title), ["2 Coborn Road", "11 Coborn Road"]);
  const [two, eleven] = groups;
  assert.equal(two.hasFloorArea, true);
  assert.equal(two.summary, "1 sale, 2021 · £500k");
  assert.equal(eleven.hasFloorArea, false);
  assert.equal(eleven.homes, 2);
  assert.equal(eleven.summary, "2 homes · 3 sales, 2010–2020 · £250k to £1.25m");
  // Homes in street order, each home's newest sale first; the home cell spans its sales.
  assert.deepEqual(eleven.rows.map((row) => [row.home, row.sale.date, row.first, row.span]), [
    ["11 Coborn Road", "2019-03-01", true, 2],
    ["11 Coborn Road", "2010-05-01", false, 2],
    ["11b Coborn Road", "2020-01-01", true, 1],
  ]);
  assert.equal(eleven.long, false);
  assert.equal(eleven.folded, false);

  const block = groupByBuilding(Array.from({ length: LONG_GROUP_ROWS + 1 }, (_, index) =>
    history(String(index + 10), `Flat ${index + 1}, Oval House Rushcroft Road, London, London, SW2 1JU`, [sale("2015-01-01", 300_000)])), "SW2 1JU");
  assert.equal(block.length, 1);
  assert.equal(block[0].title, "Oval House Rushcroft Road");
  assert.equal(block[0].long, true);
  assert.equal(block[0].folded, true);

  // Many buildings: each starts folded, so the page opens as an index of summaries.
  const street = groupByBuilding(Array.from({ length: 5 }, (_, index) =>
    history(String(index + 40), `${index + 1} Coborn Road, London, E3 2DA`, [sale("2015-01-01", 300_000)])), "E3 2DA");
  assert.deepEqual(street.map((group) => group.folded), [true, true, true, true, true]);
  assert.deepEqual(block[0].rows.slice(0, 3).map((row) => row.home), ["Flat 1", "Flat 2", "Flat 3"]);
});

test("a disclaimer shared by every address is listed once", () => {
  const histories = [history("1", "1 A Road, London, E3 2DA", []), history("2", "2 A Road, London, E3 2DA", [])];
  assert.deepEqual(distinctDisclaimers(histories), [DISCLAIMER]);
});
