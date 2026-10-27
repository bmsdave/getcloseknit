import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { watchPrompt } from "../src/components/watch-listings";
import { assistantUrl } from "../src/lib/discuss";
import { savedAreaMeta } from "../src/lib/saved-panel";
import { fixtureStandouts } from "../src/lib/standouts-fixture";
import { readStandouts } from "../src/lib/standouts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// Finding: MSOA selections (ranking "On map", Search "Areas") showed the old price header and chip bar.
test("a wider neighbourhood (MSOA) has the one area view's verdict, tags and 12 tiles", () => {
  const msoa = fixtureStandouts("uk:msoa:E02000001");
  assert.ok(msoa);
  assert.equal(msoa.carrier, "msoa");
  assert.ok(readStandouts(msoa, "demo"));
  assert.equal(msoa.tiles.length, 12);
  assert.ok(msoa.verdict.length > 0);
  // Its tags stay "of London" (a borough's say "of boroughs").
  assert.ok(msoa.tags.every((tag) => !tag.text.endsWith("of boroughs")));
  assert.match(read("../src/components/area-standouts.tsx"), /\^uk:\(lsoa\|msoa\|lad\):/);
});

// CUJ14 v4: each saved area with its £/m².
test("a saved area's line carries its £/m², a borough says so", () => {
  assert.equal(savedAreaMeta("uk:lsoa:E01000001", "£8,900/m²"), "£8,900/m²");
  assert.equal(savedAreaMeta("uk:lad:E09000001", "£9,600/m²"), "Borough · £9,600/m²");
  assert.equal(savedAreaMeta("uk:lsoa:E01000001", undefined), undefined);
});

// CUJ12 v4: the watch prompt carries the sheet's search; Open in Claude / ChatGPT has it filled in.
test("the watch prompt carries market, price and beds and opens prefilled in an assistant", () => {
  const prompt = watchPrompt("St James's · SW1A", { market: "buy", maxPrice: 650_000, minBedrooms: 2 });
  assert.match(prompt, /^Using Close Knit, watch for new homes for sale in St James's · SW1A, up to £650,000, 2\+ beds\./);
  assert.match(watchPrompt("SW1A 1AB", { market: "rent", maxPrice: 2_500, minBedrooms: null }), /homes to rent in SW1A 1AB, up to £2,500 a month\./);
  assert.equal(assistantUrl("claude", "a b"), "https://claude.ai/new?q=a%20b");
  assert.equal(assistantUrl("chatgpt", "a b"), "https://chatgpt.com/?q=a%20b");
});

// Watch is the shared MapSheet, never a centred modal.
test("Watch opens in the shared MapSheet", () => {
  const source = read("../src/components/watch-listings.tsx");
  assert.match(source, /<MapSheet id=\{id\} title="Watch new homes"/);
  assert.doesNotMatch(source, /showModal|<dialog/);
});

// Flags, not cuts (FLAGS.md): the old card's Like it · Not for me · Note stay in code, off by default.
test("the area view's marks are kept behind a default-off flag", () => {
  assert.match(read("../src/components/match/area-marks.tsx"), /MATCH_FLAGS[^=]*= \{ AREA_MARKS: false \}/);
  assert.match(read("../src/components/close-knit.tsx"), /MATCH_FLAGS\.AREA_MARKS &&/);
  assert.match(read("../../FLAGS.md"), /`AREA_MARKS`/);
});
