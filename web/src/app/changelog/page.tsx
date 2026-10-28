import type { Metadata } from "next";
import Link from "next/link";

import { EntryBullets, EntryDate, EntryNext, NumberOfWeek } from "@/components/changelog/changelog-parts";
import { Dot } from "@/components/knit";
import { StemDivider } from "@/components/knit/satin";
import { SiteHeader } from "@/components/site-header";
import { CHANGELOG_LEAD, CHANGELOG_PATH, CHANGELOG_RSS_PATH, CHANGELOG_TITLE, changelogPath } from "@/lib/changelog";
import { loadChangelog } from "@/lib/changelog-files";
import { changelogMetadata } from "@/lib/seo";

export const metadata: Metadata = changelogMetadata({ title: CHANGELOG_TITLE, description: CHANGELOG_LEAD, path: CHANGELOG_PATH });

/** /changelog (board KHt56r65): every week's entry, newest first, each with its number and a link to share it. */
export default function ChangelogPage() {
  const entries = loadChangelog();
  return (
    <main className="subpage changelog" data-testid="changelog-index">
      <SiteHeader />
      <header className="changelog-head">
        <div>
          <p className="changelog-eyebrow">Build in public</p>
          <h1>{CHANGELOG_TITLE}</h1>
          <p className="changelog-head__lead">{CHANGELOG_LEAD}</p>
        </div>
        <a href={CHANGELOG_RSS_PATH} className="changelog-chip" data-testid="changelog-rss">
          <Dot colour="var(--yarn-tangerine)" size={12} />RSS
        </a>
      </header>
      <ol className="changelog-list">
        {entries.map((entry, index) => (
          <li key={entry.slug} className="changelog-list__item" data-testid="changelog-entry" data-slug={entry.slug}>
            <div className="changelog-list__when">
              <Dot colour={index === 0 ? "var(--yarn-cherry)" : "var(--wool)"} size={14} />
              <EntryDate entry={entry} />
            </div>
            <article className="changelog-card">
              <h2><Link href={changelogPath(entry.slug)}>{entry.title}</Link></h2>
              <div className="changelog-card__body">
                <EntryBullets bullets={entry.bullets} />
                {entry.number && <NumberOfWeek number={entry.number} />}
              </div>
              {entry.next && <EntryNext next={entry.next} />}
              <StemDivider />
              <Link href={changelogPath(entry.slug)} className="changelog-card__more">Read and share</Link>
            </article>
          </li>
        ))}
      </ol>
    </main>
  );
}
