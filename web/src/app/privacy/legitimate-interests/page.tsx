import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

// The public copy of docs/legal/legitimate-interests-assessment.md; keep the two in step.
// The controller comes from the deployment environment at request time.
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Legitimate interests assessment",
  description: "Why Close Knit may show per-home property records, and the safeguards that make it fair.",
  path: "/privacy/legitimate-interests",
});

export default function LegitimateInterestsPage() {
  const CONTROLLER = process.env.CLOSE_KNIT_CONTROLLER || "the Close Knit operator";
  return (
    <main className="methodology page-prose" data-testid="lia-page">
      <Link href="/privacy" className="back-link">← Privacy notice</Link>
      <p className="eyebrow">Legitimate interests assessment</p>
      <h1>Why we may show per-home property records.</h1>
      <p className="methodology-intro">
        The data controller is {CONTROLLER}. This assessment covers publishing, for each home in
        London, its recorded sale history (HM Land Registry Price Paid), its floor area (from the
        energy certificate used to match it), the building facts of its latest energy certificate
        (energy rating, certificate date, property type, built form, age band, habitable rooms, floor
        level), the price range of same-type sales in its area today with the coarse band its last
        sale fell in that year (for example &ldquo;top quarter&rdquo;), and the freehold parcel and
        coordinate of the home, on this website and its API and agent endpoints. We review it with
        every data release, and at least every 12 months.
      </p>

      <section className="methodology-card">
        <h2>1. Purpose: is there a legitimate interest?</h2>
        <ul>
          <li>Making already public property records understandable and comparable (price per m²,
            area price ranges, with evidence) for people moving home, renters, researchers,
            journalists and software agents, with every figure traceable to its source release.</li>
          <li>HM Land Registry publishes sale prices and addresses under the Open Government Licence so
            they can be reused. What we add is the floor-area match and area statistics, not new
            personal data. We never state what a single home is worth.</li>
          <li>The benefits are better-informed buying decisions, a more transparent housing market, and
            evidence anyone can reproduce: every number cites a release and its caveats.</li>
          <li>The processing is lawful and fair: no private sources, no inferences about individuals, no
            profiling.</li>
        </ul>
      </section>

      <section className="methodology-card">
        <h2>2. Necessity: is the processing necessary?</h2>
        <ul>
          <li>A sale without its address is useless for this purpose, because comparables are
            address-specific. Area medians are shown too, but they cannot replace per-home evidence.</li>
          <li>We keep the data to a minimum. We serve only the address, sale date and price, floor
            area, derived £/m² and value, confidence, parcel id and coordinate. The property page adds
            only the energy-certificate building facts listed above. We discard the certificate&rsquo;s
            tenure (it describes the occupant), names, running costs, recommendations and certificate
            addresses when we load it. We hold no names or occupier data.</li>
          <li>Each data release is fixed once published and is replaced by the next one. Older releases
            are not served.</li>
        </ul>
      </section>

      <section className="methodology-card">
        <h2>3. Balancing: do individuals&rsquo; interests override it?</h2>
        <p>
          <strong>The data.</strong> It is not special-category data. It describes a transaction, not
          a person&rsquo;s private life, and it is already public. Even so, a price attached to an
          address can reveal a household&rsquo;s wealth, and other public sources can link an address
          to a name.
        </p>
        <p>
          <strong>Reasonable expectations.</strong> HM Land Registry tells buyers and sellers that
          sale prices are published, and property portals publish the same data. People would not
          expect it to be combined with non-public sources (we do not do that), or to have no way to
          object (they can).
        </p>
        <p>
          <strong>Likely impact: low.</strong> No figure states what a home is worth: a home shows its
          recorded sales and its area&apos;s prices, and its last sale only as a coarse band (one of six,
          never a percentile), each shown only when at least 5 sales stand behind it. No decisions are
          made about anyone.
        </p>
        <h3>Safeguards</h3>
        <ul>
          <li>A <Link href="/privacy">privacy notice</Link>, linked from every page and next to the
            figures.</li>
          <li>An objection route that works. You confirm by e-mail. The home is then removed from
            search, histories, property pages, agent tools and map tiles as soon as you open the link,
            and within 30 days in every case. We store only salted hashes of the e-mail and IP
            address.</li>
          <li>A way to report wrong data, which is recorded and passed to the operator.</li>
          <li>Rate limits and no bulk address export. Per-home data is served one home at a time, or
            as map tiles without energy-certificate content.</li>
          <li>No advertising cookies and no third-party analytics. Search details reach analytics only
            if you opt in; site usage is counted first-party, without linking it to a person or home,
            and can be switched off on the privacy page.</li>
        </ul>
      </section>

      <section className="methodology-card">
        <h2>Conclusion</h2>
        <p>
          With these safeguards in place, individuals&rsquo; interests do not override the legitimate
          interest. Lawful basis: Article 6(1)(f) UK GDPR.
        </p>
      </section>
    </main>
  );
}
