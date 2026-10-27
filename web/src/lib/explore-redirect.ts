// /explore and /explore/<lens> were a copy of the map's Layers menu. Their old links
// open the map coloured by that lens (308): /explore/<slug or old id> → /?layer=custom:<criterion id>.
// Layers v5: a lens merged into another opens that one (MERGED_LAYERS); one dropped from the menu
// (PRESET_EXCLUSIONS) still paints, with its card in the panel, so its link keeps working.
import type { MapLayerId } from "./contracts";
import { FEATURED_PRESET_IDS, presetBySlug } from "./custom-presets";
import { MERGED_LAYERS } from "./map-state";

/** Where an old /explore link goes: its lens's layer, the first everyday lens for /explore, else the map. */
export function exploreRedirect(slug: string | null): string {
  const id = slug === null ? FEATURED_PRESET_IDS[0] : presetBySlug(slug)?.criterion.id;
  if (!id) return "/";
  const layer: MapLayerId = `custom:${id}`;
  return `/?layer=${MERGED_LAYERS[layer] ?? layer}`;
}

/** A permanent redirect with a relative Location, so it holds behind any proxy. */
export function permanentRedirectResponse(location: string): Response {
  return new Response(null, { status: 308, headers: { Location: location } });
}
