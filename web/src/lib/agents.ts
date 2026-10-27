/**
 * The /agents app picker: one page per app,
 * Claude on /agents itself, apps in three rows. Each app is one card: its menu path as steps, one main
 * action, limit tags and the panel it shows (fields to fill, snippets to paste).
 */
export const AGENT_GROUPS = [
  { label: "Chat", slugs: ["claude", "chatgpt", "gemini", "grok", "perplexity", "le-chat", "manus"] },
  { label: "Code", slugs: ["claude-code", "codex", "cursor", "vscode", "windsurf", "gemini-cli"] },
  { label: "Other", slugs: ["any"] },
] as const;

export type AgentSlug = (typeof AGENT_GROUPS)[number]["slugs"][number];

/** Each app's pill: its name and yarn dot. */
export const AGENT_TABS: readonly { slug: AgentSlug; label: string; yarn: string }[] = [
  { slug: "claude", label: "Claude", yarn: "var(--yarn-tangerine)" },
  { slug: "chatgpt", label: "ChatGPT", yarn: "var(--yarn-sky)" },
  { slug: "gemini", label: "Gemini", yarn: "var(--yarn-cobalt)" },
  { slug: "grok", label: "Grok", yarn: "var(--yarn-cherry)" },
  { slug: "perplexity", label: "Perplexity", yarn: "var(--yarn-leaf)" },
  { slug: "le-chat", label: "Le Chat", yarn: "var(--yarn-sun)" },
  { slug: "manus", label: "Manus", yarn: "var(--yarn-pink)" },
  { slug: "claude-code", label: "Claude Code", yarn: "var(--yarn-tangerine)" },
  { slug: "codex", label: "Codex", yarn: "var(--yarn-cherry)" },
  { slug: "cursor", label: "Cursor", yarn: "var(--yarn-pink)" },
  { slug: "vscode", label: "VS Code", yarn: "var(--yarn-sky)" },
  { slug: "windsurf", label: "Windsurf", yarn: "var(--yarn-leaf)" },
  { slug: "gemini-cli", label: "Gemini CLI", yarn: "var(--yarn-cobalt)" },
  { slug: "any", label: "Any agent", yarn: "var(--muted)" },
];

export function isAgentSlug(value: string): value is AgentSlug {
  return AGENT_TABS.some((tab) => tab.slug === value);
}

export function agentTab(slug: AgentSlug) {
  return AGENT_TABS.find((tab) => tab.slug === slug)!;
}

export function agentPath(slug: AgentSlug): string {
  return slug === "claude" ? "/agents" : `/agents/${slug}`;
}

/**
 * Where Claude Code finds the close-knit plugin (`/plugin marketplace add …`, then `/plugin install close-knit@close-knit`):
 * the repository holding .claude-plugin/marketplace.json. Whoever installs it must be able to read it (RELEASE-CHECKLIST).
 * The same public repo holds gemini-extension.json for `gemini extensions install`.
 */
export const CLAUDE_PLUGIN_MARKETPLACE = "bmsdave/getcloseknit";
export const PUBLIC_REPO_URL = `https://github.com/${CLAUDE_PLUGIN_MARKETPLACE}`;

/** The prompt each card offers to copy: one home-search journey. */
export const AGENT_SAMPLE_PROMPT = "Help me find a 2-bed flat to buy in London under £600k, within 30 minutes of King's Cross.";

/** One numbered step: a menu path (chips joined by ›) and/or a line of text. */
export interface AgentStep { path?: string[]; text?: string }
/** A box in the app's panel: a fixed value to type, or one to copy. */
export interface AgentField { label: string; value: string; copy?: boolean; testId?: string }
/** A command or config to paste. */
export interface AgentSnippet { label?: string; value: string; testId?: string }

export interface AgentCard {
  slug: AgentSlug;
  name: string;
  sub?: string;
  yarn: string;
  tags: string[];
  /** The one primary action: copy a value, or open a link (an app's install deeplink). */
  action: { label: string; icon: "note" | "plus"; copy?: string; href?: string };
  steps: AgentStep[];
  panel: { title: string; icon: string };
  fields: AgentField[];
  snippets: AgentSnippet[];
  doc?: { href: string; label: string; download?: boolean };
}

export interface AgentUrls { mcp: string; openapi: string; llms: string }

/** Cursor's one-click install: the server config, base64 JSON, in its deeplink. */
export function cursorInstallHref(mcpUrl: string): string {
  const config = btoa(JSON.stringify({ url: mcpUrl }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=close-knit&config=${encodeURIComponent(config)}`;
}

/** VS Code's one-click install: the server config, URL-encoded JSON, in its deeplink. */
export function vscodeInstallHref(mcpUrl: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "close-knit", type: "http", url: mcpUrl }))}`;
}

const copyAddress = (mcp: string) => ({ label: "Copy address", icon: "note" as const, copy: mcp });
const address = (label: string, mcp: string): AgentField => ({ label, value: mcp, copy: true, testId: "agents-card-mcp" });
const fixed = (label: string, value: string): AgentField => ({ label, value });
const dialog = (title: string) => ({ title, icon: "panel" });
const file = (title: string) => ({ title, icon: "note" });

/** Every card's content, as the board writes it (steps from each maker's docs). */
export function agentCard(slug: AgentSlug, urls: AgentUrls): AgentCard {
  const { mcp } = urls;
  const { label: name, yarn } = agentTab(slug);
  const base = { slug, name, yarn, tags: [] as string[], fields: [] as AgentField[], snippets: [] as AgentSnippet[] };
  switch (slug) {
    case "claude":
      return { ...base, sub: "app or claude.ai", action: copyAddress(mcp),
        steps: [{ path: ["Settings", "Connectors", "Add custom connector"] }, { text: "Name it Close Knit, paste the address." }],
        panel: dialog("Add custom connector"), fields: [fixed("Name", "Close Knit"), address("Remote MCP server URL", mcp)],
        doc: { href: "/downloads/find-a-home.zip", label: "find-a-home.zip skill", download: true } };
    case "chatgpt":
      return { ...base, action: copyAddress(mcp),
        steps: [{ path: ["Settings", "Connectors", "Advanced", "Developer mode"] },
          { path: ["Create"], text: "Paste the address, authentication None." }, { text: "In a chat, turn the connector on." }],
        panel: dialog("New connector"), fields: [fixed("Name", "Close Knit"), address("MCP server URL", mcp), fixed("Authentication", "None")] };
    case "gemini":
      return { ...base, sub: "app", tags: ["Personal accounts"], action: copyAddress(mcp),
        steps: [{ path: ["Customise", "Connectors", "+ Custom"], text: "Paste the address." }, { path: ["Next"] },
          { text: "Tick the risk notice, then Connect." }],
        panel: dialog("Connect to an MCP server"), fields: [address("MCP server URL", mcp)],
        doc: { href: "https://support.google.com/gemini/answer/17209137", label: "Google’s guide" } };
    case "grok":
      return { ...base, tags: ["Business: admin adds it first"], action: copyAddress(mcp),
        steps: [{ path: ["Plugins", "New Connector", "Custom"], text: "Plugins is grok.com/connectors." },
          { text: "Name it Close Knit, paste the address." }, { path: ["Add Connector"] }],
        panel: dialog("Custom connector"), fields: [fixed("Name", "Close Knit"), address("Server URL", mcp)],
        doc: { href: "https://docs.x.ai/grok/connectors", label: "xAI’s guide" } };
    case "perplexity":
      return { ...base, tags: ["Pro, Max, Enterprise"], action: copyAddress(mcp),
        steps: [{ path: ["Customize", "Connectors", "Add custom", "Add MCP connector", "Remote"] },
          { text: "Fill it in as shown, tick the box, Add." }, { text: "Click its card to turn it on." },
          { path: ["Plugins", "+", "Import plugin from GitHub"], text: "Or import the plugin from this link." }],
        panel: dialog("Add MCP connector"),
        fields: [fixed("Name", "Close Knit"), address("MCP Server URL", mcp), fixed("Authentication", "None"), fixed("Transport", "Streamable HTTP")],
        snippets: [{ label: "Plugin", value: `${PUBLIC_REPO_URL}/tree/main/agents/claude/plugin`, testId: "agents-perplexity-plugin" }],
        doc: { href: "https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors", label: "Perplexity’s guide" } };
    case "le-chat":
      return { ...base, sub: "Mistral", action: copyAddress(mcp),
        steps: [{ path: ["Connectors", "Add connector", "Add a custom connector"] },
          { text: "Name it CloseKnit (no spaces), paste the address, add a description." }, { path: ["Add connector"] }],
        panel: dialog("Add a custom connector"),
        fields: [fixed("Connector name", "CloseKnit"), address("Server URL", mcp), fixed("Authentication", "No authentication")],
        doc: { href: "https://docs.mistral.ai/le-chat/knowledge-integrations/connectors/mcp-connectors", label: "Mistral’s guide" } };
    case "manus":
      return { ...base, action: copyAddress(mcp),
        steps: [{ path: ["+", "Add connectors", "Custom", "Create", "Custom MCP"], text: "The + is in the tools menu." },
          { text: "Name it Close Knit, add a note, paste the Server URL, transport HTTP." }, { path: ["Save"] }],
        panel: dialog("Custom MCP"), fields: [fixed("Server name", "Close Knit"), address("Server URL", mcp), fixed("Transport", "HTTP")] };
    case "claude-code": {
      const command = `claude mcp add --transport http close-knit ${mcp}`;
      return { ...base, action: { label: "Copy command", icon: "note", copy: command },
        steps: [{ text: "Run it in a terminal." }, { text: "Or the plugin, inside Claude Code." }],
        panel: file("Terminal"),
        snippets: [{ value: command, testId: "agents-claude-command" },
          { label: "Plugin", value: `/plugin marketplace add ${CLAUDE_PLUGIN_MARKETPLACE}\n/plugin install close-knit@close-knit`, testId: "agents-plugin" }] };
    }
    case "codex": {
      const config = `[mcp_servers.close_knit]\nurl = "${mcp}"`;
      return { ...base, action: { label: "Copy config", icon: "note", copy: config },
        steps: [{ path: ["~/.codex/config.toml"], text: "Add this." }, { text: "Restart Codex." }],
        panel: file("config.toml"), snippets: [{ value: config, testId: "agents-codex-config" }] };
    }
    case "cursor":
      return { ...base, action: { label: "Add to Cursor", icon: "plus", href: cursorInstallHref(mcp) },
        steps: [{ text: "One click, then Install in Cursor." }, { path: ["~/.cursor/mcp.json"], text: "Or add this by hand." }],
        panel: file("mcp.json"),
        snippets: [{ value: `{\n  "mcpServers": {\n    "close-knit": { "url": "${mcp}" }\n  }\n}` }],
        doc: { href: "https://cursor.com/docs/context/mcp", label: "Cursor’s guide" } };
    case "vscode":
      return { ...base, sub: "GitHub Copilot", tags: ["Copilot agent mode"],
        action: { label: "Add to VS Code", icon: "plus", href: vscodeInstallHref(mcp) },
        steps: [{ text: "One click, then Install." }, { path: ["Command Palette", "MCP: Add Server", "HTTP"], text: "Or paste the address." },
          { path: [".vscode/mcp.json"], text: "Or add this to a project." }],
        panel: file("mcp.json"), fields: [address("Server URL", mcp)],
        snippets: [{ value: `{\n  "servers": {\n    "close-knit": { "type": "http", "url": "${mcp}" }\n  }\n}` }],
        doc: { href: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration", label: "VS Code’s guide" } };
    case "windsurf": {
      const config = `{\n  "mcpServers": {\n    "close-knit": { "serverUrl": "${mcp}" }\n  }\n}`;
      return { ...base, sub: "now Devin Desktop", action: { label: "Copy config", icon: "note", copy: config },
        steps: [{ path: ["Cascade", "···", "MCPs", "Open MCP config file"] }, { text: "Paste this, save." }],
        panel: file("mcp_config.json"), snippets: [{ value: config }],
        doc: { href: "https://docs.devin.ai/desktop/cascade/mcp", label: "Devin’s guide" } };
    }
    case "gemini-cli": {
      const command = `gemini extensions install ${PUBLIC_REPO_URL}`;
      return { ...base, action: { label: "Copy command", icon: "note", copy: command },
        steps: [{ text: "Run it in a terminal: connector and guide in one." }, { text: "Or the connector only." }],
        panel: file("Terminal"),
        snippets: [{ value: command, testId: "agents-gemini-extension" },
          { label: "Connector only", value: `gemini mcp add --transport http close-knit ${mcp}`, testId: "agents-gemini-command" }],
        doc: { href: "https://geminicli.com/docs/extensions/reference/", label: "Gemini CLI guide" } };
    }
    case "any":
      return { ...base, action: copyAddress(mcp),
        steps: [{ text: "Speaks MCP: the MCP address (Streamable HTTP, no sign-in)." }, { text: "Calls web APIs: the OpenAPI address." },
          { text: "Reads the web: the llms.txt address." }],
        panel: { title: "Addresses", icon: "globe" },
        fields: [{ label: "MCP", value: mcp, copy: true, testId: "agents-any-mcp" },
          { label: "OpenAPI", value: urls.openapi, copy: true, testId: "agents-any-openapi" },
          { label: "llms.txt", value: urls.llms, copy: true, testId: "agents-any-llms" }] };
  }
}
