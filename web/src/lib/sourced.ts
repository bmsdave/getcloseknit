// A hardcoded figure a visitor sees, kept in one object with where it came
// from and when, so the label shown beside it cannot drift from the value.
// "published": a figure someone published (Bank of England, HMRC, TfL…).
// "practice": a common rule of thumb, reported but not law and not measured.
// "assumption": a default or example we chose; nobody published it.

export type SourcedKind = "published" | "practice" | "assumption";

export interface Sourced<T> {
  value: T;
  kind: SourcedKind;
  /** Who published it, or who chose it for an assumption. Short: shown inline. */
  source: string;
  sourceUrl?: string;
  /** When the figure applies or was checked: YYYY, YYYY-MM or YYYY-MM-DD. */
  asOf: string;
  /** Word put before the date, e.g. "checked" or "from"; none by default. */
  asOfVerb?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2022", "Aug 2026" or "5 Oct 2026"; the input unchanged if it is none of those shapes. */
export function formatAsOf(asOf: string): string {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(asOf);
  if (!match) return asOf;
  const [, year, month, day] = match;
  if (!month) return year;
  const name = MONTHS[Number(month) - 1];
  return day ? `${Number(day)} ${name} ${year}` : `${name} ${year}`;
}

/**
 * The label shown beside the figure:
 * "Bank of England, Aug 2026", "gov.uk rates checked 5 Oct 2026",
 * "typical agent rule, not law (Close Knit research, Oct 2026)",
 * "example assumption, not market data (Close Knit, Oct 2026)".
 */
export function sourceLabel(figure: Sourced<unknown>): string {
  const when = `${figure.asOfVerb ? `${figure.asOfVerb} ` : ""}${formatAsOf(figure.asOf)}`;
  const cited = `${figure.source}${figure.asOfVerb ? " " : ", "}${when}`;
  if (figure.kind === "practice") return `typical agent rule, not law (${cited})`;
  if (figure.kind === "assumption") return `example assumption, not market data (${cited})`;
  return cited;
}
