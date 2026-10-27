import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AskingPriceCheck, askingPriceAnswer, bandPosition, parseAskingPrice, relativeTo, type AskingBasis,
} from "../src/components/asking-price-check";
import { askingBasis } from "../src/components/property-profile";
import { postcodeAskingBasis } from "../src/components/postcode-visuals";
import { demoPropertyProfile } from "../src/lib/property-profile-fixture";
import type { PostcodeSummary } from "../src/lib/postcode-visuals";

test("asking prices parse from what people type or paste from a listing", () => {
  assert.equal(parseAskingPrice("650000"), 650_000);
  assert.equal(parseAskingPrice(" £650,000 "), 650_000);
  assert.equal(parseAskingPrice("650k"), 650_000);
  assert.equal(parseAskingPrice("1.25m"), 1_250_000);
  assert.equal(parseAskingPrice(""), null);
  assert.equal(parseAskingPrice("abc"), null);
  assert.equal(parseAskingPrice("650"), null, "too small to be a home price");
  assert.equal(parseAskingPrice("-650000"), null);
});

test("the percentage and the middle-half position are plain maths", () => {
  assert.equal(relativeTo(660_000, 600_000), "10% above");
  assert.equal(relativeTo(540_000, 600_000), "10% below");
  assert.equal(relativeTo(601_000, 600_000), "about the same as");
  assert.equal(bandPosition(9_000, { p25: 9_400, p75: 13_900 }), "below");
  assert.equal(bandPosition(9_400, { p25: 9_400, p75: 13_900 }), "inside");
  assert.equal(bandPosition(14_000, { p25: 9_400, p75: 13_900 }), "above");
});

const basis: AskingBasis = {
  reference: { price: 600_000, words: "the latest recorded sale (£600k, 2024)" },
  band: { p25: 9_400, p75: 13_900, per: "m2", what: "local £/m²" },
  floorArea: 50,
};

test("the answer sets the asking price against a recorded sale and local £/m²", () => {
  const answer = askingPriceAnswer(720_000, basis);
  assert.equal(answer?.sentence,
    "£720,000 is 20% above the latest recorded sale (£600k, 2024) and above the middle half of local £/m² (£9,400–£13,900/m²).");
  assert.equal(answer?.perArea, "At 50 m², that is £14,400/m².");
});

test("without a floor area there is no £/m² half, only the sale", () => {
  const answer = askingPriceAnswer(570_000, { ...basis, floorArea: null });
  assert.equal(answer?.sentence, "£570,000 is 5% below the latest recorded sale (£600k, 2024).");
  assert.equal(answer?.perArea, null);
  assert.equal(askingPriceAnswer(570_000, { reference: null, band: basis.band, floorArea: null }), null);
});

test("a price band compares the price itself (the postcode page)", () => {
  const answer = askingPriceAnswer(500_000, { reference: null, band: { p25: 710_000, p75: 1_150_000, per: "price", what: "recent sale prices in St James's" } });
  assert.equal(answer?.sentence, "£500,000 is below the middle half of recent sale prices in St James's (£710k–£1.15m).");
});

test("the property page's basis is the recorded sale and the area's same-type range, never an estimate", () => {
  const profile = demoPropertyProfile("100000000001")!.profile;
  const built = askingBasis(profile);
  assert.equal(built.reference?.price, profile.sales.at(-1)?.price);
  assert.equal(built.reference?.words, "this home's last recorded sale (£570k, 3 Nov 2022)");
  assert.deepEqual(built.band, { p25: 520_000, p75: 760_000, per: "price", what: "flat sales here, adjusted to Jun 2026" });
  assert.equal(built.floorArea, undefined, "no per-home floor area");
  assert.equal(askingPriceAnswer(650_000, built)?.sentence,
    "£650,000 is 14% above this home's last recorded sale (£570k, 3 Nov 2022) and inside the middle half of flat sales here, adjusted to Jun 2026 (£520k–£760k).");
  const thin = askingBasis(demoPropertyProfile("100000000012")!.profile);
  assert.equal(thin.band, null, "no range below 5 sales");
  assert.equal(thin.reference?.price, 1_150_000);
});

test("a postcode uses its own typical price only for one kind of recent sale, else the area's", () => {
  const typical = { value: 440_000, basis: "recent" as const, count: 6, fromYear: 2021, toYear: 2025 };
  const summary = { typicalPrice: typical, blended: false } as PostcodeSummary;
  const area = { medianPrice: 887_000, p25: 710_000, p75: 1_150_000 };
  assert.equal(postcodeAskingBasis(summary, "St James's", area).reference?.words,
    "the typical recent price here (~£440k, middle of 6 sales, 2021–2025)");
  const mixed = postcodeAskingBasis({ ...summary, blended: true }, "St James's", area);
  assert.equal(mixed.reference?.words, "the typical price in St James's now (~£887k)");
  assert.deepEqual(mixed.band, { p25: 710_000, p75: 1_150_000, per: "price", what: "recent sale prices in St James's" });
  assert.equal(postcodeAskingBasis({ ...summary, blended: true }, "X", null).reference, null);
});

test("the check says it is not a valuation and never what a home is worth", () => {
  const html = renderToStaticMarkup(createElement(AskingPriceCheck, { basis }));
  assert.match(html, /Not a valuation\./);
  assert.match(html, /inputMode="numeric"|inputmode="numeric"/);
  assert.match(html, /knit-field/);
  assert.doesNotMatch(html, /worth|value of this home/i);
  assert.equal(renderToStaticMarkup(createElement(AskingPriceCheck, { basis: { reference: null, band: null } })), "");
});
