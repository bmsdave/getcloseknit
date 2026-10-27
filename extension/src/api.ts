// Shared by the background worker and the popup. `browser` (Safari, Firefox) and `chrome` both
// offer promise-returning storage and runtime calls in Manifest V3.
declare const API_BASE: string;
declare const browser: typeof chrome | undefined;

export const ext: typeof chrome = typeof browser !== "undefined" ? browser : chrome;
export const apiBase: string = API_BASE;

export const PROFILE_KEY = "profile";
export const PROFILE_SAVED_AT_KEY = "profileSavedAt";
export const DISMISSED_KEY = "dismissedProfile";
export const ENABLED_KEY = "enabled";
/** After "Use it" the saved search follows changes on the site; "Stop using" turns that and the offer off. */
export const LINKED_KEY = "linked";
export const OPTED_OUT_KEY = "optedOut";

/** A short, stable fingerprint of a profile, to tell a new search from the one already saved. */
export function profileKey(profile: unknown): string {
  const text = JSON.stringify(profile ?? null);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
