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
