/**
 * Words that say where Close Knit covers (FLAGS.md CLOSE_KNIT_ENGLAND). London's map keeps its London words; England's
 * names no single place, reads ranks within each area's region, and promises a commute only where there is one
 * (TfL journeys: London only).
 */
import { coversEngland as scopeCoversEngland, loadedScope } from "./scope";

export const LONDON_VALUE_LINE = "What London homes really sold for, and which areas fit your budget and commute";
export const ENGLAND_VALUE_LINE = "What homes really sold for, and which areas fit your budget";

/** The first view's value line; the default <title> mirrors it. */
export function valueLine(england: boolean): string {
  return england ? ENGLAND_VALUE_LINE : LONDON_VALUE_LINE;
}

/** The page's scope is England (components/scope-context.tsx; London before it is known). */
export function coversEngland(): boolean {
  return scopeCoversEngland(loadedScope());
}

/** What a rank is "of": London, or on England's map each area's own region ("the upper half of its region"). */
export function rankPlace(england = coversEngland()): string {
  return england ? "its region" : "London";
}

/** "London " before a noun ("A London home search") on London's map, nothing on England's. */
export function londonWord(england = coversEngland()): string {
  return england ? "" : "London ";
}

/** A local authority in words: London's are boroughs, the rest of England's councils (no "borough" outside London). */
export function councilWord(london: boolean, plural = false): string {
  return `${london ? "borough" : "council"}${plural ? "s" : ""}`;
}

/**
 * A source note in the words of the area it sits under: London's notes say "borough", the rest of England's
 * councils ("Borough-wide: every neighbourhood in a borough…" reads "Council-wide: … in a council…" in Leeds).
 * Names that only contain the word (Peterborough, Borough Market) keep it.
 */
export function localNote(text: string, london: boolean): string {
  if (london) return text;
  return text.replace(/\b([Bb])orough(?! Market)(s?)\b/g, (_match, initial: string, plural: string) =>
    `${initial === "B" ? "C" : "c"}ouncil${plural}`);
}
