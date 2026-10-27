/**
 * The desktop side panel's width (map-dock.tsx): wider by default than the old 380px, dragged by its left
 * edge between PANEL_MIN and PANEL_MAX and remembered per browser. It lives in one CSS variable on <html>,
 * --dock-w, which styles/layout.css turns into the panel's width and every offset beside it (the round
 * buttons, the bar, the toast). The boot script sets it before first paint, so a stored width never jumps.
 * Phones keep the bottom sheet; a phone on its side keeps its 360px panel.
 */

export const PANEL_WIDTH_KEY = "close-knit.panel-width.v1";
export const PANEL_DEFAULT = 460;
export const PANEL_MIN = 360;
export const PANEL_MAX = 760;
/** At least this much map stays left of the panel (layout.css clamps the same way for a narrow window). */
export const PANEL_MAP_ROOM = 420;
/** One arrow key press; Shift moves four steps. */
export const PANEL_STEP = 16;

/** A width the panel can take in a window `viewport` px wide: whole pixels within the limits and the room left for the map. */
export function clampPanelWidth(width: number, viewport = Infinity): number {
  const max = Math.max(PANEL_MIN, Math.min(PANEL_MAX, viewport - PANEL_MAP_ROOM));
  if (!Number.isFinite(width)) return Math.min(PANEL_DEFAULT, max);
  return Math.round(Math.min(max, Math.max(PANEL_MIN, width)));
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const store = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** The stored width (within PANEL_MIN–PANEL_MAX), or null: none, unreadable or blocked storage. */
export function readPanelWidth(storage: Store | null = store()): number | null {
  try {
    const raw = storage?.getItem(PANEL_WIDTH_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? clampPanelWidth(value) : null;
  } catch {
    return null;
  }
}

/** Remembers `width`; the default (a double-click reset) clears the key. Storage that throws is ignored. */
export function writePanelWidth(width: number | null, storage: Store | null = store()): void {
  try {
    if (width === null || width === PANEL_DEFAULT) storage?.removeItem(PANEL_WIDTH_KEY);
    else storage?.setItem(PANEL_WIDTH_KEY, String(clampPanelWidth(width)));
  } catch {
    // Private mode or blocked storage: the width lasts this page only.
  }
}

/** Puts `width` (null: the default) on <html> as --dock-w. */
export function applyPanelWidth(width: number | null, root: HTMLElement = document.documentElement): void {
  if (width === null) root.style.removeProperty("--dock-w");
  else root.style.setProperty("--dock-w", `${width}px`);
}

/** Runs inline before the explorer's markup (app/page.tsx): the stored width, clamped as readPanelWidth does. */
export const PANEL_WIDTH_BOOT = `try{var w=Number(localStorage.getItem(${JSON.stringify(PANEL_WIDTH_KEY)}));`
  + `if(w)document.documentElement.style.setProperty("--dock-w",Math.round(Math.min(${PANEL_MAX},Math.max(${PANEL_MIN},w)))+"px")}catch(e){}`;
