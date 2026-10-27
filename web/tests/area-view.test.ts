import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} not found`);
  return css.slice(start, css.indexOf("}", start));
};

// v4 Task 12: the map's sticky "Open full area page" row (the area view's footer) carries a rule on top, so
// it reads apart from what scrolls beneath it.
test("the sticky Open full area page row has a top border in a token colour", () => {
  assert.match(rule(read("../src/styles/area-brief.css"), ".match-sheet .area-brief__actions"), /border-top: 1px solid var\(--rule\)/);
});

// v4.4: My match opens the one area view (close-knit.tsx), never the old in-list card; MSOAs and boroughs read
// the same verdict, tags and tiles (no old "Price per square metre" header).
test("the old My match card and the wider area's price header are gone", () => {
  for (const gone of ["../src/components/match/selected-area.tsx", "../src/components/match/monthly-cost.tsx"]) {
    assert.throws(() => read(gone), /ENOENT/, gone);
  }
  assert.doesNotMatch(read("../src/components/personal-match-panel.tsx"), /<SelectedArea/);
  assert.doesNotMatch(read("../src/components/evidence-panel.tsx"), /AreaReading|area-reading/);
  assert.match(read("../src/components/close-knit.tsx"), /matchArea \? areaView\(false\) : matchPanelNode/);
});

// The dropped home-cost estimate stays in code behind a default-off flag listed in FLAGS.md (owner rule: flags, not cuts).
test("the home-cost estimate is behind a default-off flag listed in FLAGS.md", () => {
  const panel = read("../src/components/evidence-panel.tsx");
  assert.match(panel, /AREA_HOME_COST_ESTIMATE: false/);
  assert.match(panel, /PANEL_FLAGS\.AREA_HOME_COST_ESTIMATE && \(/);
  assert.match(read("../../FLAGS.md"), /\| `AREA_HOME_COST_ESTIMATE` .*\| `false` \|/);
});

// The old x/10 path is gone: no OverviewTiles, Rating component or Tailor slots left to come back by accident.
test("the old OverviewTiles path is deleted", () => {
  for (const gone of ["../src/components/rating.tsx", "../src/components/overview-badges.tsx", "../src/lib/overview-slots.ts"]) {
    assert.throws(() => read(gone), /ENOENT/, gone);
  }
  assert.doesNotMatch(read("../src/components/evidence-panel.tsx"), /<OverviewTiles|>Details ›</);
});
