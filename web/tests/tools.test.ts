import assert from "node:assert/strict";
import test from "node:test";

import type { AddressHistory, PropertySummary, SaleRecord } from "../src/lib/contracts";
import { NOT_ADVICE, TOOLS, checkHomeHref, readCheckHome, readPrefill, toolHref, toolPrefill } from "../src/lib/tools";

test("toolHref carries a rounded price and its source", () => {
  assert.equal(toolHref("stamp-duty"), "/tools/stamp-duty");
  assert.equal(
    toolHref("investor", { price: 425_000.4, from: "  12 Example Road,\n NW10 " }),
    "/tools/investor?price=425000&from=12+Example+Road%2C+NW10",
  );
});

test("toolHref drops a bad price and a source without a price", () => {
  assert.equal(toolHref("stamp-duty", { price: 0, from: "Area" }), "/tools/stamp-duty");
  assert.equal(toolHref("stamp-duty", { price: Number.NaN }), "/tools/stamp-duty");
});

test("readPrefill accepts a sane price and ignores junk", () => {
  assert.deepEqual(readPrefill({ price: "425000", from: "Kensal Green" }), { price: 425_000, from: "Kensal Green", sold: null });
  assert.deepEqual(readPrefill({ price: ["300000", "1"] }), { price: 300_000, from: null, sold: null });
  assert.deepEqual(readPrefill({ price: "-5", from: "x" }), { price: null, from: null, sold: null });
  assert.deepEqual(readPrefill({ price: "abc" }), { price: null, from: null, sold: null });
  assert.deepEqual(readPrefill({ price: "1e12" }), { price: null, from: null, sold: null });
  assert.equal(readPrefill({ price: "1", from: "a".repeat(200) }).from?.length, 80);
});

test("every tool is listed and the notice says it is not financial advice", () => {
  assert.deepEqual(TOOLS.map((tool) => tool.slug), ["stamp-duty", "mortgage-rates", "investor", "check-a-home"]);
  assert.match(NOT_ADVICE, /^Not financial advice\./);
});

test("checkHomeHref links an area, a home and a price; bad values are dropped", () => {
  assert.equal(checkHomeHref(), "/tools/check-a-home");
  assert.equal(
    checkHomeHref({ area: "uk:lsoa:E01000001", uprn: "100023336956", price: 450_000, from: "Kensal Green" }),
    "/tools/check-a-home?area=uk%3Alsoa%3AE01000001&uprn=100023336956&price=450000&from=Kensal+Green",
  );
  assert.equal(checkHomeHref({ area: "uk:lad:E09000033" as never, uprn: "12ab", price: -1 }), "/tools/check-a-home");
});

test("readCheckHome keeps a valid area and home and works without them", () => {
  assert.deepEqual(readCheckHome({}), { price: null, from: null, sold: null, area: null, uprn: null });
  assert.deepEqual(
    readCheckHome({ area: "uk:lsoa:E01000001", uprn: "123", price: "300000", from: "Area" }),
    { price: 300_000, from: "Area", sold: null, area: "uk:lsoa:E01000001", uprn: "123" },
  );
  assert.deepEqual(readCheckHome({ area: "<script>", uprn: "1".repeat(13) }), { price: null, from: null, sold: null, area: null, uprn: null });
});

test("toolPrefill: a chosen home's money tools start from its own last sale, never the area's price", () => {
  const sale = (nominalPrice: number) => ({ date: "2022-11-03", nominalPrice, floorAreaSquareMetres: 54 });
  const record = { address: "1 Example Road", geographyId: "uk:lsoa:E01000001", sourceVersion: "v", transactions: [sale(280_000), sale(570_000)] } as SaleRecord;
  const stock = { displayAddress: "1 Example Road, NW10", lastSale: { ...sale(560_000), period: "2022-11" } } as PropertySummary;
  const address = { displayAddress: "Flat block, NW10", transactions: [sale(400_000)] } as unknown as AddressHistory;
  assert.deepEqual(toolPrefill(record, stock, address), { price: 570_000, from: "1 Example Road", sold: "2022-11" });
  assert.deepEqual(toolPrefill(null, stock, address), { price: 560_000, from: "1 Example Road, NW10", sold: "2022-11" });
  assert.deepEqual(toolPrefill({ ...record, transactions: [] }, null, address), { price: 400_000, from: "Flat block, NW10", sold: "2022-11" });
  // No recorded sale: the links carry no price rather than borrowing the area's.
  assert.deepEqual(toolPrefill(null, null, null), {});
  assert.equal(toolHref("stamp-duty", toolPrefill(null, null, null)), "/tools/stamp-duty");
});
