import Link from "next/link";
import type { ReactNode } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import { contactEmail } from "@/lib/contact";
import { NOT_ADVICE } from "@/lib/tools";

// Operator and contact come from the deployment environment at request time, not from the build.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Terms of use",
  description: "The terms for using Close Knit's site, API and MCP endpoint, and for reusing its data.",
};

/** The ODbL places download (the merged places database). */
const PLACES_DOWNLOAD = "/api/v2/downloads/places.csv";

export default function TermsPage() {
  const CONTACT = contactEmail();
  const OPERATOR = process.env.CLOSE_KNIT_CONTROLLER || "the Close Knit operator";
  return (
    <main className="subpage page-prose" data-testid="terms-page">
      <SiteHeader />
      <SubpageHero
        eyebrow="Terms of use · last updated 11 October 2026"
        title="Public records, explained with care. Use them fairly."
        lead={<>These terms cover the Close Knit website, its API and its MCP endpoint for software
          agents. By using them you accept these terms. What we publish about homes, and how to hide
          one, is in the <Link href="/privacy">privacy notice</Link>.</>}
        ornament="town"
        yarn="var(--yarn-tangerine)"
      />
      <nav className="subpage-toc" aria-label="On this page">
        <ul>
          {SECTIONS.map(([id, , title]) => <li key={id}><a href={`#${id}`}>{title}</a></li>)}
        </ul>
      </nav>

      <div className="subpage-cards">
        <Section id="operator">
          <p>
            Close Knit is run by {OPERATOR}. Questions about these terms:{" "}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
        </Section>

        <Section id="not-advice">
          <p>
            Every figure is a public record or derived from one: recorded sale prices, energy
            certificates, area statistics and the figures we derive from them, each with its source
            and date. We never state what a single home is worth: a home shows its recorded sales and
            its area&apos;s price range. Ballpark prices for an area and forecasts are estimates with
            their caveats. Nothing on
            Close Knit is a valuation, a survey, or financial, legal, tax or investment advice.
          </p>
          <p data-testid="terms-not-advice">The calculators under Tools carry the same notice: &ldquo;{NOT_ADVICE}&rdquo;</p>
        </Section>

        <Section id="no-warranty">
          <p>
            Close Knit is provided as it is. Public records can be late, incomplete or wrong, and we
            restate them as published; we do not promise that any figure is accurate, complete or
            current, or that the service will always be available. To the extent the law allows, we
            exclude all warranties and are not liable for any loss arising from your use of, or
            reliance on, the site, the API or the MCP endpoint. Nothing in these terms limits
            liability that the law does not allow to be limited, such as for death or personal
            injury caused by negligence, or for fraud.
          </p>
          <p>
            Spotted a wrong figure? Select the home on the map and choose <em>Report or hide this
            home</em>, or write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
        </Section>

        <Section id="acceptable-use">
          <ul>
            <li>No scraping, crawling or bulk extraction of homes, sales or addresses, and no
              rebuilding of an address or sales database from the site, the API or the MCP endpoint.</li>
            <li>Rate limits apply per client. Over the limit you get <code>429</code> with a{" "}
              <code>Retry-After</code> header; wait, do not work around it (for example by rotating
              addresses or accounts).</li>
            <li>The API and the MCP endpoint are for personal use, and for agents such as Claude acting
              for a person, within those limits. See <Link href="/agents">AI agents</Link>.</li>
            <li>Do not use the data to identify, contact, market to or profile the people behind a
              home or a sale.</li>
            <li>Do not try to break, overload or get around the service&rsquo;s security.</li>
          </ul>
        </Section>

        <Section id="reuse">
          <p>
            The data keeps its publishers&rsquo; licences. If you quote or reuse figures, keep the
            source attribution with them; each figure&rsquo;s source, licence and date is in the{" "}
            <Link href="/guide">guide (sources &amp; methodology)</Link>. In short:
          </p>
          <ul>
            <li><strong>HM Land Registry Price Paid Data</strong>: Open Government Licence v3.0. The
              addresses are Royal Mail and OS derived: show them against the sale they belong to, never
              as an address list.</li>
            <li><strong>HM Land Registry INSPIRE polygons</strong>: OGL v3.0, with HM Land
              Registry&rsquo;s and Ordnance Survey&rsquo;s copyright statement kept verbatim.</li>
            <li><strong>Energy Performance Certificates</strong> (MHCLG): the building facts we show
              are under OGL v3.0; we do not republish certificate addresses.</li>
            <li><strong>OS Open UPRN, OS Open Names, OS Open Roads, GLA street trees, ONS, police.uk, Environment Agency, Ofsted, DfE, Bank of
              England</strong> and other public bodies: OGL v3.0.</li>
            <li><strong>OpenStreetMap</strong>: &copy; OpenStreetMap contributors, Open Database
              Licence (ODbL) 1.0.</li>
            <li>Ward councillors from Democracy Club (CC BY 4.0); MPs from UK
              Parliament (Open Parliament Licence v3.0).</li>
          </ul>
          <p>
            <strong>Hidden homes stay hidden.</strong> A home hidden after a privacy objection must
            not appear in anything you publish from Close Knit; if a home disappears from Close Knit,
            remove it from your copies too.
          </p>
        </Section>

        <Section id="places">
          <p>
            Our places database (shops, cafés, pubs, GPs and other places, merged from OpenStreetMap,
            the Food Standards Agency, Overture Maps and Foursquare) is offered under the{" "}
            <a href="https://opendatacommons.org/licenses/odbl/1-0/">Open Database Licence 1.0</a>{" "}
            as a download: <a href={PLACES_DOWNLOAD} data-testid="terms-places-download"><code>{PLACES_DOWNLOAD}</code></a>.
            Keep &ldquo;&copy; OpenStreetMap contributors&rdquo;, &ldquo;&copy; Overture Maps
            Foundation&rdquo;, the Foursquare Open Source Places notice (Apache License 2.0) and the
            Food Standards Agency&rsquo;s OGL attribution with it. A database you build from it must
            also be offered under ODbL 1.0.
          </p>
        </Section>

        <Section id="law">
          <p>
            These terms are governed by the law of England and Wales. We may change them; the date at
            the top shows the latest version.
          </p>
        </Section>
      </div>
      <p className="subpage-foot"><Link href="/guide">Sources &amp; methodology</Link><Link href="/privacy">Privacy</Link></p>
    </main>
  );
}

/** id, yarn icon, heading: the order of the cards and of the "On this page" chips. */
const SECTIONS: [string, string, string][] = [
  ["operator", "people", "Who runs Close Knit"],
  ["not-advice", "alert", "Public records, not advice"],
  ["no-warranty", "info", "No warranty"],
  ["acceptable-use", "check", "Acceptable use"],
  ["reuse", "layers", "Reusing the data"],
  ["places", "place-shop", "Places data (ODbL)"],
  ["law", "book", "Governing law"],
];

function Section({ id, children }: { id: string; children: ReactNode }) {
  const [, icon, title] = SECTIONS.find(([key]) => key === id) ?? [id, "dot", id];
  return (
    <section id={id} className="subpage-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}><span className="subpage-card__icon" aria-hidden="true"><KnitIcon name={icon} colour="var(--yarn-tangerine)" /></span>{title}</h2>
      {children}
    </section>
  );
}
