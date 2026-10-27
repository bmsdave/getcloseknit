/** The /agents tabs (CUJ-07 v2): one URL each, Claude first on /agents itself. */
export const AGENT_TABS = [
  { slug: "claude", label: "Claude" },
  { slug: "chatgpt", label: "ChatGPT" },
  { slug: "codex", label: "Codex" },
  { slug: "any", label: "Any agent" },
] as const;

export type AgentSlug = (typeof AGENT_TABS)[number]["slug"];

export function isAgentSlug(value: string): value is AgentSlug {
  return AGENT_TABS.some((tab) => tab.slug === value);
}

export function agentPath(slug: AgentSlug): string {
  return slug === "claude" ? "/agents" : `/agents/${slug}`;
}

/**
 * Where Claude Code finds the close-knit plugin (`/plugin marketplace add …`, then `/plugin install close-knit@close-knit`):
 * the repository holding .claude-plugin/marketplace.json. Whoever installs it must be able to read it (RELEASE-CHECKLIST).
 */
export const CLAUDE_PLUGIN_MARKETPLACE = "bmsdave/getcloseknit";

/** The prompt each tab offers to copy: one home-search journey. */
export const AGENT_SAMPLE_PROMPT = "Help me find a 2-bed flat to buy in London under £600k, within 30 minutes of King's Cross.";
