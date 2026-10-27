/**
 * Which MapSheet is open: one at a time, by id ("layers", "show", "explainer",
 * "location-help", and later "match", "saved", "zones"). Opening one replaces the one open; the area
 * sheet (map-dock.tsx) is not in here: it lowers to its peek while another sheet is up and is never lost.
 *
 * On phones each open sheet owns one browser history entry, so the back gesture closes it, as in map
 * apps: the first sheet to open pushes the entry, a swap to another sheet keeps it, and a close that
 * is not the back gesture takes it off again.
 *
 *   openMapSheet("layers");  closeMapSheet("layers");  useOpenMapSheet() === "layers"
 */
import { isPhone, isShort } from "./viewport";

let open: string | null = null;
/** True while our history entry is on top of the stack. */
let entry = false;
/** A history.back() we started (✕, Esc, a swap to nothing): its popstate is not the visitor's back. */
let ownBack = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Phones and the short layout (a phone on its side): the back gesture closes the sheet. */
function phone(): boolean {
  return isPhone() || isShort();
}

function onPopState() {
  if (ownBack) {
    ownBack = false;
    return;
  }
  if (!entry) return;
  entry = false;
  if (open === null) return;
  open = null;
  emit();
}

if (typeof window !== "undefined") window.addEventListener("popstate", onPopState);

export function openMapSheet(id: string): void {
  if (open === id) return;
  open = id;
  if (!entry && phone()) {
    entry = true;
    // Same address: only a step for the back gesture to take.
    window.history.pushState(null, "");
  }
  emit();
}

/** Closes `id` (or whatever is open when no id is given); a sheet that is not open is left alone. */
export function closeMapSheet(id?: string): void {
  if (open === null || (id !== undefined && open !== id)) return;
  open = null;
  emit();
  if (entry) {
    entry = false;
    ownBack = true;
    window.history.back();
  }
}

/**
 * The page is going away with a sheet open (a link to another page): forget it without touching
 * history, which the navigation owns now.
 */
export function forgetMapSheet(id: string): void {
  if (open !== id) return;
  open = null;
  entry = false;
  emit();
}

export function openMapSheetId(): string | null {
  return open;
}

export function subscribeMapSheets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
