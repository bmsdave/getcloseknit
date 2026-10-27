import Link from "next/link";
import type { ReactNode } from "react";

import { AnalyticsToggle } from "@/components/analytics-toggle";
import { ClearDeviceData } from "@/components/clear-device-data";
import { KnitIcon } from "@/components/knit/knit-icon";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import { contactEmail } from "@/lib/contact";

// Controller, contact and ICO number come from the deployment environment at
// request time, not from the build.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Privacy notice",
  description: "What Close Knit publishes about homes, on what basis, and how to correct or hide it.",
};

export default function PrivacyPage() {
  const CONTACT = contactEmail();
  const CONTROLLER = process.env.CLOSE_KNIT_CONTROLLER || "the Close Knit operator";
  const ICO_NUMBER = process.env.CLOSE_KNIT_ICO_NUMBER || null;
  return (
    <main className="subpage page-prose" data-testid="privacy-page">
      <SiteHeader />
      <SubpageHero
        eyebrow="Privacy notice"
        title="What we publish about homes, and how to change it."
        lead={<>Close Knit shows public-record information about properties in London: recorded sale
          prices and prices in its area. We never state what a single home is worth. A sale price attached to an
          address can be personal data under UK GDPR, so this notice explains who is responsible, why
          the data is shown, and how to have a home corrected or hidden.</>}
        ornament="fairisle"
        yarn="var(--yarn-cobalt)"
      />
      <nav className="subpage-toc" aria-label="On this page">
        <ul>
          {SECTIONS.map(([id, , title]) => <li key={id}><a href={`#${id}`}>{title}</a></li>)}
        </ul>
      </nav>

      <div className="subpage-cards">
      <section id="confirmed" className="subpage-note" data-testid="privacy-confirmation-status">
        <p className="eyebrow">Hide-my-home confirmation</p>
        <p>
          If you arrived here from a confirmation e-mail: with <code>#confirmed</code> in the address
          bar the request is active and the home has left search, history and the map. With{" "}
          <code>#confirm-failed</code> the link was unknown or already used — send the request again
          from the map or write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </section>

      <Section id="controller">
        <p>
          The data controller is {CONTROLLER}, contact <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          {ICO_NUMBER ? ` ICO registration ${ICO_NUMBER}.` : " ICO registration: see the release checklist."}
        </p>
      </Section>

      <Section id="data">
        <ul>
          <li><strong>HM Land Registry Price Paid Data</strong> (Open Government Licence): address, price, date and type of every recorded sale.</li>
          <li><strong>Energy Performance Certificates</strong> (Department for Levelling Up, Housing and Communities): used to match a sale to a UPRN, and for each home's latest certificate we keep the building facts: current and potential energy rating, certificate date, property type, built form, age band, floor area, habitable rooms and floor level. We do not show them for individual homes while their publication terms are being confirmed. We do not keep the certificate's tenure (it describes the occupant), names, running costs, recommendations or address.</li>
          <li><strong>OS Open UPRN</strong> (OGL): the coordinate of each dwelling.</li>
          <li><strong>OS Open Names</strong> (OGL): London street names and a point on each street, so search can find a street whose homes have no recorded sale. It holds no house numbers or addresses.</li>
          <li><strong>HM Land Registry INSPIRE index polygons</strong> (OGL with HMLR/OS conditions): freehold parcel outlines.</li>
          <li><strong>OpenStreetMap</strong> (ODbL): roads that bound street blocks.</li>
          <li><strong>ONS, police.uk and other area statistics</strong>: aggregated by area, never by home.</li>
          <li><strong>Ofsted Early Years, DfT road safety (STATS19) and TfL cycle lanes</strong> (Open Government Licence; Powered by TfL Open Data): nurseries&rsquo; published inspection grades (childminders are not included), pedestrians and cyclists hurt in police-reported collisions counted by area (never a person or a vehicle), and cycle lanes and Cycleways for the map.</li>
        </ul>
        <p>
          We do not hold names, contact details or anything about the people who live in a home.
          Derived figures (£/m², area price ranges, the coarse band of a recorded sale) are computed from the sources above.
        </p>
        <p>
          Next to an address we also list other homes&rsquo; recorded sales in the same building and
          on the same street (last 10 years): date, price, property type, tenure and new-build flag
          only. Those lists never show another home&rsquo;s floor area or £/m²; a median £/m² appears
          only when at least 5 sales stand behind it, and hidden homes are left out.
        </p>
        <p>
          The area evidence pack and the local market figures are area totals only: sale counts,
          turnover, the leasehold share of sales and median £/m² (shown only from 10 sales). They
          carry no address list, no valuation and nothing about who owns a home; with an address
          they add only that building&rsquo;s and street&rsquo;s counts and medians, never the sales.
        </p>
      </Section>

      <Section id="your-home">
        <p>
          If you own or live in a London home, Close Knit may show: its address and location, its
          recorded sales (date, price, property type, tenure, new-build flag), its floor area and
          the building facts from its latest energy certificate (listed above), and figures we
          derive from them (£/m², and the coarse band its last sale fell in among same-type sales in
          its area that year, such as &ldquo;top quarter&rdquo;; never a value for the home). We did not get this from you: addresses
          and sales come from HM Land Registry, building facts from the Energy Performance of
          Buildings register, and locations from Ordnance Survey (OS Open UPRN), all publicly
          available. We keep it as long as the release it belongs to is served (see Retention).
        </p>
        <p>
          We hold no names or contact details, and tracing and writing to the owner of every home in
          London would involve a disproportionate effort (UK GDPR Article 14(5)(b)). So instead we
          publish this notice, link it next to every home, and let anyone object and have a home
          hidden.
        </p>
      </Section>

      <Section id="lawful-basis">
        <p>
          We rely on <strong>legitimate interests</strong> (UK GDPR Article 6(1)(f)): making already
          public property records understandable for buyers, renters, researchers and the public,
          with the evidence behind each figure. The balancing test is documented in our{" "}
          <Link href="/privacy/legitimate-interests">legitimate interests assessment</Link>. Safeguards:
          data is limited to the fields listed above, figures carry their caveats, and any owner or
          occupier can object and have the home hidden.
        </p>
      </Section>

      <Section id="hide-my-home">
        <p data-testid="privacy-right-to-object">
          <strong>You have the right to object</strong>, at any time, to our processing of data
          about your home on the basis of legitimate interests (UK GDPR Article 21). You do not need
          to give a reason: once confirmed, we hide the home everywhere we show it.
        </p>
        <p>
          Select the home on the map and choose <em>Report or hide this home</em>. To hide it we ask
          for an e-mail address and send a confirmation link; the home disappears as soon as you open
          it (and in any case within 30 days of a valid objection). We store a salted hash of the
          e-mail and of the requesting connection to enforce daily limits, never the address itself.
          You can also write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>

      <Section id="rights">
        <p>
          You can also ask for access to, correction of (choose <em>Report or hide this home</em> on
          the map to report a wrong figure), erasure of, or restriction of data about you, by
          writing to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. You may complain to the{" "}
          <a href="https://ico.org.uk/make-a-complaint/">Information Commissioner&apos;s Office</a>.
        </p>
      </Section>

      <Section id="recipients">
        <ul>
          <li><strong>Hosting</strong>: our hosting provider, OVHcloud, runs the server that holds the
            data and the logs, in a UK data centre.</li>
          <li><strong>Map tiles</strong>: the background map is loaded by your browser from
            OpenFreeMap (tiles.openfreemap.org), which therefore sees your IP address and the map area
            you view.</li>
          <li><strong>In Claude</strong>: the shortlist board Close Knit shows inside Claude loads its map
            from OpenFreeMap and the map library from jsDelivr (cdn.jsdelivr.net), which therefore see your
            IP address.</li>
          <li><strong>E-mail</strong>: when e-mail is configured, hide-my-home confirmation links and
            correction reports are sent through our e-mail (SMTP) provider; when a reporting webhook is
            configured, reports reach the operator through it.</li>
        </ul>
      </Section>

      <Section id="retention">
        <p>
          Property data lives as long as the data release it belongs to is served; releases are
          immutable and replaced, not edited. Objections are kept while they are active so the home
          stays hidden across releases; hide requests never confirmed are deleted after 30 days. Correction reports are kept until resolved; feedback sent by an assistant or from the site for 12 months; usage events for 180 days. Web server and
          container logs hold IP addresses for up to 30 days for abuse prevention, then are
          deleted.
        </p>
      </Section>

      <Section id="cookies">
        <p>
          No advertising cookies and no third-party analytics. In the private preview one cookie
          remembers that your browser was invited. Your map position and saved search stay in your
          browser&apos;s local storage. To rank areas, your search (budget, bedrooms, priorities,
          commute destinations) is sent with each match request and used only to build the answer;
          it is not saved.
        </p>
        <p data-testid="privacy-usage-data">
          If you tick <em>Share redacted usage data to improve matching</em> under Your search, each
          match request also saves a redacted record: buy or rent, budget rounded to £50,000,
          bedrooms, forecast horizon, priority weights, the number and travel modes of commute
          destinations, school phases and the time. It holds no destinations, location, address, IP
          address or identifier. Untick the box to stop.
        </p>
        <p data-testid="privacy-usage-analytics">
          <strong>How the site is used.</strong> To see which pages people open, whether searches
          find something, how long pages are in use and which portal links are followed, your browser
          sends us a few named events: the page&apos;s address (never a home or full postcode), the
          kind of action, the map layer and the areas you open, where the map is centred after you move
          it (to about a kilometre) and the zones you set, and for a portal link the portal, area and
          postcode district. What you type in search is kept as words only: a postcode becomes its
          district and anything with a house number is not kept; a chosen home is kept only as its
          postcode district. To count returning visitors your browser
          keeps one random identifier in local storage. It is not linked to you, your invite, your
          search or your IP address, it is never shared, and the events are kept for 180 days, only to
          improve Close Knit (statistical purposes, which UK law allows without consent as long as you
          can object). In an EU or EEA time zone no identifier is kept. With Global Privacy Control or
          Do Not Track on, or with analytics off, nothing is sent.
        </p>
        <AnalyticsToggle />
        <p data-testid="privacy-map-setup">
          <strong>Your map setup.</strong> The layer, what Show draws with its filters, and where the map was
          are kept in this browser only, so the map opens as you left it. Nothing of it is sent to us.
        </p>
        <ClearDeviceData />
        <p id="feedback" data-testid="privacy-feedback">
          <strong>Feedback you send.</strong> When you tap thumbs up or down on a card or a shortlist, or
          send the <Link href="/feedback">feedback form</Link>, we store your vote or star rating, the
          reasons you tapped, any words you wrote, the page&apos;s address (never a home or full postcode;
          an area page&apos;s address names the area) and the device type. It is not linked to the analytics identifier,
          an invite or your IP address, and we remove e-mail addresses and phone numbers from the text.
          Your browser remembers the votes you gave so a card can show them. Analytics off doesn&apos;t
          stop feedback you choose to send. We keep it for 12 months to improve Close Knit, then delete it.
        </p>
      </Section>

      <Section id="agents">
        <p>
          The same data is served to software agents through the API and MCP endpoint, with the same
          suppression: a hidden home is hidden everywhere. Requests are rate limited per client.
        </p>
        <p data-testid="privacy-agent-usage">
          We count tool calls (which tool, whether it worked, how long it took, the assistant&apos;s name)
          and group one conversation&apos;s calls under a one-way tag, never its content. Listing links an
          assistant gives you pass through Close Knit&apos;s /go address, which counts the visit and opens
          the portal.
        </p>
        <p data-testid="privacy-agent-feedback">
          With your agreement, an assistant such as Claude can send us feedback about how the tools
          worked (what was wrong, missing or useful). It is meant to describe the product, not you: we
          ask assistants to leave out names, contact details, addresses, family and money, and we remove
          e-mail addresses and phone numbers before storing it. We keep it for 12 months to improve
          Close Knit, then delete it.
        </p>
      </Section>
      </div>
      <p className="subpage-foot"><Link href="/guide">Sources &amp; methodology</Link><Link href="/terms">Terms of use</Link></p>
    </main>
  );
}

/** id, yarn icon, heading: the order of the cards and of the "On this page" chips. */
const SECTIONS: [string, string, string][] = [
  ["controller", "people", "Controller"],
  ["data", "layers", "What we process and where it comes from"],
  ["your-home", "key", "If your home appears here"],
  ["lawful-basis", "check", "Why we show it (lawful basis)"],
  ["hide-my-home", "home", "Your right to object: hide a home"],
  ["rights", "help", "Your other rights"],
  ["recipients", "arrow-out", "Who else handles data"],
  ["retention", "fact-built", "Retention"],
  ["cookies", "info", "Cookies and analytics"],
  ["agents", "swap", "Agents and the API"],
];

function Section({ id, children }: { id: string; children: ReactNode }) {
  const [, icon, title] = SECTIONS.find(([key]) => key === id) ?? [id, "dot", id];
  return (
    <section id={id} className="subpage-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}><span className="subpage-card__icon" aria-hidden="true"><KnitIcon name={icon} colour="var(--yarn-cobalt)" /></span>{title}</h2>
      {children}
    </section>
  );
}
