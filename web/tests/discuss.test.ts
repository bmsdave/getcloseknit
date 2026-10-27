import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { discussUrl, searchLink } from "../src/lib/discuss";
import { decodeSharedProfile } from "../src/lib/profile-state";

test("the discuss link carries the search the assistant can reopen", () => {
  const profile = structuredClone({ ...DEFAULT_PROFILE, marks: { liked: ["uk:lsoa:E01000001" as const], excluded: [], notes: {} } });
  const link = searchLink("https://areas.example.org/", profile, "uk:lsoa:E01000001");
  assert.ok(link.startsWith("https://areas.example.org/?layer=personal-match&selected=uk%3Alsoa%3AE01000001#profile=v1."));
  assert.deepEqual(decodeSharedProfile(link.slice(link.indexOf("#"))), profile);

  const claude = new URL(discussUrl("claude", "https://areas.example.org", profile, null));
  assert.equal(claude.origin + claude.pathname, "https://claude.ai/new");
  assert.match(claude.searchParams.get("q")!, /open_shared_search/);
  assert.match(claude.searchParams.get("q")!, /#profile=v1\./);
  assert.equal(new URL(discussUrl("chatgpt", "https://areas.example.org", profile, null)).origin, "https://chatgpt.com");
});
