import { PROFILE_STORAGE_KEY } from "./profile-state";
import { SAVED_SHORTLISTS_KEY } from "./saved-shortlists";

export const INTRO_DISMISSED_KEY = "close-knit.intro-dismissed.v1";
/** On <html> while the server-rendered first-visit card must stay out of sight (globals.css). */
export const INTRO_BOOT_ATTRIBUTE = "data-intro-boot";

/**
 * A link that already says what to look at (an area, a layer, places, a
 * street-level view, a shared match) skips the card: the visitor came for
 * that, not the pitch.
 */
export function isDeepLink(search: string, hash: string): boolean {
  const parameters = new URLSearchParams(search);
  const layer = parameters.get("layer");
  const zoom = Number(parameters.get("zoom"));
  // find=like and find=budget open My match (from an area page or a tool), rank= a ranking's top 10: the intro would cover it.
  return parameters.has("selected") || parameters.has("places") || parameters.has("rank") || parameters.has("school") || ["like", "budget"].includes(parameters.get("find") ?? "") || hash.includes("profile=")
    || (layer !== null && layer !== "price-per-square-metre") || (Number.isFinite(zoom) && zoom >= 13);
}

/**
 * Runs inline before the explorer's markup (app/page.tsx). The first-visit card is server-rendered,
 * so it is the first thing painted, not the last; this hides it before that paint wherever the card
 * may not be wanted: a deep link, a card already closed, or saved work (♡ N is the reminder).
 * useIntroCard removes the mark once it has decided. Same rules as isDeepLink (tests/map-defer.test.ts).
 */
export const INTRO_BOOT_SCRIPT = `try{var p=new URLSearchParams(location.search),l=p.get("layer"),z=Number(p.get("zoom")),s=localStorage;`
  + `if(p.has("selected")||p.has("places")||p.has("rank")||p.has("school")||p.get("find")==="like"||p.get("find")==="budget"||location.hash.indexOf("profile=")>=0`
  + `||(l!==null&&l!=="price-per-square-metre")||(isFinite(z)&&z>=13)`
  + `||s.getItem(${JSON.stringify(INTRO_DISMISSED_KEY)})==="1"||s.getItem(${JSON.stringify(SAVED_SHORTLISTS_KEY)})||s.getItem(${JSON.stringify(PROFILE_STORAGE_KEY)}))`
  + `document.documentElement.setAttribute(${JSON.stringify(INTRO_BOOT_ATTRIBUTE)},"hide")}catch(e){}`;
