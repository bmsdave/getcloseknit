import Link from "next/link";
import type { ReactNode } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import { BOT_USER_AGENT } from "@/lib/bot";
import { contactEmail, contactMailto } from "@/lib/contact";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "CloseKnitBot",
  description: "What CloseKnitBot reads on estate agents' websites, how politely, and how to opt out.",
  path: "/bot",
});

export default function BotPage() {
  const CONTACT = contactEmail();
  return (
    <main className="subpage" data-testid="bot-page">
      <SiteHeader />
      <SubpageHero
        eyebrow="CloseKnitBot"
        title="The crawler Close Knit uses to read estate agents' websites."
        lead={<>If CloseKnitBot visited your website, this page says who we are, what it reads, what it never
          takes and how to make it stop.</>}
        ornament="town"
        yarn="var(--yarn-sky)"
      />

      <div className="subpage-cards">
        <Section id="who" icon="people" title="Who runs it">
          <p>CloseKnitBot is run by Close Knit, an independent guide to London homes and areas. More about us is on the <Link href="/about">about page</Link>.</p>
        </Section>

        <Section id="reads" icon="search" title="What it reads">
          <p>
            Estate agents&apos; own websites only. First the homepage and the contact, terms and privacy pages, to
            confirm which company runs the site. Later, listing pages, for the price, bedrooms, type, postcode and
            the link to the listing.
          </p>
          <p>
            It also checks a few web addresses guessed from a registered agency&apos;s company name, reading only
            the homepage and the contact, terms and privacy pages, to find the company number.
          </p>
        </Section>

        <Section id="never" icon="check" title="What it never takes">
          <p>Photos, descriptions, names and phone numbers. None of them is read into our records or stored.</p>
        </Section>

        <Section id="how" icon="trend" title="How often, and how politely">
          <p>
            At most once a week. One request every 5 seconds, or slower if your robots.txt asks for a longer
            Crawl-delay. CloseKnitBot obeys robots.txt, and it stops at the first block: a refusal, a
            rate-limit answer or a challenge page ends the visit to your site, and it does not try again by another route.
          </p>
          <p>It identifies itself with this user agent:</p>
          <p><code data-testid="bot-user-agent">{BOT_USER_AGENT}</code></p>
        </Section>

        <Section id="opt-out" icon="help" title="Opt out, or correct something">
          <p>
            Write to <a href={contactMailto("CloseKnitBot opt-out: <your domain>")} data-testid="bot-opt-out">{CONTACT}</a> with
            your domain, and we will stop reading it and remove what we hold. You can also add a rule for
            {" "}<code>CloseKnitBot</code> to your robots.txt. For example, <code>User-agent: CloseKnitBot</code> followed
            by <code>Disallow: /</code>. If something we show about your agency is wrong, use the same address.
          </p>
        </Section>
      </div>
    </main>
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
