import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_GROUPS, AGENT_SAMPLE_PROMPT, AGENT_TABS, agentCard, agentPath, cursorInstallHref, isAgentSlug, vscodeInstallHref,
} from "../src/lib/agents";
import { searchItems } from "../src/lib/match-search";
import { decodeSharedProfile, exampleSearchHref } from "../src/lib/profile-state";

const URLS = { mcp: "https://getcloseknit.com/mcp", openapi: "https://getcloseknit.com/openapi.json", llms: "https://getcloseknit.com/llms.txt" };

test("/agents picks from 14 apps in three rows, Claude on /agents itself", () => {
  assert.deepEqual(AGENT_GROUPS.map((group) => [group.label, group.slugs.map((slug) => AGENT_TABS.find((tab) => tab.slug === slug)!.label)]), [
    ["Chat", ["Claude", "ChatGPT", "Gemini", "Grok", "Perplexity", "Le Chat", "Manus"]],
    ["Code", ["Claude Code", "Codex", "Cursor", "VS Code", "Windsurf", "Gemini CLI"]],
    ["Other", ["Any agent"]],
  ]);
  assert.deepEqual(AGENT_TABS.map((tab) => tab.slug), AGENT_GROUPS.flatMap((group) => group.slugs));
  assert.equal(agentPath("claude"), "/agents");
  for (const slug of ["chatgpt", "codex", "any", "le-chat", "gemini-cli", "claude-code"] as const) assert.equal(agentPath(slug), `/agents/${slug}`);
  assert.ok(isAgentSlug("gemini"));
  assert.ok(!isAgentSlug("nope"));
});

test("every card has one action, steps and the MCP address; the owner's limit tags are on", () => {
  for (const { slug } of AGENT_TABS) {
    const card = agentCard(slug, URLS);
    assert.ok(card.action.copy || card.action.href, slug);
    assert.ok(card.steps.length > 0, slug);
    const values = [...card.fields.map((field) => field.value), ...card.snippets.map((snippet) => snippet.value), card.action.href ?? ""];
    assert.ok(values.some((value) => value.includes(URLS.mcp) || value.includes("close-knit")), slug);
  }
  assert.deepEqual(agentCard("gemini", URLS).tags, ["Personal accounts"]);
  assert.deepEqual(agentCard("manus", URLS).tags, []);
  assert.deepEqual(agentCard("perplexity", URLS).tags, ["Pro, Max, Enterprise"]);
  assert.deepEqual(agentCard("le-chat", URLS).tags, []);
  assert.equal(agentCard("perplexity", URLS).snippets[0].value, "https://github.com/bmsdave/getcloseknit/tree/main/agents/claude/plugin");
  assert.ok(agentCard("le-chat", URLS).fields.some((field) => field.value === "CloseKnit"));
  assert.equal(agentCard("gemini-cli", URLS).action.copy, "gemini extensions install https://github.com/bmsdave/getcloseknit");
  assert.deepEqual(agentCard("claude-code", URLS).snippets.map((snippet) => snippet.value), [
    "claude mcp add --transport http close-knit https://getcloseknit.com/mcp",
    "/plugin marketplace add bmsdave/getcloseknit\n/plugin install close-knit@close-knit",
  ]);
});

test("Cursor and VS Code install links carry the server config", () => {
  const cursor = new URL(cursorInstallHref(URLS.mcp));
  assert.equal(cursor.searchParams.get("name"), "close-knit");
  assert.deepEqual(JSON.parse(atob(cursor.searchParams.get("config")!)), { url: URLS.mcp });
  const vscode = vscodeInstallHref(URLS.mcp);
  assert.ok(vscode.startsWith("vscode:mcp/install?"));
  assert.deepEqual(JSON.parse(decodeURIComponent(vscode.slice(vscode.indexOf("?") + 1))), { name: "close-knit", type: "http", url: URLS.mcp });
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
