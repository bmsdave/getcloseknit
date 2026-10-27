/**
 * The map's three layouts, one source for JS; styles/*.css repeat the same queries.
 *
 * - Short (a phone on its side, or any window under 500 px tall and wider than tall): one-row top bar,
 *   three round buttons, locate alone, a slim legend; sheets open as a 360 px right-side panel.
 * - Phone (≤ 800 px wide and not short): bottom sheets.
 * - Desktop (wider than 800 px and not short): the side panel and floating cards.
 *
 * Height wins over width: a 667 × 375 phone on its side is short, not a phone.
 */
export const SHORT_QUERY = "(max-height: 499px) and (orientation: landscape)";
export const PHONE_QUERY = "(max-width: 800px) and (min-height: 500px), (max-width: 800px) and (orientation: portrait)";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** Bottom sheets: a phone held upright. */
export function isPhone(): boolean {
  return matches(PHONE_QUERY);
}

/** The short layout: a phone on its side or a window under 500 px tall. */
export function isShort(): boolean {
  return matches(SHORT_QUERY);
}

/** A finger, not a mouse: taps get 44 px targets and no hover peek (lib/map-pick.ts). */
export function coarsePointer(): boolean {
  return matches("(pointer: coarse)") || !matches("(hover: hover)");
}
