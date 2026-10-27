import assert from "node:assert/strict";
import test from "node:test";

import { SDLT_ENGLAND_2026_10_05 as TABLE, calculateStampDuty, type SdltBuyer } from "../src/lib/stamp-duty";

const MOVER: Omit<SdltBuyer, "price"> = { firstTimeBuyer: false, additionalProperty: false, nonUkResident: false };
const sdlt = (price: number, flags: Partial<SdltBuyer> = {}) => calculateStampDuty({ ...MOVER, price, ...flags });

test("the table is the one in force on 2026-10-05, contiguous, with gov.uk sources", () => {
  assert.equal(TABLE.inForceOn, "2026-10-05");
  for (const bands of [TABLE.standard, TABLE.firstTimeBuyer]) {
    assert.equal(bands[0].from, 0);
    bands.slice(1).forEach((band, index) => assert.equal(band.from, bands[index].to));
  }
  assert.equal(TABLE.standard.at(-1)?.to, null);
  assert.ok(TABLE.sources.length >= 2);
  for (const source of TABLE.sources) assert.match(source.url, /^https:\/\/www\.gov\.uk\//);
});

test("gov.uk worked example: £295,000 home mover pays £4,750", () => {
  // 0% × 125,000 + 2% × 125,000 (£2,500) + 5% × 45,000 (£2,250).
  const result = sdlt(295_000);
  assert.equal(result.total, 4_750);
  assert.deepEqual(result.bands.map((band) => band.tax), [0, 2_500, 2_250, 0, 0]);
  assert.deepEqual(result.bands.map((band) => band.taxable), [125_000, 125_000, 45_000, 0, 0]);
  assert.equal(result.regime, "standard");
});

test("gov.uk worked example: £500,000 first-time buyer pays £10,000", () => {
  // 0% × 300,000 + 5% × 200,000.
  const result = sdlt(500_000, { firstTimeBuyer: true });
  assert.equal(result.regime, "first-time-buyer");
  assert.equal(result.total, 10_000);
  assert.equal(result.effectiveRatePct, 2);
});

test("first-time buyer relief is lost entirely above £500,000", () => {
  // Standard: 2% × 125,000 (£2,500) + 5% × 250,001 (£12,500.05) → £15,000 (rounded down).
  const result = sdlt(500_001, { firstTimeBuyer: true });
  assert.equal(result.regime, "standard");
  assert.equal(result.total, 15_000);
  assert.match(result.notes.join(" "), /stops above £500,000/);
});

test("£1.6m home mover uses all five bands: £105,750", () => {
  // £2,500 + 5% × 675,000 (£33,750) + 10% × 575,000 (£57,500) + 12% × 100,000 (£12,000).
  const result = sdlt(1_600_000);
  assert.deepEqual(result.bands.map((band) => band.tax), [0, 2_500, 33_750, 57_500, 12_000]);
  assert.equal(result.total, 105_750);
});

test("additional property adds 5 points to every band: £300,000 → £20,000", () => {
  // 5% × 125,000 (£6,250) + 7% × 125,000 (£8,750) + 10% × 50,000 (£5,000).
  const result = sdlt(300_000, { additionalProperty: true });
  assert.equal(result.surchargePct, 5);
  assert.deepEqual(result.bands.slice(0, 3).map((band) => band.ratePct), [5, 7, 10]);
  assert.equal(result.total, 20_000);
});

test("non-UK resident adds 2 points: £295,000 → £10,650", () => {
  // 2% × 125,000 (£2,500) + 4% × 125,000 (£5,000) + 7% × 45,000 (£3,150).
  assert.equal(sdlt(295_000, { nonUkResident: true }).total, 10_650);
});

test("both surcharges stack: £500,000 additional and non-resident → £50,000", () => {
  // 7% × 125,000 (£8,750) + 9% × 125,000 (£11,250) + 12% × 250,000 (£30,000).
  const result = sdlt(500_000, { additionalProperty: true, nonUkResident: true });
  assert.equal(result.surchargePct, 7);
  assert.equal(result.total, 50_000);
});

test("non-resident first-time buyer keeps relief plus 2%: £400,000 → £13,000", () => {
  // 2% × 300,000 (£6,000) + 7% × 100,000 (£7,000).
  const result = sdlt(400_000, { firstTimeBuyer: true, nonUkResident: true });
  assert.equal(result.regime, "first-time-buyer");
  assert.equal(result.total, 13_000);
});

test("a first-time buyer who will own another home pays standard plus surcharge", () => {
  // 5% × 125,000 (£6,250) + 7% × 75,000 (£5,250).
  const result = sdlt(200_000, { firstTimeBuyer: true, additionalProperty: true });
  assert.equal(result.regime, "standard");
  assert.equal(result.total, 11_500);
  assert.match(result.notes.join(" "), /does not apply when you will own another home/);
});

test("the additional-property surcharge does not apply under £40,000", () => {
  const result = sdlt(30_000, { additionalProperty: true });
  assert.equal(result.surchargePct, 0);
  assert.equal(result.total, 0);
  assert.match(result.notes.join(" "), /below £40,000/);
  assert.equal(sdlt(40_000, { additionalProperty: true }).total, 2_000);
});

test("tax is rounded down to the whole pound", () => {
  // 2% × 99 = £1.98 → £1.
  assert.equal(sdlt(125_099).total, 1);
});

test("zero price is zero tax; a negative price is rejected", () => {
  assert.equal(sdlt(0).total, 0);
  assert.equal(sdlt(0).effectiveRatePct, 0);
  assert.throws(() => sdlt(-1), /price/);
  assert.throws(() => sdlt(Number.NaN), /price/);
});
