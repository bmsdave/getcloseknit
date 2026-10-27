import assert from "node:assert/strict";
import test from "node:test";

import { GUIDE_SLUGS } from "../src/lib/guide-slugs";
import { HELP } from "../src/lib/help-texts";

// (?) bubbles stay short and plain: method detail lives in the guide.
test("every help text is one to three short sentences linked to a guide article", () => {
  for (const [id, help] of Object.entries(HELP)) {
    const sentences = help.short.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length >= 1 && sentences.length <= 3, `${id}: ${sentences.length} sentences`);
    assert.ok(help.short.split(/\s+/).length <= 60, `${id}: over 60 words`);
    assert.ok((GUIDE_SLUGS as readonly string[]).includes(help.guide), `${id}: unknown guide ${help.guide}`);
  }
});
