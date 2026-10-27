import assert from "node:assert/strict";
import test from "node:test";

import { normalisePostcode, planPostcodePage, postcodeSlug } from "../src/lib/postcode-page";

test("postcode slugs round-trip through the canonical outward/inward form", () => {
  assert.equal(normalisePostcode("sw1a-2dr"), "SW1A 2DR");
  assert.equal(normalisePostcode("SW1A2DR"), "SW1A 2DR");
  assert.equal(normalisePostcode(" sw1a  2dr "), "SW1A 2DR");
  assert.equal(normalisePostcode("not a postcode"), null);
  assert.equal(normalisePostcode("E1"), null);
  assert.equal(postcodeSlug("SW1A 2DR"), "SW1A-2DR");
});

test("a postcode page lists the postcode's addresses and links the area they sit in", () => {
  const plan = planPostcodePage("SW1A 2DR", [
    { id: "a", label: "1 - 4 Charing Cross, London, SW1A 2DR", secondaryLabel: "SW1A 2DR · 1 recorded sales",
      geographyId: "uk:lsoa:E01004736", uprn: null, addressId: "uk:addr:bec5bbe9422c", center: [0, 51] },
    { id: "b", label: "Westminster 018C", secondaryLabel: "E01004736 · lsoa",
      geographyId: "uk:lsoa:E01004736", uprn: null, addressId: null, center: [0, 51] },
    { id: "c", label: "9 Elsewhere Road, London, SW1A 2DX", secondaryLabel: "SW1A 2DX · 3 recorded sales",
      geographyId: "uk:lsoa:E01004736", uprn: null, addressId: "uk:addr:000000000001", center: [0, 51] },
  ], null);

  assert.deepEqual(plan.addresses.map((address) => address.addressId), ["uk:addr:bec5bbe9422c"]);
  assert.equal(plan.geography, "uk:lsoa:E01004736");
  assert.equal(plan.areaName, "Westminster 018C");
});

test("with no address the postcode lookup supplies the area; with nothing at all the page is unknown", () => {
  const fromLookup = planPostcodePage("SW1A 1AA", [], { area: { carrier: "lsoa", code: "E01004736" }, areaName: "Westminster" });
  assert.equal(fromLookup.geography, "uk:lsoa:E01004736");
  assert.equal(fromLookup.areaName, "Westminster");
  assert.deepEqual(fromLookup.addresses, []);
  assert.equal(planPostcodePage("ZZ9 9ZZ", [], null).geography, null);
});
