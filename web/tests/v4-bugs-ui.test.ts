import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { moneyFieldText } from "../src/components/money-input";
import { barColour, compareRow } from "../src/lib/compare-table";
import { parseMoneyInput } from "../src/lib/housing-cost";

const css = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

// v4 Task 30: the winner's bar is coloured, every other bar is neutral, whatever its column.
test("compare bars mark the row's winner, not the column", () => {
  const row = compareRow("Crime", "low", true, [{ text: "98", value: 98 }, { text: "62", value: 62 }, { text: "80", value: 80 }]);
  assert.deepEqual(row.cells.map((cell) => barColour(cell.best)), ["var(--chart-neutral)", "var(--chart-good)", "var(--chart-neutral)"]);
  const tie = compareRow("Schools", "high", true, [{ text: "2", value: 2 }, { text: "2", value: 2 }]);
  assert.ok(tie.cells.every((cell) => barColour(cell.best) === "var(--chart-neutral)"));
});

// v4 Task 30: the Places | Schools | Homes switch is its own grid, not .segmented (which match-panel.css
// turns into a wrapping flex row that collapsed it).
test("the compare switch never borrows .segmented", () => {
  assert.doesNotMatch(readFileSync(new URL("../src/components/compare-view.tsx", import.meta.url), "utf8"), /compare-kinds segmented/);
  assert.match(css("styles/compare.css"), /\.compare-kinds \{[^}]*display: grid/);
});

// v4 Task 31: pounds are text with commas, read back from "£520,000", "520k" or "0.5m".
test("money fields show commas and read pounds back", () => {
  assert.equal(moneyFieldText(525000), "525,000");
  assert.equal(moneyFieldText(525000, true), "£525,000");
  assert.equal(moneyFieldText(null), "");
  for (const text of ["525,000", "£525,000", "525000", "525k"]) assert.equal(parseMoneyInput(text), 525000, text);
  assert.equal(parseMoneyInput("0.5m"), 500000);
  assert.equal(parseMoneyInput(""), null);
});

// v4 Task 31: no price field is type=number any more.
test("price fields are never type=number", () => {
  assert.doesNotMatch(css("components/referencing-check.tsx"), /type="number"/);
  const sales = css("components/sales-panel.tsx");
  assert.match(sales, /<MoneyInput className="knit-field" value=\{view\.filters\.minPrice\}/);
  assert.match(sales, /<MoneyInput className="knit-field" value=\{view\.filters\.maxPrice\}/);
  assert.doesNotMatch(sales, /type="number"/);
  assert.match(css("components/tools-shell.tsx"), /prefix === "£" \?/);
});

// v4 Task 31: zero-specificity knit bases replace the browser's grey buttons and native ticks.
test("knit-ui.css dresses bare buttons, tick-boxes and radios", () => {
  const ui = css("styles/knit-ui.css");
  assert.match(ui, /:where\(button:not\(\[class\]\)/);
  assert.match(ui, /:where\(input\[type="checkbox"\]:not\(\.tools-toggle, \[role="switch"\]\), input\[type="radio"\]/);
  assert.match(ui, /appearance: none/);
  assert.doesNotMatch(ui.slice(ui.indexOf("v4 Task 31")), /#[0-9a-f]{3,6}\b/i, "tokens only");
});
