import { expect, test } from "./fixtures";

import { openTopMenu } from "./top-bar";

// G13/G14 (CUJ-07 v2): one /agents page, a tab per agent, each with its steps
// and the address to paste, all on the origin the page was requested on.

test("the ≡ menu's AI agents opens /agents on the Claude tab", async ({ page, baseURL }) => {
  await page.goto("/");
  // Menu v5: AI agents is a top-level link.
  await openTopMenu(page);
  const link = page.getByTestId("top-menu").getByRole("link", { name: "AI agents" });
  await expect(link).toHaveAttribute("href", "/agents");
  const response = await page.goto("/agents");
  expect(response?.status()).toBe(200);
  const origin = new URL(baseURL ?? page.url()).origin;
  await expect(page.getByTestId("agents-tab-claude")).toHaveAttribute("aria-current", "page");
  const claude = page.getByTestId("agents-panel-claude");
  await expect(claude.getByTestId("agents-mcp-url")).toHaveText(`${origin}/mcp`);
  await expect(claude.getByTestId("agents-claude-command")).toHaveText(`claude mcp add --transport http close-knit ${origin}/mcp`);
  // r3 #17 (CUJ-07 v4 step 3): the plugin's install line, copyable, after its marketplace.
  await expect(claude.getByTestId("agents-plugin-marketplace")).toHaveText("/plugin marketplace add bmsdave/getcloseknit");
  await expect(claude.getByTestId("agents-plugin-install")).toHaveText("/plugin install close-knit@close-knit");
  // r3 #18: every agent tab is inside the screen, a phone's too.
  const width = page.viewportSize()!.width;
  for (const tab of await page.getByRole("navigation", { name: "AI agents" }).getByRole("link").all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x + box.width, await tab.innerText()).toBeLessThanOrEqual(width);
  }
  // CUJ-07 v4: Example search opens the sample prompt's search in My match (a #profile= link), not a sample brief.
  await expect(claude.getByTestId("agents-example-search")).toHaveAttribute("href", /^\/\?layer=personal-match#profile=/);
  await expect(claude.getByTestId("agents-sample-brief")).toHaveCount(0);
  // The old /claude guide is this tab now (v3 Fix 17).
  await expect(claude.getByTestId("agents-claude-guide")).toHaveCount(0);
  await page.goto("/claude");
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByTestId("agents-tab-claude")).toHaveAttribute("aria-current", "page");
});

for (const [slug, text] of [
  ["chatgpt", "Developer mode"],
  ["codex", "~/.codex/config.toml"],
] as const) {
  test(`the ${slug} tab shows its setup steps`, async ({ page }) => {
    await page.goto("/agents");
    await page.getByTestId(`agents-tab-${slug}`).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${slug}$`), { timeout: 20_000 }); // a cold dev compile
    await expect(page.getByTestId(`agents-tab-${slug}`)).toHaveAttribute("aria-current", "page");
    const steps = page.getByTestId(`agents-panel-${slug}`).getByTestId("agents-steps");
    await expect(steps.locator("> li").first()).toBeVisible();
    await expect(steps).toContainText(text);
  });
}

test("Any agent gives the MCP, OpenAPI and llms.txt addresses, then Gemini and Grok", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? page.url()).origin;
  await page.goto("/agents/any");
  const addresses = page.getByTestId("agents-any-addresses").locator(".copy-field__value");
  await expect(addresses).toHaveText([`${origin}/mcp`, `${origin}/openapi.json`, `${origin}/llms.txt`]);
  await expect(page.getByTestId("agents-any-gemini").getByTestId("agents-steps").locator("> li")).toHaveCount(2);
  await expect(page.getByTestId("agents-gemini-command")).toHaveText(`gemini mcp add --transport http close-knit ${origin}/mcp`);
  await expect(page.getByTestId("agents-any-grok").getByTestId("agents-steps").locator("> li")).toHaveCount(3);
});

test("/agents/claude is /agents, and an unknown agent is a 404", async ({ page, request }) => {
  await page.goto("/agents/claude");
  await expect(page).toHaveURL(/\/agents$/);
  expect((await request.get("/agents/gemini")).status()).toBe(404);
});

// No API in the test server: /openapi.json is an honest 404, not the map.
test("/openapi.json without the API is a 404", async ({ request }) => {
  expect((await request.get("/openapi.json")).status()).toBe(404);
});
