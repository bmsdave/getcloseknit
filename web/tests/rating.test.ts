import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NO_RATING, RATING_TREND_MIN_SAMPLE, ratingLabel, ratingModel, ratingScore, trendView } from "../src/lib/rating";

test("score and band: p = 0, 50, 100 and null", () => {
  assert.deepEqual([0, 50, 100].map((p) => ratingScore(p, true)), [1, 5, 10]);
  assert.equal(ratingScore(null, true), null);
  assert.deepEqual([0, 50, 100].map((p) => ratingModel(p, true).band), ["Well below London", "Middle", "Top 10%"]);
  const none = ratingModel(null, true);
  assert.deepEqual([none.score, none.steps, none.band, none.tone, none.position], [null, 0, NO_RATING, "none", null]);
  assert.equal(ratingModel(Number.NaN, true).band, NO_RATING);
});

test("every band boundary: ceil(p/10), 1–2 well below … 9 top 20%, 10 top 10%", () => {
  const cases: [number, number, string][] = [[10, 1, "Well below London"], [11, 2, "Well below London"], [21, 3, "Below"], [41, 5, "Middle"],
    [61, 7, "Above"], [80, 8, "Above"], [81, 9, "Top 20%"], [90, 9, "Top 20%"], [91, 10, "Top 10%"]];
  for (const [p, score, band] of cases) {
    const model = ratingModel(p, true);
    assert.equal(model.score, score, `p=${p}`);
    assert.equal(model.band, band, `p=${p}`);
  }
  // Out-of-range or non-finite input is not a London percentile: no rating, never a guess.
  assert.equal(ratingScore(140, true), null);
  assert.equal(ratingScore(-5, true), null);
  assert.equal(ratingModel(140, true).band, NO_RATING);
  assert.equal(ratingModel(-5, null).tone, "none");
  assert.equal(ratingModel(Number.POSITIVE_INFINITY, true).band, NO_RATING);
});

test("lower is better flips the percentile, so 10 is the best", () => {
  assert.deepEqual([0, 50, 100].map((p) => ratingScore(p, false)), [10, 5, 1]);
  const safe = ratingModel(26, false);
  assert.equal(safe.score, 8);
  assert.equal(safe.share, 74);
  assert.equal(safe.position, 0.74);
  assert.equal(safe.tone, 4);
});

test("the colour step follows the band: 1 bad … 5 good", () => {
  assert.deepEqual([5, 25, 55, 75, 95].map((p) => ratingModel(p, true).tone), [1, 2, 3, 4, 5]);
});

test("higherIsBetter = null is neutral: no score, neutral tone, plain position", () => {
  const price = ratingModel(83, null);
  assert.equal(price.score, null);
  assert.equal(price.tone, "neutral");
  assert.equal(price.steps, 9);
  assert.equal(price.position, 0.83);
  assert.equal(ratingScore(83, null), null);
  assert.equal(ratingModel(null, null).tone, "none");
});

test("neutral shows the comparison on screen, never a merit band word", () => {
  assert.equal(ratingModel(83, null, "pricier").band, "pricier than 83% of London");
  assert.equal(ratingModel(95, null).band, "higher than 95% of London");
  assert.notEqual(ratingModel(95, null, "pricier").band, "Top 10%");
});

test("trend: direction, sign and good/bad colour from goodWhenUp", () => {
  assert.deepEqual(trendView({ pct: 4.2, period: "2025", goodWhenUp: true }),
    { direction: "up", text: "+4% vs 2025", spoken: "up 4% vs 2025", tone: "good" });
  assert.equal(trendView({ pct: -6, period: "last year", goodWhenUp: true })?.tone, "bad");
  assert.equal(trendView({ pct: -6, period: "last year", goodWhenUp: false })?.tone, "good");
  assert.equal(trendView({ pct: 6, period: "last year", goodWhenUp: null })?.tone, "neutral");
  assert.equal(trendView({ pct: -6, period: "2025", goodWhenUp: false })?.text, "−6% vs 2025");
  assert.deepEqual(trendView({ pct: 0.3, period: "2025", goodWhenUp: true }),
    { direction: "flat", text: "0% vs 2025", spoken: "no change vs 2025", tone: "neutral" });
  assert.equal(trendView(undefined), null);
  assert.equal(trendView({ pct: Number.NaN, period: "2025", goodWhenUp: true }), null);
});

test("trend is suppressed below the minimum sample of 10", () => {
  assert.equal(RATING_TREND_MIN_SAMPLE, 10);
  assert.equal(trendView({ pct: 12, period: "2025", goodWhenUp: true, n: 9 }), null);
  assert.equal(trendView({ pct: 12, period: "2025", goodWhenUp: true, n: 0 }), null);
  assert.notEqual(trendView({ pct: 12, period: "2025", goodWhenUp: true, n: 10 }), null);
  assert.notEqual(trendView({ pct: 12, period: "2025", goodWhenUp: true }), null); // no sample size given: not a sales trend
});

test("aria-label reads the score, the comparison and the trend", () => {
  assert.equal(
    ratingLabel({ label: "Safety", percentile: 26, higherIsBetter: false, comparative: "safer", trend: { pct: -6, period: "last year", goodWhenUp: false } }),
    "Safety 8 out of 10, safer than 74% of London, down 6% vs last year",
  );
  assert.equal(ratingLabel({ label: "Getting around", percentile: 62, higherIsBetter: true }), "Getting around 7 out of 10, better than 62% of London");
  assert.equal(ratingLabel({ label: "Price", percentile: 83, higherIsBetter: null, comparative: "pricier", trend: { pct: 3, period: "2025", goodWhenUp: null } }),
    "Price: pricier than 83% of London, up 3% vs 2025");
  assert.equal(ratingLabel({ label: "Quiet", percentile: null, higherIsBetter: true, fact: "58 dB road noise", trend: { pct: 5, period: "2025", goodWhenUp: true } }),
    "Quiet: no rating, 58 dB road noise, up 5% vs 2025");
  assert.equal(ratingLabel({ label: "Market activity", percentile: null, higherIsBetter: null, trend: { pct: -8, period: "2025", goodWhenUp: null, n: 40 } }),
    "Market activity: no rating, down 8% vs 2025");
  assert.equal(ratingLabel({ label: "Market", percentile: 50, higherIsBetter: true, trend: { pct: 20, period: "2025", goodWhenUp: true, n: 4 } }),
    "Market 5 out of 10, better than 50% of London");
});

test("the ramp uses chart tokens defined in every theme, and no green", () => {
  const css = readFileSync(new URL("../src/styles/rating.css", import.meta.url), "utf8");
  for (const tone of [1, 2, 3, 4, 5, "neutral", "none"]) {
    if (tone !== "neutral") assert.match(css, new RegExp(`\\.rating\\[data-tone="${tone}"\\]`), `tone ${tone}`);
  }
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, "colours come from tokens only");
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /green|olive/i);
  const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  for (const token of ["--chart-bad", "--chart-good", "--chart-neutral"]) {
    assert.equal(globals.match(new RegExp(`${token}:`, "g"))?.length, 3, `${token} in Day, Night and system Night`);
  }
});
