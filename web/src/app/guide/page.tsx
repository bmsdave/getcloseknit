import type { Metadata } from "next";
import Link from "next/link";

import { GUIDE_ARTICLES, GUIDE_GROUPS, type GuideGroup } from "@/components/guide/articles";
import { LegacyAnchorRedirect } from "@/components/guide/legacy-anchor-redirect";
import { KnitIcon } from "@/components/knit/knit-icon";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import { GUIDE_ICONS, GUIDE_GROUP_YARN } from "@/lib/guide-icons";
import { GUIDE_SLUGS, guidePath } from "@/lib/guide-slugs";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Guide",
  description: "Short articles on what each figure on the map means, how it is made, and its sources and licences.",
  path: "/guide",
});

const groupId = (group: GuideGroup) => `guide-${group.toLowerCase().replace(/\s+/g, "-")}`;
/** The home-buying and renting terms sit with the buying articles. */
const GLOSSARY_GROUP: GuideGroup = "Buying a home";

export default function GuideIndexPage() {
  return (
    <main className="subpage guide" data-testid="guide-index">
      <LegacyAnchorRedirect />
      <SiteHeader />
      <SubpageHero
        eyebrow="Guide"
        title="Map guide"
        ornament="town"
        yarn="var(--yarn-sky)"
      />
      {GUIDE_GROUPS.map((group) => (
        <section key={group} className="guide-group" aria-labelledby={groupId(group)}>
          <h2 id={groupId(group)}>{group}</h2>
          <ul className="guide-cards">
            {GUIDE_SLUGS.filter((slug) => GUIDE_ARTICLES[slug].group === group).map((slug) => (
              <li key={slug}>
                <Link href={guidePath(slug)} className="guide-card" data-testid={`guide-card-${slug}`}>
                  <span className="guide-card__icon" aria-hidden="true">
                    <KnitIcon name={GUIDE_ICONS[slug]} colour={GUIDE_GROUP_YARN[group]} className="guide-card__glyph" />
                  </span>
                  <span className="guide-card__text">
                    <strong>{GUIDE_ARTICLES[slug].title}</strong>
                  </span>
                </Link>
              </li>
            ))}
            {/* The glossary lives in the guide (/glossary redirects here). */}
            {group === GLOSSARY_GROUP && (
              <li>
                <Link href="/guide/glossary" className="guide-card" data-testid="guide-card-glossary">
                  <span className="guide-card__icon" aria-hidden="true">
                    <KnitIcon name="book" colour={GUIDE_GROUP_YARN[group]} className="guide-card__glyph" />
                  </span>
                  <span className="guide-card__text"><strong>Glossary</strong></span>
                </Link>
              </li>
            )}
          </ul>
        </section>
      ))}
    </main>
  );
}
