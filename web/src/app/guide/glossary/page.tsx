import Link from "next/link";

import { GUIDE_ARTICLES } from "@/components/guide/articles";
import { KnitIcon } from "@/components/knit/knit-icon";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import { GLOSSARY } from "@/lib/glossary";
import { GLOSSARY_GUIDE } from "@/lib/guide-routes";
import { guidePath } from "@/lib/guide-slugs";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Glossary",
  description: "Plain-English explanations of UK home-buying and renting terms, with links to GOV.UK.",
  path: "/guide/glossary",
});

export default function GlossaryPage() {
  return (
      <main className="subpage" data-testid="glossary-page">
        <SiteHeader />
        <SubpageHero
          eyebrow="Guide"
          title="Glossary"
          lead="Orientation, not legal or financial advice."
          ornament="town"
          yarn="var(--yarn-pink)"
        />
        <div className="subpage-cards glossary-cards">
          {GLOSSARY.map((entry) => {
            const guide = GLOSSARY_GUIDE[entry.id];
          return (
            <section key={entry.id} id={entry.id} className="subpage-card">
              <h2>{entry.term}</h2>
              <p className="glossary-card__short">{entry.short}</p>
              <p>{entry.long}</p>
              {guide && (
                <p>
                  <Link href={guidePath(guide)} className="glossary-card__guide" data-testid={`glossary-guide-${entry.id}`}>
                    In the guide: {GUIDE_ARTICLES[guide].title}
                  </Link>
                </p>
              )}
              <p>
                <a href={entry.url} target="_blank" rel="noreferrer" className="glossary-card__link">
                  Official guidance on GOV.UK
                  <KnitIcon name="arrow-out" />
                </a>
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
