import assert from "node:assert/strict";
import test from "node:test";

import { buildAreaComparison } from "../src/lib/area-comparison";
import type { GeographyId } from "../src/lib/contracts";
import { buildDecisionBrief, renderBriefMarkdown } from "../src/lib/decision-brief";
import { METRICS } from "../src/lib/fixtures";
import { buildMatchPack } from "../src/lib/matching";
import { UNSHARED_BUDGET } from "../src/lib/saved-shortlists";
import { weightedProfile } from "./weighted-profile";

const NORTH: GeographyId = "uk:lsoa:E01000002";
const SOUTH: GeographyId = "uk:lsoa:E01000003";

// v4 Task 38: a brief opened from a link without its budget names no limit anywhere.
test("a brief without its budget says so and prints no limit", () => {
  const profile = { ...weightedProfile(), targetBudget: UNSHARED_BUDGET, maximumBudget: UNSHARED_BUDGET };
  const pack = buildMatchPack(profile);
  const brief = buildDecisionBrief({
    profile, comparison: buildAreaComparison(pack, [NORTH, SOUTH], profile, { redactBudget: true }), comparisonError: null,
    candidates: [], viewing: [], costs: null, metrics: METRICS,
    redaction: { includeDestinations: false, includeNotes: false, includeBudget: false },
  });
  const markdown = renderBriefMarkdown(brief);
  assert.match(markdown, /Budget not shared\./);
  assert.doesNotMatch(markdown, /100,000,000|£100m|limit/);
  for (const verdict of brief.verdicts) assert.doesNotMatch(verdict.price, /limit/);
});

test("with its budget the brief still grades prices against the limit", () => {
  const profile = weightedProfile();
  const pack = buildMatchPack(profile);
  const brief = buildDecisionBrief({
    profile, comparison: buildAreaComparison(pack, [NORTH, SOUTH], profile), comparisonError: null,
    candidates: [], viewing: [], costs: null, metrics: METRICS,
    redaction: { includeDestinations: false, includeNotes: false },
  });
  assert.doesNotMatch(renderBriefMarkdown(brief), /Budget not shared/);
});
