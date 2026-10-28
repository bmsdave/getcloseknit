import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { bulletYarn, EntryBullets, EntryDate, EntryNext, NumberOfWeek } from "@/components/changelog/changelog-parts";
import { ChangelogShare } from "@/components/changelog/changelog-share";
import { Dot } from "@/components/knit";
import { KnitIcon } from "@/components/knit/knit-icon";
import { StemDivider } from "@/components/knit/satin";
import { SiteHeader } from "@/components/site-header";
import { CHANGELOG_PATH, CHANGELOG_RSS_PATH, changelogPath, entryLinks, entrySummary, postText, withoutLinks } from "@/lib/changelog";
import { changelogEntry, loadChangelog } from "@/lib/changelog-files";
import { changelogMetadata, siteOrigin } from "@/lib/seo";

interface EntryProps { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: EntryProps): Promise<Metadata> {
  const entry = changelogEntry((await params).slug);
  // The card is this segment's opengraph-image.tsx.
  return entry ? changelogMetadata({ title: entry.title, description: entrySummary(entry), path: changelogPath(entry.slug), image: null }) : {};
}

/** One week's entry (board KHt56r65): bullets, the number of the week, Try it links, and Share. */
export default async function ChangelogEntryPage({ params }: EntryProps) {
  const { slug } = await params;
  const entries = loadChangelog();
  const index = entries.findIndex((entry) => entry.slug === slug);
  if (index < 0) notFound();
  const entry = entries[index];
  const newer = entries[index - 1] ?? null;
  const older = entries[index + 1] ?? null;
  const url = `${(await siteOrigin()) ?? ""}${changelogPath(entry.slug)}`;
  return (
    <main className="subpage changelog changelog-entry" data-testid="changelog-entry-page" data-slug={entry.slug}>
      <SiteHeader />
      <div className="changelog-entry__layout">
        <article className="changelog-entry__article">
          <Link href={CHANGELOG_PATH} className="changelog-back" data-testid="changelog-back">
            <KnitIcon name="arrow-left" className="changelog-back__icon" />Changelog
          </Link>
          <EntryDate entry={entry} />
          <h1>{entry.title}</h1>
          <EntryBullets bullets={entry.bullets.map((bullet) => withoutLinks(bullet))} />
          {entry.number && <NumberOfWeek number={entry.number} barWidth={640} />}
          {entry.next && <EntryNext next={entry.next} />}
          <section className="changelog-try" aria-labelledby="changelog-try">
            <h2 id="changelog-try" className="changelog-eyebrow">Try it</h2>
            <ul>
              {entryLinks(entry).map((link, linkIndex) => (
                <li key={link.href}>
                  <Link href={link.href} className="changelog-chip"><Dot colour={bulletYarn(linkIndex)} size={12} />{link.text}</Link>
                </li>
              ))}
            </ul>
          </section>
          {(newer || older) && (
            <>
              <StemDivider />
              <nav className="changelog-pager" aria-label="More entries">
                {older ? <Link href={changelogPath(older.slug)}>Older: {older.title}</Link> : <span />}
                {newer && <Link href={changelogPath(newer.slug)}>Newer: {newer.title}</Link>}
              </nav>
            </>
          )}
        </article>
        <div className="changelog-entry__aside">
          <ChangelogShare url={url} text={postText(entry)} />
          <a href={CHANGELOG_RSS_PATH} className="changelog-chip changelog-entry__rss">
            <Dot colour="var(--yarn-tangerine)" size={12} />RSS feed
          </a>
        </div>
      </div>
    </main>
  );
}
