/**
 * The Esc ladder (Map controls PR 1): one Escape press closes the top-most thing on the map, one step
 * per press: a hover peek (the tooltip, a hovered school or tree popup) → an open card or pinned popup →
 * the selection (the area is deselected and its sheet goes). Nothing open: Escape is left alone.
 *
 * Escape goes first to whatever claims it: a field being typed in, an open dialog or sheet (it closes
 * itself), a zone being drawn (its bar cancels), or a handler that already used the key.
 */

export interface EscapeRungs {
  /** A hover peek is up: the map tooltip, or a school or tree popup that only hovers. */
  peek: boolean;
  /** A pinned popup (a tapped school, tree or collision) is up. */
  card: boolean;
  /** An area is selected. */
  selection: boolean;
}

export type EscapeRung = keyof EscapeRungs;

export interface EscapeClaims {
  /** The key was typed into a field. */
  typing: boolean;
  /** A dialog or sheet is on screen: it closes itself. */
  dialog: boolean;
  /** A zone is being drawn: its bar cancels. */
  drawing: boolean;
  /** A handler already used the key (event.defaultPrevented). */
  handled: boolean;
}

const LADDER: EscapeRung[] = ["peek", "card", "selection"];

/** The rung this press closes, or null when the key is claimed or nothing is open. */
export function escapeRung(rungs: EscapeRungs, claims: EscapeClaims): EscapeRung | null {
  if (claims.typing || claims.dialog || claims.drawing || claims.handled) return null;
  return LADDER.find((rung) => rungs[rung]) ?? null;
}
