import type { Metadata } from "next";
import Link from "next/link";

import { CopyButton, CopyField } from "@/components/copy-field";
import { KnitIcon } from "@/components/knit/knit-icon";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import { AGENT_GROUPS, AGENT_SAMPLE_PROMPT, agentCard, agentPath, agentTab, type AgentCard, type AgentSlug } from "@/lib/agents";
import { serverCoversEngland } from "@/lib/deployment";
import { exampleSearchHref } from "@/lib/profile-state";
import { pageMetadata, siteOrigin } from "@/lib/seo";

import "@/styles/tools.css";
import "./agents.css";

export async function agentsMetadata(slug: AgentSlug): Promise<Metadata> {
  const place = (await serverCoversEngland()) ? "England" : "London";
  return pageMetadata({
    title: slug === "claude" ? "AI agents" : `${agentTab(slug).label} · AI agents`,
    description: `Use Close Knit in Claude, ChatGPT, Gemini, Cursor, Codex or any agent: add it once, then ask where to live in ${place}.`,
    path: agentPath(slug),
  });
}

/** /agents (board variant A): one MCP address, the apps in three rows, the chosen app's card. */
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
      <section className="agents-address" aria-label="MCP address">
        <KnitIcon name="globe" colour="var(--yarn-tangerine)" className="agents-address__icon" />
        <div className="agents-address__body">
          <span>One address for every app · no sign-in</span>
          <CopyField value={urls.mcp} label="MCP address" testId="agents-mcp-url" />
        </div>
      </section>
      <nav className="agents-nav" aria-label="Pick your app">
        {AGENT_GROUPS.map((group) => (
          <div key={group.label} className="tools-nav agents-nav__row">
            <span className="agents-nav__label">{group.label}</span>
            {group.slugs.map((each) => (
              <Link key={each} href={agentPath(each)} data-testid={`agents-tab-${each}`} aria-current={each === slug ? "page" : undefined}>
                <span className="agents-dot" aria-hidden="true" style={{ background: agentTab(each).yarn }} />{agentTab(each).label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <AppCard card={agentCard(slug, urls)} />
      <p className="subpage-foot"><span>Steps follow each maker&apos;s docs, Oct 2026.</span>
        <Link href="/about#teams">API and licences</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms of use</Link></p>
    </main>
  );
}

function AppCard({ card }: { card: AgentCard }) {
  const { action } = card;
  return (
    <section className="subpage-card agents-card" data-testid={`agents-panel-${card.slug}`}>
      <div className="agents-card__main">
        <h2><span className="agents-dot agents-dot--big" aria-hidden="true" style={{ background: card.yarn }} />{card.name}
          {card.sub && <span className="agents-card__sub">{card.sub}</span>}</h2>
        {card.tags.length > 0 && (
          <ul className="agents-tags" data-testid="agents-tags">{card.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
        )}
        <div>
          {action.copy
            ? <CopyButton value={action.copy} label={action.label} icon={action.icon} testId="agents-action" />
            : <a className="primary-action" href={action.href} data-testid="agents-action">
              <KnitIcon name={action.icon} colour="var(--on-primary)" className="copy-field__icon" />{action.label}</a>}
        </div>
        <ol className="step-list" data-testid="agents-steps">
          {card.steps.map((step, index) => (
            <li key={index}>
              <span className="step-badge" aria-hidden="true">{index + 1}</span>
              <div className="step-list__text">
                {step.path && (
                  <span className="agents-path">{step.path.map((label, at) => (
                    <span key={at}>{at > 0 && <span className="agents-path__sep" aria-hidden="true">›</span>}<b>{label}</b></span>
                  ))}</span>
                )}
                {step.text && <span>{step.text}</span>}
              </div>
            </li>
          ))}
        </ol>
        <div className="agents-try">
          <p>Then try</p>
          <CopyField value={AGENT_SAMPLE_PROMPT} label="sample prompt" testId="agents-sample-prompt" />
          {/* What an agent hands back (CUJ-07 v4): the sample prompt's own search in My match. */}
          <p><a href={exampleSearchHref()} data-testid="agents-example-search">Example search →</a></p>
        </div>
        {card.doc && (card.doc.download
          ? <p><a href={card.doc.href} download>{card.doc.label}</a></p>
          : <p><a href={card.doc.href} target="_blank" rel="noopener noreferrer">{card.doc.label} ↗</a></p>)}
      </div>
      <div className="agents-card__panel" data-testid="agents-card-panel">
        <h3><KnitIcon name={card.panel.icon} colour="var(--muted)" className="copy-field__icon" />{card.panel.title}</h3>
        {card.fields.length > 0 && (
          <dl className="agents-fields">
            {card.fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.copy
                  ? <CopyField value={field.value} label={field.label} testId={field.testId} />
                  : <span className="agents-fields__value">{field.value}</span>}</dd>
              </div>
            ))}
          </dl>
        )}
        {card.snippets.map((snippet) => (
          <div key={snippet.value} className="agents-snippet">
            {snippet.label && <p>{snippet.label}</p>}
            <CopyField value={snippet.value} label={snippet.label ?? `${card.name} ${card.panel.title}`} testId={snippet.testId}
              multiline={snippet.value.includes("\n")} />
          </div>
        ))}
      </div>
    </section>
  );
}
