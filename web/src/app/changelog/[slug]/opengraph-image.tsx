import { formatEntryDate, isoWeek } from "@/lib/changelog";
import { changelogEntry } from "@/lib/changelog-files";
import { CARD_SIZE, CARD_TYPE, cardNotFound, renderCard } from "@/lib/og-card";

// The entry's link card for X, Bluesky and Mastodon: its week, title and number of the week.
export const alt = "A week on the Close Knit changelog";
export const size = CARD_SIZE;
export const contentType = CARD_TYPE;

interface CardProps { params: Promise<{ slug: string }> }

export default async function ChangelogCard({ params }: CardProps) {
  const entry = changelogEntry((await params).slug);
  if (!entry) return cardNotFound();
  return renderCard({
    eyebrow: `Changelog · Week ${isoWeek(entry.date)}`,
    title: entry.title,
    figure: entry.number?.value ?? null,
    aside: entry.number?.label ?? null,
    source: entry.number ? `Source: ${entry.number.source}` : formatEntryDate(entry.date),
    demo: false,
  });
}
