/**
 * MapToast's store: one short notice over the map at a time. Any code can call
 * showMapToast: the newest replaces the one showing, and it hides on its own after `ms`
 * (components/map-toast.tsx pauses that while it is hovered or focused). No React needed to call it,
 * so map code, sheets and later releases (My match, map layers) share one place and one look.
 *
 *   showMapToast("Location is blocked for this site.", { link: { label: "How to allow", onClick: openSteps } });
 *   showMapToast("Reset to default", { action: { label: "Undo", onClick: undo } });
 *   hideMapToast();
 */
export interface MapToastButton {
  label: string;
  onClick: () => void;
}

export interface MapToastOptions {
  /** A text link after the message ("How to allow"): it opens something and leaves the toast up. */
  link?: MapToastButton;
  /** One action button ("Try again", "Undo"): pressing it runs onClick and hides the toast. */
  action?: MapToastButton;
  /** How long it stays up (ms); default MAP_TOAST_MS. */
  ms?: number;
  /** A stable name for tests and analytics ("location-blocked"); the text is for people. */
  kind?: string;
}

export interface MapToastMessage extends MapToastOptions {
  id: number;
  text: string;
  ms: number;
}

/** Default time on screen (board V4-10): 6 s; "Pick at least one" 4 s, "Link copied" 3 s. */
export const MAP_TOAST_MS = 6000;

let current: MapToastMessage | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Shows `text` over the map, replacing any toast showing; returns its id (for hideMapToast). */
export function showMapToast(text: string, options: MapToastOptions = {}): number {
  current = { ...options, id: nextId++, text, ms: options.ms ?? MAP_TOAST_MS };
  emit();
  return current.id;
}

/** Hides the toast: any toast, or only the one with `id` (a stale timer never hides a newer one). */
export function hideMapToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

export function currentMapToast(): MapToastMessage | null {
  return current;
}

export function subscribeMapToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
