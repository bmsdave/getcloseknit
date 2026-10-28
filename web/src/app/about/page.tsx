import Link from "next/link";
import type { ReactNode } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { SiteHeader } from "@/components/site-header";
import { PLACES_DOWNLOAD } from "@/components/site-footer";
import { SubpageHero } from "@/components/subpage-hero";
import { contactEmail, contactMailto, NEWS_SUBJECT, RESEARCH_SUBJECT } from "@/lib/contact";
import type { MetricDefinition } from "@/lib/contracts";
import { fetchApi, serverCoversEngland } from "@/lib/deployment";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { METRICS } from "@/lib/fixtures";
import { EXPENSIVE_COST, RATE_LIMITS } from "@/lib/teams-limits";

import "./about.css";
import "./teams.css";
import { pageMetadata } from "@/lib/seo";

// Controller, contact and the served release come from the deployment at request time.
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "About",
  description: "Who runs Close Knit, why it is independent, how fresh each figure is and how to report a wrong one.",
  path: "/about",
});

interface Freshness {
  demo: boolean;
  release: string | null;
  rows: { id: string; label: string; source: string; period: string; release: string }[];
}

/** The figures' sources and latest periods, from the same /api/v1/metrics the map reads (fixtures in demo). */
async function dataFreshness(): Promise<Freshness | null> {
  const demo = !evidenceServiceUrl();
  let metrics: MetricDefinition[] = METRICS;
  let release: string | null = null;
  if (!demo) {
    const { body } = await fetchApi<{ metrics?: MetricDefinition[]; productReleaseId?: string }>("/api/v1/metrics");
    if (!Array.isArray(body?.metrics)) return null;
    metrics = body.metrics;
    release = typeof body.productReleaseId === "string" ? body.productReleaseId : null;
  }
  const rows = metrics
    .filter((metric) => metric.provenance?.sourceName)
    .map((metric) => ({
      id: metric.id,
      label: metric.label,
      source: metric.provenance.sourceName,
      period: metric.defaultPeriod,
      release: metric.provenance.release,
    }));
  return { demo, release, rows };
}

export default async function AboutPage() {
  const CONTACT = contactEmail();
  const CONTROLLER = process.env.CLOSE_KNIT_CONTROLLER || "the Close Knit operator";
  const [freshness, england] = await Promise.all([dataFreshness(), serverCoversEngland()]);
  return (
    <main className="subpage page-prose" data-testid="about-page">
      <SiteHeader />
      <SubpageHero
        eyebrow="About Close Knit"
        title="Who runs Close Knit, and why you can trust the figures."
        lead={england
          ? <>Close Knit puts public records about homes and areas across England in one place, each figure
            linked to the body that published it, so you can see what homes really sold for and which
            areas fit your budget (and, in London, your commute).</>
          : <>Close Knit puts public records about London homes and areas in one place, each figure
            linked to the body that published it, so you can see what homes really sold for and which
            areas fit your budget and commute.</>}
        ornament="town"
        yarn="var(--yarn-sky)"
      />

      <div className="subpage-cards">
        <Section id="who" icon="people" title="Who runs it">
          <p data-testid="about-controller">
            The data controller is {CONTROLLER}, contact <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
          <p>The <Link href="/privacy">privacy notice</Link> says what is published about homes, on what basis, and how to correct or hide one.</p>
        </Section>

        <Section id="independence" icon="check" title="Independent by design">
          <ul data-testid="about-pledge">
            <li><strong>No paid placement.</strong> No agent, developer or area pays to appear here or to be shown first.</li>
            <li><strong>No lead selling.</strong> We never sell or pass on your search or your contact details, to agents or anyone else.</li>
            <li><strong>Rankings are never sold.</strong> The order of areas comes only from your priorities and the published data.</li>
          </ul>
        </Section>

        <Section id="freshness" icon="trend" title="How fresh the data is">
          {freshness ? (
            <>
              <p>
                {freshness.demo
                  ? "This copy of Close Knit is showing demo data: not for decisions. A live copy lists the release it is serving here."
                  : <>Figures on the map come from release <code>{freshness.release ?? "unknown"}</code>.</>}
                {" "}Each figure also names its source and date where it is shown.
              </p>
              <div className="tools-table-wrap">
                <table className="tools-table about-freshness" data-testid="about-freshness">
                  <thead><tr><th scope="col">Figure</th><th scope="col">Source</th><th scope="col">Latest period</th></tr></thead>
                  <tbody>
                    {freshness.rows.map((row) => (
                      <tr key={row.id}><th scope="row">{row.label}</th><td>{row.source}</td><td>{row.period}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p data-testid="about-freshness-unavailable">The list of sources is not available just now; each figure names its source and date where it is shown.</p>
          )}
          <p>How each figure is made is in the <Link href="/guide">guide (sources &amp; methodology)</Link>.</p>
        </Section>

        <Section id="report" icon="help" title="Report a wrong figure">
          <p>
            For a home, open its page (or select it on the map) and choose <em>Report or hide this
            home</em>. For an area figure, choose <em>Report a wrong figure</em> under it. Or write to <a href={contactMailto("A figure looks wrong")}>{CONTACT}</a> with the
            address or area, the figure and what you expected. If it is your home and you would rather
            it was not shown, <Link href="/privacy#hide-my-home">hide it</Link>.
          </p>
        </Section>

        <TeamsSections contact={CONTACT} england={england} />

        <Section id="get-involved" icon="heart" title="Hear about it, or help shape it">
          <p>
            Close Knit is open to anyone with the link while it is being tested. Both links below open
            an e-mail to us; nothing is collected or stored on this site.
          </p>
          <p className="about-links">
            <a href={contactMailto(NEWS_SUBJECT)} data-testid="about-launch-list">{NEWS_SUBJECT}</a>
            <a href={contactMailto(RESEARCH_SUBJECT)} data-testid="about-research">{RESEARCH_SUBJECT}</a>
          </p>
        </Section>
      </div>
    </main>
  );
}

const count = (value?: number) => (value === undefined ? "–" : value.toLocaleString("en-GB"));

/**
 * For teams (the old /teams page, now a section of About; /teams redirects here).
 * For relocation teams, researchers and developers: what the API and MCP return, the limits and
 * the licences. It restates the terms and never offers more than they allow: team use starts with an e-mail.
 */
function TeamsSections({ contact, england }: { contact: string; england: boolean }) {
  return (
    <>
      <Section id="teams" icon="layers" title="For teams: what the API and MCP return">
        <p>Relocation teams, researchers and developers can read the figures the map shows through a public API, or through an
          MCP endpoint that AI agents such as Claude use.</p>
        <ul data-testid="teams-returns">
          <li><strong>Area figures</strong> for every {england ? "neighbourhood in England (LSOA and MSOA) and local authority" : "London neighbourhood (LSOA and MSOA) and borough"}: price per
            m² from recorded sales, crime, deprivation, income, social renting, station access and food hygiene.
            Each figure carries its source, release, period and quality.</li>
          <li><strong>Rankings and matches</strong>: areas ranked by one figure, or matched to a budget, a commute
            and your priorities.</li>
          <li><strong>Homes</strong>: a home&apos;s recorded sales from HM Land Registry, a summary of nearby
            sales, and prices in its area today. Never a value for the home itself.</li>
          <li><strong>Evidence packs</strong>: an area&apos;s figures with their sources in one document.</li>
        </ul>
        <p>
          The MCP endpoint is the address on <Link href="/agents">AI agents</Link>. Agents can read the
          pages and endpoints in <a href="/llms.txt">llms.txt</a>. Close Knit holds no listings and no
          personal profiles, so neither returns them.
        </p>
      </Section>

      <Section id="limits" icon="trend" title="Rate limits">
        <p>Limits apply per client: an IPv4 address, or an IPv6 /64. A request must fit every window it counts against.</p>
        <div className="tools-table-wrap">
          <table className="tools-table teams-limits" data-testid="teams-limits">
            <thead><tr><th scope="col">Requests</th><th scope="col">Per minute</th><th scope="col">Per hour</th><th scope="col">Per day</th></tr></thead>
            <tbody>
              {RATE_LIMITS.map((row) => (
                <tr key={row.id} data-class={row.id}>
                  <th scope="row">{row.label}</th><td>{count(row.minute)}</td><td>{count(row.hour)}</td><td>{count(row.day)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Searches, rankings and matches count as {EXPENSIVE_COST} requests each. Over a limit you get{" "}
          <code>429</code> with a <code>Retry-After</code> header: wait, and do not work around it.
        </p>
      </Section>

      <Section id="licences" icon="book" title="Licences">
        <ul data-testid="teams-licences">
          <li>Most figures are public-sector data under the <strong>Open Government Licence v3.0</strong> (HM Land
            Registry, ONS, police.uk, the Environment Agency, Ofsted, the Department for Education and others).
            Keep each figure&apos;s attribution with it when you reuse it.</li>
          <li>Data built from OpenStreetMap is &copy; OpenStreetMap contributors under the <strong>Open Database
            Licence (ODbL) 1.0</strong>. Our places database is offered under ODbL 1.0 as a{" "}
            <a href={PLACES_DOWNLOAD}>download</a>.</li>
          <li>Addresses from HM Land Registry Price Paid Data are shown against their sale, never as an address list.</li>
        </ul>
        <p>The full list is in the terms, under <Link href="/terms#reuse">reusing the data</Link> and{" "}
          <Link href="/terms#places">the places database</Link>.</p>
      </Section>

      <Section id="team-use" icon="people" title="Using it for a team">
        <p>
          Today the API and the MCP endpoint are for personal use, and for agents such as Claude acting for a
          person, within the limits above (<Link href="/terms#acceptable-use">terms of use</Link>). No bulk
          extraction, and never to identify, contact or market to the people behind a home or a sale.
        </p>
        <p data-testid="teams-contact">
          If you would like to use Close Knit for a team or a product, write to us first:{" "}
          <a href={contactMailto("Close Knit for teams")}>{contact}</a>. Working with teams does not change
          the pledge above: no paid ranking, no lead selling.
        </p>
      </Section>
    </>
  );
}

function Section({ id, icon, title, children }: { id: string; icon: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="subpage-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}><span className="subpage-card__icon" aria-hidden="true"><KnitIcon name={icon} colour="var(--yarn-sky)" /></span>{title}</h2>
      {children}
    </section>
  );
}
