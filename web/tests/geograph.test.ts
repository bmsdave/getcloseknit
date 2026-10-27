import assert from "node:assert/strict";
import test from "node:test";

import { parseGeographLinks } from "../src/lib/geograph";

function photo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "4015171",
    title: "The Nelsons' drinking fountain next to St Thomas Square",
    photographer: "Marathon",
    pageUrl: "https://www.geograph.org.uk/photo/4015171",
    profileUrl: "https://www.geograph.org.uk/profile/43806",
    taken: "2014-05-28",
    metres: 36,
    ...overrides,
  };
}

test("parseGeographLinks keeps the credit and the Geograph page", () => {
  assert.deepEqual(parseGeographLinks({ photos: [photo()] }, new Set(), 4), [{
    id: "4015171",
    title: "The Nelsons' drinking fountain next to St Thomas Square",
    photographer: "Marathon",
    pageUrl: "https://www.geograph.org.uk/photo/4015171",
    metres: 36,
  }]);
});

test("parseGeographLinks drops incomplete or off-site photos and ones already shown from Commons", () => {
  const links = parseGeographLinks({
    photos: [
      photo({ id: "1", photographer: "" }),
      photo({ id: "2", pageUrl: "https://example.com/photo/2" }),
      photo({ id: "3", metres: "far" }),
      photo({ id: "4914", pageUrl: "https://www.geograph.org.uk/photo/4914" }),
      photo({ id: "5", pageUrl: "https://www.geograph.org.uk/photo/5" }),
    ],
  }, new Set(["4914"]), 4);
  assert.deepEqual(links.map((link) => link.id), ["5"]);
});

test("parseGeographLinks stops at the limit and survives junk", () => {
  assert.equal(parseGeographLinks({ photos: [photo(), photo(), photo()] }, new Set(), 2).length, 2);
  assert.deepEqual(parseGeographLinks(null, new Set(), 4), []);
  assert.deepEqual(parseGeographLinks({ photos: "nope" }, new Set(), 4), []);
});
