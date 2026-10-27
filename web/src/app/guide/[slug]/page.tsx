import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GUIDE_ARTICLES } from "@/components/guide/articles";
import { GuideShare } from "@/components/guide/guide-share";
import { MetricNotes } from "@/components/guide/metric-notes";
import { KnitIcon } from "@/components/knit/knit-icon";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import { GUIDE_GROUP_YARN, GUIDE_ICONS } from "@/lib/guide-icons";
import { GuideUseIt } from "@/components/guide/guide-use-it";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { guideAction, guideMore, guideTile, nextGuideSlug } from "@/lib/guide-routes";
import { GUIDE_SLUGS, guidePath, type GuideSlug } from "@/lib/guide-slugs";
import { pageMetadata } from "@/lib/seo";
import "@/styles/fine-print.css";

// Only the fixed slugs exist; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDE_SLUGS.map((slug) => ({ slug }));
}

function articleFor(slug: string) {
  return (GUIDE_SLUGS as readonly string[]).includes(slug) ? GUIDE_ARTICLES[slug as GuideSlug] : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = articleFor(slug);
  return article ? pageMetadata({ title: article.title, description: article.answer, path: guidePath(slug as GuideSlug) }) : {};
}

export default async function GuideArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = articleFor(slug);
  if (!article) notFound();
  const { Diagram } = article;
  const related = GUIDE_SLUGS.filter((other) => other !== slug && GUIDE_ARTICLES[other].group === article.group);
  const action = guideAction(slug as GuideSlug);
  const next = nextGuideSlug(slug as GuideSlug);
  return (
    <main className="subpage page-prose guide guide-article" data-testid="guide-article" data-slug={slug}>
      <SiteHeader />
      <SubpageHero
        eyebrow={<><Link href="/guide">Guide</Link><span aria-hidden="true"> · </span>{article.group}</>}
        title={article.title}
        lead={article.answer}
        leadTestId="guide-answer"
        ornament="fairisle"
        yarn={GUIDE_GROUP_YARN[article.group]}
      />
      <GuideUseIt action={action} more={guideMore(slug as GuideSlug)} tile={guideTile(slug as GuideSlug)}
        mode={evidenceServiceUrl() ? "real" : "demo"} />
      <figure className="guide-figure">
        <Diagram />
        <figcaption>{article.caption}</figcaption>
      </figure>
      <section className="guide-section" aria-labelledby="guide-example" data-testid="guide-example">
        <h2 id="guide-example">Example</h2>
        <div className="guide-example">{article.example}</div>
      </section>
      {article.sections?.map((section) => (
        <section key={section.id} className="guide-section" aria-labelledby={section.id} data-testid={`guide-section-${section.id}`}>
          <h2 id={section.id}>{section.title}</h2>
          {section.body}
        </section>
      ))}
      <section className="guide-section" aria-labelledby="guide-how">
        <h2 id="guide-how">{article.howTitle ?? "How we calculate it"}</h2>
        {article.how}
      </section>
      <details className="guide-fine-print" data-testid="guide-fine-print">
        <summary>
          <span>The fine print</span>
          <KnitIcon name="chevron-down" className="guide-fine-print__chevron" />
        </summary>
        <div className="guide-fine-print__body">
          {article.finePrint}
          {article.metricId && <MetricNotes metricId={article.metricId} />}
        </div>
      </details>
      {/* The article's own action is in Use it, under the answer; the foot goes on to the next article. */}
      <nav className="guide-article-foot" aria-label="After this article" data-testid="guide-article-foot">
        {next && (
          <Link href={guidePath(next)} className="guide-article-foot__quiet" data-testid="guide-next">
            Next: {GUIDE_ARTICLES[next].title}
            <KnitIcon name="arrow-right" className="guide-article-foot__icon" />
          </Link>
        )}
        <GuideShare title={article.title} />
      </nav>
      {related.length > 0 && (
        <nav className="guide-related" aria-label="More in this section">
          <h2>More on {article.group.toLowerCase()}</h2>
          <ul>
            {related.map((other) => (
              <li key={other}>
                <Link href={guidePath(other)}>
                  <KnitIcon name={GUIDE_ICONS[other]} colour={GUIDE_GROUP_YARN[article.group]} className="guide-related__icon" />
                  {GUIDE_ARTICLES[other].title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </main>
  );
}
