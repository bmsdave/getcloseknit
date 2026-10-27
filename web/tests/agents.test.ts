import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_SAMPLE_PROMPT, AGENT_TABS, agentPath, isAgentSlug } from "../src/lib/agents";
import { searchItems } from "../src/lib/match-search";
import { decodeSharedProfile, exampleSearchHref } from "../src/lib/profile-state";

test("/agents has the five tabs in the design's order, Claude on /agents itself", () => {
  assert.deepEqual(AGENT_TABS.map((tab) => tab.label), ["Claude", "ChatGPT", "Codex", "Any agent"]);
  assert.equal(agentPath("claude"), "/agents");
  assert.equal(agentPath("any"), "/agents/any");
  assert.ok(isAgentSlug("codex"));
  assert.ok(!isAgentSlug("gemini"));
});

// CUJ-07 v4: "Example search →" opens the sample prompt's search in My match (the #profile= link an agent hands back),
// not a /brief of three City of London areas over its own £600k budget.
test("the example search is the sample prompt's own search as a #profile= link, inside its budget", () => {
  const href = exampleSearchHref();
  assert.ok(href.startsWith("/?layer=personal-match#profile="), href);
  const profile = decodeSharedProfile(href.slice(href.indexOf("#")));
  assert.ok(profile);
  assert.equal(profile.market, "buy");
  assert.equal(profile.bedrooms, 2);
  assert.equal(profile.maximumBudget, 600_000);
  const items = searchItems(profile);
  // The budget is a Must: every area the example shows is within £600k.
  assert.deepEqual(items.find((item) => item.id === "affordability")?.must, true);
  const place = items.find((item) => item.criterion.kind === "place")?.criterion;
  assert.equal(place?.kind === "place" && place.label, "King's Cross");
  assert.equal(place?.kind === "place" && place.targetMinutes, 30);
  assert.match(AGENT_SAMPLE_PROMPT, /£600k.*30 minutes of King's Cross/);
});
