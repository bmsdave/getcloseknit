import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { CopyField } from "@/components/copy-field";
import { KnitIcon } from "@/components/knit/knit-icon";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import { AGENT_SAMPLE_PROMPT, AGENT_TABS, CLAUDE_PLUGIN_MARKETPLACE, agentPath, type AgentSlug } from "@/lib/agents";
import { exampleSearchHref } from "@/lib/profile-state";
import { pageMetadata, siteOrigin } from "@/lib/seo";

import "@/styles/tools.css";
import "./claude.css";
import "./agents.css";

export function agentsMetadata(slug: AgentSlug): Metadata {
  const tab = AGENT_TABS.find((entry) => entry.slug === slug)!;
  return pageMetadata({
    title: slug === "claude" ? "AI agents" : `${tab.label} · AI agents`,
    description: "Use Close Knit in Claude, ChatGPT, Codex or any agent: add it once, then ask where to live in London.",
    path: agentPath(slug),
  });
}

/** /agents (G13, G14): one tab per agent, each a few steps and the address to paste. */
export async function AgentsHub({ slug }: { slug: AgentSlug }) {
  const origin = (await siteOrigin()) ?? "";
  const urls = { mcp: `${origin}/mcp`, openapi: `${origin}/openapi.json`, llms: `${origin}/llms.txt` };
  return (
    <main className="subpage agents-page" data-testid="agents-page">
      <SiteHeader />
      <SubpageHero
        eyebrow="AI agents"
        title="Ask your AI agent where to live."
        lead="Add Close Knit once, then just talk. Your agent answers with Close Knit's evidence and cites each source."
        ornament="town"
        yarn="var(--yarn-tangerine)"
      />
      <nav className="tools-nav agents-nav" aria-label="AI agents">
        {AGENT_TABS.map((tab) => (
          <Link key={tab.slug} href={agentPath(tab.slug)} data-testid={`agents-tab-${tab.slug}`}
            aria-current={tab.slug === slug ? "page" : undefined}>{tab.label}</Link>
        ))}
      </nav>
      <div className="subpage-cards" data-testid={`agents-panel-${slug}`}>
        {slug === "claude" && <ClaudeTab mcpUrl={urls.mcp} />}
        {slug === "chatgpt" && <ChatGptTab mcpUrl={urls.mcp} />}
        {slug === "codex" && <CodexTab mcpUrl={urls.mcp} />}
        {slug === "any" && <AnyAgentTab urls={urls} />}
      </div>
      <p className="subpage-foot"><Link href="/about#teams">API and licences</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms of use</Link></p>
    </main>
  );
}

function Card({ title, icon, yarn, testId, id, children }: {
  title: string; icon: "panel" | "note" | "info"; yarn: string; testId?: string; id?: string; children: ReactNode;
}) {
  return (
    <section className="subpage-card" data-testid={testId} id={id}>
      <h2><span className="subpage-card__icon" aria-hidden="true"><KnitIcon name={icon} colour={yarn} /></span>{title}</h2>
      {children}
    </section>
  );
}

function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="step-list" data-testid="agents-steps">
      {children.map((step, index) => (
        <li key={index}>
          <span className="step-badge" aria-hidden="true">{index + 1}</span>
          <div className="step-list__text">{step}</div>
        </li>
      ))}
    </ol>
  );
}

function TryPrompt() {
  return (
    <div className="agents-try">
      <p>Then try:</p>
      <CopyField value={AGENT_SAMPLE_PROMPT} label="sample prompt" testId="agents-sample-prompt" />
    </div>
  );
}

function ClaudeTab({ mcpUrl }: { mcpUrl: string }) {
  return (
    <>
      <Card title="Claude app or claude.ai" icon="panel" yarn="var(--yarn-tangerine)" testId="agents-claude-connector">
        <CopyField value={mcpUrl} label="MCP address" testId="agents-mcp-url" />
        <Steps>{[
          <>Open <strong>Settings → Connectors → Add custom connector</strong>.</>,
          <>Name it <strong>Close Knit</strong> and paste the address.</>,
        ]}</Steps>
        <TryPrompt />
        {/* What an agent hands back (CUJ-07 v4): the sample prompt's own search in My match, so it keeps its budget. */}
        <p><a href={exampleSearchHref()} data-testid="agents-example-search">Example search →</a></p>
      </Card>
      <Card title="Claude Code" icon="note" yarn="var(--yarn-sky)" testId="agents-claude-code" id="code">
        <CopyField value={`claude mcp add --transport http close-knit ${mcpUrl}`} label="connector command" testId="agents-claude-command" />
        {/* r3 #17 (CUJ07 board step 3): or the whole plugin (connector, skill and commands) from its marketplace. */}
        <p>Or the plugin, in Claude Code:</p>
        <CopyField value={`/plugin marketplace add ${CLAUDE_PLUGIN_MARKETPLACE}`} label="marketplace command" testId="agents-plugin-marketplace" />
        <CopyField value="/plugin install close-knit@close-knit" label="plugin install command" testId="agents-plugin-install" />
        <p>For the guided interview, add the find-a-home skill: unzip it into <code>~/.claude/skills/</code>, or upload it in
          Claude under <strong>Settings → Capabilities → Skills</strong>.</p>
        <p><a className="claude-download" href="/downloads/find-a-home.zip" download>
          <KnitIcon name="arrow-up" className="claude-download__icon" />find-a-home.zip</a></p>
      </Card>
    </>
  );
}

function ChatGptTab({ mcpUrl }: { mcpUrl: string }) {
  return (
    <Card title="ChatGPT" icon="panel" yarn="var(--yarn-sky)" testId="agents-chatgpt">
      <CopyField value={mcpUrl} label="MCP address" testId="agents-mcp-url" />
      <Steps>{[
        <>Open <strong>Settings → Connectors → Advanced → Developer mode</strong>.</>,
        <><strong>Create</strong> a connector, paste the address as its MCP server URL, authentication <strong>None</strong>.</>,
        <>In a chat, turn the connector on.</>,
      ]}</Steps>
      <TryPrompt />
    </Card>
  );
}

function CodexTab({ mcpUrl }: { mcpUrl: string }) {
  return (
    <Card title="Codex" icon="panel" yarn="var(--yarn-cherry)" testId="agents-codex">
      <CopyField value={`[mcp_servers.close_knit]\nurl = "${mcpUrl}"`} label="Codex config" testId="agents-codex-config" multiline />
      <Steps>{[
        <>Add this to <code>~/.codex/config.toml</code>.</>,
        <>Restart Codex.</>,
      ]}</Steps>
      <TryPrompt />
    </Card>
  );
}

function AnyAgentTab({ urls }: { urls: { mcp: string; openapi: string; llms: string } }) {
  return (
    <>
      <Card title="Addresses" icon="panel" yarn="var(--yarn-tangerine)" testId="agents-any-addresses">
        <dl className="agents-addresses">
          <dt>MCP, for agents with connectors (no sign-in)</dt>
          <dd><CopyField value={urls.mcp} label="MCP address" testId="agents-any-mcp" /></dd>
          <dt>OpenAPI, for agents that call web APIs</dt>
          <dd><CopyField value={urls.openapi} label="OpenAPI address" testId="agents-any-openapi" /></dd>
          <dt>llms.txt, for agents that read the web</dt>
          <dd><CopyField value={urls.llms} label="llms.txt address" testId="agents-any-llms" /></dd>
        </dl>
      </Card>
      <Card title="Gemini" icon="note" yarn="var(--yarn-sky)" testId="agents-any-gemini">
        <Steps>{[
          <>In Gemini CLI, run this command:</>,
          <>Elsewhere in Gemini, give it the <strong>llms.txt</strong> address.</>,
        ]}</Steps>
        <CopyField value={`gemini mcp add --transport http close-knit ${urls.mcp}`} label="Gemini CLI command" testId="agents-gemini-command" />
      </Card>
      <Card title="Grok" icon="note" yarn="var(--yarn-pink)" testId="agents-any-grok">
        <Steps>{[
          <>If your Grok has custom connectors, add one with the <strong>MCP</strong> address.</>,
          <>Through the xAI API, use it as a remote MCP tool&apos;s <code>server_url</code>.</>,
          <>Otherwise, give it the <strong>llms.txt</strong> address.</>,
        ]}</Steps>
        <CopyField value={urls.mcp} label="MCP address for Grok" testId="agents-grok-mcp" />
      </Card>
      <Card title="Other agents" icon="info" yarn="var(--yarn-cherry)" testId="agents-any-other">
        <Steps>{[
          <>Speaks MCP: the <strong>MCP</strong> address (Streamable HTTP).</>,
          <>Calls APIs: the <strong>OpenAPI</strong> address.</>,
          <>Neither: the <strong>llms.txt</strong> address.</>,
        ]}</Steps>
        <p className="claude-note">Gemini and Grok steps follow their makers&apos; docs; we haven&apos;t tested them.</p>
      </Card>
    </>
  );
}
