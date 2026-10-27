import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { newFeedbackId } from "../src/lib/feedback";

test("a review's id is a UUID v4", () => {
  assert.match(newFeedbackId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("the form's reasons follow the rating: what worked at 4 and 5, what got in the way below", async () => {
  const { reasonsFor } = await import("../src/components/feedback-form");
  assert.equal(reasonsFor(5).title, "What worked well?");
  assert.equal(reasonsFor(4).title, "What worked well?");
  assert.equal(reasonsFor(3).title, "What got in the way?");
  assert.equal(reasonsFor(1).title, "What got in the way?");
  assert.deepEqual(reasonsFor(4).tags.map((reason) => reason.label), ["Easy to use", "Useful data", "Found good areas", "Looks good", "Fast"]);
  assert.deepEqual(reasonsFor(2).tags.map((reason) => reason.tag), ["hard_to_use", "missing_data", "wrong_data", "not_covered", "slow", "broken"]);
});

// v3 Fix 22: one way to send feedback (the /feedback form from the menu, and each figure's Report):
// no quick 👍/👎 vote and no global prompt anywhere in the app.
test("no quick vote or feedback prompt is left in the app", () => {
  const src = join(import.meta.dirname, "../src");
  const files = (readdirSync(src, { recursive: true }) as string[]).filter((file) => /\.(tsx?|css)$/.test(file));
  for (const file of files) {
    const text = readFileSync(join(src, file), "utf8");
    assert.doesNotMatch(text, /<QuickVote\b|<FeedbackPrompt\b|<WelcomeBackCard\b|<ComparisonDialog\b|<BriefDialog\b/, file);
  }
});
