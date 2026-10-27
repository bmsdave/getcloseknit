import { expect, test } from "./fixtures";

import { openTopMenu } from "./top-bar";

// /agents (board variant A, 2026-10-27): one MCP address on top, the apps in three rows,
// one card per app on its own URL, every address on the origin the page was requested on.

test("the ≡ menu's AI agents opens /agents on Claude: the address, three rows of apps, one card", async ({ page, baseURL }) => {
  await page.goto("/");
  // Menu v5: AI agents is a top-level link.
  await openTopMenu(page);
  const link = page.getByTestId("top-menu").getByRole("link", { name: "AI agents" });
  await expect(link).toHaveAttribute("href", "/agents");
  const response = await page.goto("/agents");
  expect(response?.status()).toBe(200);
  const origin = new URL(baseURL ?? page.url()).origin;
  await expect(page.getByTestId("agents-mcp-url")).toHaveText(`${origin}/mcp`);
  const nav = page.getByRole("navigation", { name: "Pick your app" });
  await expect(nav.getByRole("link")).toHaveCount(14);
  await expect(page.getByTestId("agents-tab-claude")).toHaveAttribute("aria-current", "page");
  const claude = page.getByTestId("agents-panel-claude");
  await expect(claude.getByTestId("agents-steps")).toContainText("Add custom connector");
  await expect(claude.getByTestId("agents-card-mcp")).toHaveText(`${origin}/mcp`);
  await expect(claude.getByTestId("agents-action")).toHaveText("Copy address");
  // Every app pill is inside the screen, a phone's too.
  const width = page.viewportSize()!.width;
  for (const tab of await nav.getByRole("link").all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x + box.width, await tab.innerText()).toBeLessThanOrEqual(width);
  }
  // CUJ-07 v4: Example search opens the sample prompt's search in My match (a #profile= link), not a sample brief.
  await expect(claude.getByTestId("agents-example-search")).toHaveAttribute("href", /^\/\?layer=personal-match#profile=/);
  await page.goto("/claude");
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByTestId("agents-tab-claude")).toHaveAttribute("aria-current", "page");
});

test("Claude Code keeps the connector command and the plugin from its marketplace", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? page.url()).origin;
  await page.goto("/agents/claude-code");
  const card = page.getByTestId("agents-panel-claude-code");
  await expect(card.getByTestId("agents-claude-command")).toHaveText(`claude mcp add --transport http close-knit ${origin}/mcp`);
  await expect(card.getByTestId("agents-plugin")).toHaveText("/plugin marketplace add bmsdave/getcloseknit\n/plugin install close-knit@close-knit");
});

for (const [slug, text] of [
  ["chatgpt", "Developer mode"],
  ["codex", "~/.codex/config.toml"],
  ["perplexity", "Add MCP connector"],
] as const) {
  test(`picking ${slug} opens its own page and card`, async ({ page }) => {
    await page.goto("/agents");
    await page.getByTestId(`agents-tab-${slug}`).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${slug}$`), { timeout: 20_000 }); // a cold dev compile
    await expect(page.getByTestId(`agents-tab-${slug}`)).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId(`agents-panel-${slug}`).getByTestId("agents-steps")).toContainText(text);
  });
}

test("limit tags: Gemini personal accounts, Perplexity paid plans; Le Chat as CloseKnit and Manus untagged", async ({ page }) => {
  await page.goto("/agents/gemini");
  await expect(page.getByTestId("agents-tags")).toHaveText("Personal accounts");
  await page.goto("/agents/perplexity");
  await expect(page.getByTestId("agents-tags")).toHaveText("Pro, Max, Enterprise");
  await expect(page.getByTestId("agents-perplexity-plugin")).toHaveText("https://github.com/bmsdave/getcloseknit/tree/main/agents/claude/plugin");
  await page.goto("/agents/le-chat");
  await expect(page.getByTestId("agents-tags")).toHaveCount(0);
  await expect(page.getByTestId("agents-card-panel")).toContainText("CloseKnit");
  await page.goto("/agents/manus");
  await expect(page.getByTestId("agents-tags")).toHaveCount(0);
});

test("Gemini CLI installs the extension from the public repo; Cursor's action is its install link", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? page.url()).origin;
  await page.goto("/agents/gemini-cli");
  await expect(page.getByTestId("agents-gemini-extension")).toHaveText("gemini extensions install https://github.com/bmsdave/getcloseknit");
  await expect(page.getByTestId("agents-gemini-command")).toHaveText(`gemini mcp add --transport http close-knit ${origin}/mcp`);
  await page.goto("/agents/cursor");
  await expect(page.getByTestId("agents-action")).toHaveAttribute("href", /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=close-knit&config=/);
});

test("Any agent gives the MCP, OpenAPI and llms.txt addresses", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? page.url()).origin;
  await page.goto("/agents/any");
  const addresses = page.getByTestId("agents-card-panel").locator(".copy-field__value");
  await expect(addresses).toHaveText([`${origin}/mcp`, `${origin}/openapi.json`, `${origin}/llms.txt`]);
});

test("/agents/claude is /agents, and an unknown agent is a 404", async ({ page, request }) => {
  await page.goto("/agents/claude");
  await expect(page).toHaveURL(/\/agents$/);
  expect((await request.get("/agents/nope")).status()).toBe(404);
});

// No API in the test server: /openapi.json is an honest 404, not the map.
test("/openapi.json without the API is a 404", async ({ request }) => {
  expect((await request.get("/openapi.json")).status()).toBe(404);
});
