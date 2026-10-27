import assert from "node:assert/strict";
import test from "node:test";

import dataset from "../src/lib/mortgage-rates-boe.json";
import {
  formatMonth,
  latestComplete,
  parseIadbCsv,
  rateChart,
  spreadOverBankRate,
  type RateDataset,
} from "../src/lib/mortgage-rates";
import { buildDataset } from "../src/lib/mortgage-rates-refresh";

const CSV = [
  "DATE,IUMABEDR,IUMBV34,IUMBV37,IUMBV42",
  "31 Dec 1995,6.5,7,7.5,8",
  "31 Jan 1996,6.25,6.7,7.08,7.87",
  "29 Feb 1996,6,,6.9,7.5",
  "31 Mar 1996,5.75,6.2,6.5,7",
  "30 Apr 1996,5.75,,,",
].join("\n");

test("parseIadbCsv keeps months from 1996, turns blanks into null and dates into YYYY-MM", () => {
  const points = parseIadbCsv(CSV);
  assert.deepEqual(points.map((point) => point.month), ["1996-01", "1996-02", "1996-03", "1996-04"]);
  assert.deepEqual(points[0], { month: "1996-01", bankRate: 6.25, fixed2: 6.7, fixed3: 7.08, fixed5: 7.87 });
  assert.equal(points[1].fixed2, null);
  assert.equal(points[3].fixed5, null);
});

test("parseIadbCsv finds columns by series code, whatever the order", () => {
  const reordered = "DATE,IUMBV42,IUMABEDR,IUMBV37,IUMBV34\n31 Jan 1996,7.87,6.25,7.08,6.7";
  assert.deepEqual(parseIadbCsv(reordered)[0], parseIadbCsv(CSV)[0]);
});

test("parseIadbCsv rejects a CSV without the expected header or series", () => {
  assert.throws(() => parseIadbCsv("When,IUMABEDR\n"), /DATE/);
  assert.throws(() => parseIadbCsv("DATE,IUMABEDR,IUMBV34,IUMBV37\n"), /IUMBV42/);
  assert.throws(() => parseIadbCsv("DATE,IUMABEDR,IUMBV34,IUMBV37,IUMBV42\n1996-01-31,1,2,3,4"), /unrecognised/);
});

test("latestComplete skips months the Bank has not filled in yet", () => {
  assert.equal(latestComplete(parseIadbCsv(CSV))?.month, "1996-03");
  assert.equal(latestComplete([]), null);
});

test("spread over Bank Rate: 7.87% five-year fixed − 6.25% Bank Rate = 1.62 points", () => {
  const [january, february] = parseIadbCsv(CSV);
  assert.equal(spreadOverBankRate(january, "fixed5"), 1.62);
  assert.equal(spreadOverBankRate(february, "fixed2"), null);
});

test("rateChart puts 0% on the baseline and breaks lines at missing months", () => {
  const points = parseIadbCsv(CSV).slice(0, 3);
  // Highest rate 7.87 → axis top 8 (step 2). Plot is 80 × 50 starting at (10, 5).
  const chart = rateChart(points, { width: 100, height: 60, left: 10, right: 10, top: 5, bottom: 5 });
  assert.equal(chart.maxRate, 8);
  assert.deepEqual(chart.yTicks.map((tick) => [tick.value, tick.y]), [[0, 55], [2, 42.5], [4, 30], [6, 17.5], [8, 5]]);
  const fixed2 = chart.lines.find((line) => line.key === "fixed2");
  // 6.7% → y = 55 − 6.7/8 × 50 = 13.1 at x = 10; February is missing, so March (6.2% → 16.3) starts a new segment.
  assert.deepEqual(fixed2?.segments, ["10,13.1", "90,16.3"]);
  const bank = chart.lines.find((line) => line.key === "bankRate");
  // 6.25 → 15.9, 6 → 17.5, 5.75 → 19.1; x = 10, 50, 90 (rounded to 0.1).
  assert.deepEqual(bank?.segments, ["10,15.9 50,17.5 90,19.1"]);
});

test("rateChart x ticks mark every fifth January", () => {
  const points = Array.from({ length: 121 }, (_, index) => ({
    month: `${1996 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
    bankRate: 1, fixed2: 2, fixed3: 3, fixed5: 4,
  }));
  const chart = rateChart(points, { width: 130, height: 50, left: 5, right: 5, top: 0, bottom: 0 });
  assert.deepEqual(chart.xTicks.map((tick) => tick.label), ["2000", "2005"]);
  assert.equal(chart.xTicks[0].x, 5 + (48 / 120) * 120);
});

test("formatMonth reads as a short month and year", () => {
  assert.equal(formatMonth("2026-08"), "Aug 2026");
});

test("buildDataset records the source, licence and retrieval date", () => {
  const built = buildDataset(CSV, "2026-10-05");
  assert.equal(built.meta.retrieved, "2026-10-05");
  assert.match(built.meta.licence, /Open Government Licence/);
  assert.match(built.meta.url, /SeriesCodes=IUMABEDR,IUMBV34,IUMBV37,IUMBV42/);
  assert.equal(built.points.length, 4);
});

test("the committed Bank of England data runs monthly from Jan 1996 without gaps", () => {
  const data = dataset as RateDataset;
  assert.equal(data.meta.retrieved, "2026-10-05");
  assert.equal(data.points[0].month, "1996-01");
  data.points.forEach((point, index) => {
    const year = 1996 + Math.floor(index / 12);
    assert.equal(point.month, `${year}-${String((index % 12) + 1).padStart(2, "0")}`);
  });
  const latest = latestComplete(data.points);
  assert.deepEqual(latest, { month: "2026-08", bankRate: 3.75, fixed2: 4.92, fixed3: 4.77, fixed5: 4.78 });
});
