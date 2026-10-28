import Link from "next/link";

import { Dot } from "@/components/knit";
import { SatinBlock, SatinStacked } from "@/components/knit/satin";
import type { ChangelogEntry, ChangelogNumber, Inline } from "@/lib/changelog";
import { formatEntryDate, isoWeek } from "@/lib/changelog";

/** Bullet dots and the number's parts, in yarn order (board: cherry, sky, cobalt, tangerine, leaf). */
const BULLET_YARN = ["var(--yarn-cherry)", "var(--yarn-sky)", "var(--yarn-cobalt)", "var(--yarn-tangerine)", "var(--yarn-leaf)"];
const PART_YARN = [
  "var(--yarn-cobalt)", "var(--yarn-sky)", "var(--yarn-cherry)", "var(--yarn-sun)", "var(--yarn-tangerine)",
  "var(--yarn-leaf)", "var(--yarn-pink)", "var(--muted)", "var(--ink)",
];

export const bulletYarn = (index: number) => BULLET_YARN[index % BULLET_YARN.length];
const partYarn = (index: number) => PART_YARN[index % PART_YARN.length];

/** One bullet's text: plain, bold and site links. */
export function InlineParts({ parts }: { parts: readonly Inline[] }) {
  return parts.map((part, index) => part.kind === "link"
    ? <Link key={index} href={part.href}>{part.text}</Link>
    : part.kind === "bold" ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>);
}

export function EntryBullets({ bullets }: { bullets: readonly (readonly Inline[])[] }) {
  return (
    <ul className="changelog-bullets" data-testid="changelog-bullets">
      {bullets.map((bullet, index) => (
        <li key={index}>
          <Dot colour={bulletYarn(index)} size={14} className="changelog-bullets__dot" />
          <span><InlineParts parts={bullet} /></span>
        </li>
      ))}
    </ul>
  );
}

/** "27 Oct 2026 · Week 44". */
export function EntryDate({ entry }: { entry: ChangelogEntry }) {
  return (
    <p className="changelog-date">
      <time dateTime={entry.date}>{formatEntryDate(entry.date)}</time>
      <span className="changelog-date__week"><span className="changelog-date__sep"> · </span>Week {isoWeek(entry.date)}</span>
    </p>
  );
}

/** The number of the week: the figure, what it counts, its parts as one satin bar with a legend, and its source. */
export function NumberOfWeek({ number, barWidth = 300 }: { number: ChangelogNumber; barWidth?: number }) {
  return (
    <section className="changelog-number" aria-label="Number of the week" data-testid="changelog-number">
      <span className="changelog-eyebrow">Number of the week</span>
      <p className="changelog-number__figure"><strong>{number.value}</strong> <span>{number.label}</span></p>
      {number.parts.length > 0 && (
        <>
          <SatinStacked className="changelog-number__bar" width={barWidth} height={14}
            parts={number.parts.map((part, index) => ({ value: part.value, colour: partYarn(index) }))} />
          <ul className="changelog-number__legend">
            {number.parts.map((part, index) => (
              <li key={part.name}>
                <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden="true">
                  <SatinBlock x={0} y={0} width={10} height={10} colour={partYarn(index)} seed={index + 7} />
                </svg>
                <span>{part.name}</span>
                <b>{part.value}</b>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="changelog-number__source">Source: <Link href={number.url}>{number.source}</Link></p>
    </section>
  );
}

export function EntryNext({ next }: { next: string }) {
  return <p className="changelog-next"><strong>Next:</strong> {next}</p>;
}
