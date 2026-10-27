import assert from "node:assert/strict";
import test from "node:test";

import { areaPath, candidateFromListing, decodeListingFragment, nameForListing } from "../src/lib/listing-save";

test("the area's district is dropped when the listing's postcode is in another one (r3 #14)", () => {
  assert.equal(nameForListing("Strand, St James & Mayfair · W1D", "1 Example Street, London SW1A 1AA"), "Strand, St James & Mayfair");
  assert.equal(nameForListing("St James's · SW1A", "1 Example Street, London SW1A 1AA"), "St James's · SW1A");
  assert.equal(nameForListing("Hackney Central · E8", "Middleton Road, London, E8"), "Hackney Central · E8");
  assert.equal(nameForListing(null, "1 Example Street, SW1A 1AA"), null);
});

function fragment(payload: unknown): string {
  return "#listing=v1." + Buffer.from(JSON.stringify(payload)).toString("base64url");
}

const LISTING = {
  url: "https://www.rightmove.co.uk/properties/93384096", address: "Middleton Road, London, E8", market: "buy",
  askingPrice: 600000, bedrooms: 2, floorAreaSqm: null, geographyId: "uk:lsoa:E01035650", portal: "rightmove",
};

test("a listing fragment from the extension decodes to its public facts", () => {
  const listing = decodeListingFragment(fragment(LISTING));

  assert.deepEqual(listing, { ...LISTING, market: "buy" });
  const room = { ...LISTING, portal: "spareroom", url: "https://www.spareroom.co.uk/flatshare/london/hackney/19000001" };
  assert.equal(decodeListingFragment(fragment(room))?.portal, "spareroom");
});

test("anything but a portal listing is refused", () => {
  assert.equal(decodeListingFragment(fragment({ ...LISTING, url: "https://evil.example/x" })), null);
  assert.equal(decodeListingFragment(fragment({ ...LISTING, portal: "gumtree" })), null);
  assert.equal(decodeListingFragment("#listing=v1.%%%"), null);
  assert.equal(decodeListingFragment("#profile=v1.abc"), null);
});

test("the listing becomes an unverified candidate placed in its area", () => {
  const listing = decodeListingFragment(fragment(LISTING))!;
  const built = candidateFromListing(listing, [], "2026-10-14T10:00:00.000Z");

  assert.ok(built.ok);
  assert.equal(built.candidate.geographyId, "uk:lsoa:E01035650");
  assert.deepEqual(built.candidate.asking, {
    value: { kind: "sale", amount: 600000, unit: "gbp-total" }, verification: "unverified", observedAt: "2026-10-14T10:00:00.000Z",
  });
  assert.equal(built.candidate.referenceUrl?.value, LISTING.url);
});

test("saving the same listing twice is a duplicate, and rent is a monthly amount", () => {
  const listing = decodeListingFragment(fragment(LISTING))!;
  const first = candidateFromListing(listing, []);
  assert.ok(first.ok);
  assert.deepEqual(candidateFromListing(listing, [first.candidate]), { ok: false, reason: "duplicate-candidate" });

  const rent = candidateFromListing(decodeListingFragment(fragment({ ...LISTING, market: "rent", askingPrice: 2400 }))!, []);
  assert.ok(rent.ok);
  assert.equal(rent.candidate.asking?.value.unit, "gbp-per-month");
});

test("area paths follow the site's area pages", () => {
  assert.equal(areaPath("uk:lsoa:E01035650"), "/area/lsoa/E01035650");
});
