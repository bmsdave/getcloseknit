import assert from "node:assert/strict";
import test from "node:test";

import { ornamentGrid } from "../src/lib/ornaments";

test("an ornament band is knitted stitch by stitch with no empty cells, so its edge has no gaps", () => {
  for (const kind of ["town", "fairisle", "selbu"] as const) {
    const grid = ornamentGrid(kind, 104);
    assert.equal(grid.length, 3 + 15 + 3, `${kind}: peerie, motif band, peerie`);
    assert.ok(grid.every((row) => row.length === 104 && row.every((cell) => cell !== null)), `${kind}: every cell is a stitch`);
  }
  const town = JSON.stringify(ornamentGrid("town"));
  assert.ok(town.includes("var(--logo-window)"), "windows light up at night");
  assert.ok(JSON.stringify(ornamentGrid("selbu")).includes("var(--handle-yarn)"), "Selbu roses in snow-white yarn");
});
