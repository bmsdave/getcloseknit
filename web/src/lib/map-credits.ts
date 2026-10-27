/**
 * The map credits (ⓘ corner, map-layers.tsx) opened from elsewhere: a phone on its side has no ⓘ
 * button, so the ≡ menu foot's "Map credits" opens them.
 */
export const MAP_CREDITS_EVENT = "close-knit:map-credits";

export function openMapCredits() {
  window.dispatchEvent(new Event(MAP_CREDITS_EVENT));
}
