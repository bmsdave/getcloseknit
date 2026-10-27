/**
 * Places overlay: places merged from OpenStreetMap, the FSA hygiene register,
 * Overture and Foursquare (GET /api/v1/tiles/places), drawn over whichever
 * layer colours the map as group icons, thinned so they never overlap: where
 * they would, the more important place (the tile's `score`, migration 036)
 * wins, so zoom 14-15 shows only landmarks and well-confirmed places and
 * zooming in reveals more. Names show from zoom 17 (or on hover / tap), so
 * the map never turns into a wall of labels. "Other" starts hidden.
 * Pure definitions so icons, the filter, tooltips and the address round-trip
 * are unit-testable.
 */
import type { SavedItemInput } from "./saved-items";
import type { ExpressionSpecification, FilterSpecification, SymbolLayerSpecification, VectorSourceSpecification } from "maplibre-gl";

import { placeBadgeSvg, rasterise, type MapImage } from "./map-yarn-images";
import { withRelease } from "./release-url";

export const PLACE_SOURCE_ID = "places";
export const PLACE_LAYER = "place-points";
export const PLACE_MIN_ZOOM = 14;
export const PLACE_TILE_MAX_ZOOM = 16;

/** The tile's own `group` values (place_group(), migration 035). */
export type PlaceTileGroup = "coffee" | "fast_food" | "restaurant" | "pub" | "gym" | "shop" | "culture" | "other";

/** What a visitor picks from: six groups, some covering two tile groups. */
export type PlaceGroup = "coffee" | "food" | "pub" | "shop" | "leisure" | "other";

/**
 * The six groups, their labels, colours (their own muted palette, searched in CIELAB to stay
 * ΔE ≥ 14 (Other ≥ 10) from every Ofsted top, award plaque, collision, TfL line, tree green and cycle sky,
 * ≥ 6 under deuteranopia / protanopia, no olive, white pictogram ≥ 3:1: places are background, schools
 * are primary), the tile groups
 * each one covers and a pictogram (SVG path in a 24-unit box, drawn white on a
 * badge of the group's colour) so a label reads without the colour too.
 */
export const PLACE_GROUPS: ReadonlyArray<{ id: PlaceGroup; label: string; colour: string; tiles: readonly PlaceTileGroup[]; icon: string }> = [
  // A cup with a handle on a saucer.
  { id: "coffee", label: "Coffee", colour: "#9d744d", tiles: ["coffee"],
    icon: "M4 7h13v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z M17 8.5h1.5a3.25 3.25 0 0 1 0 6.5H16.9l.3-2h1.3a1.25 1.25 0 0 0 0-2.5H17z M3 20.5h15V22H3z" },
  // A fork and a knife.
  { id: "food", label: "Food & takeaway", colour: "#c57d82", tiles: ["restaurant", "fast_food"],
    icon: "M5 2h1.6v6h1.2V2h1.6v6h1.2V2h1.6v7.5a3 3 0 0 1-2.4 2.94V22H7.4v-9.56A3 3 0 0 1 5 9.5z M15 2c3 1.2 4.4 4.4 4.4 8.6V13H17.6v9H15z" },
  // A pint glass, its head of foam filled.
  { id: "pub", label: "Pubs & bars", colour: "#946897", tiles: ["pub"],
    icon: "M5 2h14l-1.7 19a1.2 1.2 0 0 1-1.2 1H7.9a1.2 1.2 0 0 1-1.2-1z M7.6 8.5l1.3 11.5h6.2l1.3-11.5z" },
  // A shopping bag.
  { id: "shop", label: "Shops", colour: "#235b6e", tiles: ["shop"],
    icon: "M4 8h16l-1.2 14H5.2z M8 8V6.5a4 4 0 0 1 8 0V8h-2V6.5a2 2 0 0 0-4 0V8z" },
  // A star: something to do or see.
  { id: "leisure", label: "Sport & culture", colour: "#7292c1", tiles: ["gym", "culture"],
    icon: "M12 1.8l3.1 6.5 7.1.9-5.2 4.9 1.3 7.1L12 17.8l-6.3 3.4 1.3-7.1-5.2-4.9 7.1-.9z" },
  // A plain dot.
  { id: "other", label: "Other", colour: "#62514d", tiles: ["other"],
    icon: "M12 6a6 6 0 1 1 0 12a6 6 0 1 1 0-12z" },
];
const GROUP_IDS = PLACE_GROUPS.map((group) => group.id);
/** Shown when the overlay is turned on: every group but the catch-all "Other". */
const DEFAULT_GROUPS = GROUP_IDS.filter((id) => id !== "other");
/** Links shared before the groups were merged name the tile groups: they open the merged group. */
const LEGACY_GROUPS: Readonly<Record<string, PlaceGroup>> = { fast_food: "food", restaurant: "food", gym: "leisure", culture: "leisure" };
/** The area fill steps back to this share of its opacity where place points are drawn. */
export const PLACE_AREA_FADE = 0.75;
/** Place names show with their badge from the layer's first zoom, like map labels: the most important
 * places (tile score) get their name first, and a name with no room is dropped while its badge stays. */
export const PLACE_LABEL_ZOOM = 15;

export const PLACE_ATTRIBUTION =
  "Places: © OpenStreetMap contributors (ODbL 1.0); FSA Food Hygiene Rating Scheme (Open Government Licence v3.0); "
  + "Overture Maps Foundation (CDLA-Permissive-2.0); Foursquare Open Source Places (Apache 2.0)";

/** The same statement for MapLibre's attribution control, with links. */
const PLACE_ATTRIBUTION_HTML =
  "Places: © <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a> contributors (ODbL), "
  + "FSA food hygiene ratings (OGL v3.0), Overture Maps (CDLA-Permissive-2.0), Foursquare OS Places (Apache 2.0)";

export interface PlaceView {
  on: boolean;
  /** Groups shown; every group but "Other" by default. */
  groups: PlaceGroup[];
}

/** Places are on by default: like any good map, zooming in shows the cafés, gyms and shops people know. */
export const DEFAULT_PLACE_VIEW: PlaceView = { on: true, groups: [...DEFAULT_GROUPS] };

/**
 * Absent or ?places=all: on, the default groups (all but "Other");
 * ?places=coffee,pub,other: those groups; ?places=none: on, nothing ticked;
 * ?places=off: off. Unknown groups are ignored, and a list with none known
 * shows the default groups.
 */
export function placesFromQuery(search: string): PlaceView {
  const raw = new URLSearchParams(search).get("places");
  if (raw === null) return { ...DEFAULT_PLACE_VIEW, groups: [...DEFAULT_GROUPS] };
  if (raw.trim() === "off") return { on: false, groups: [...DEFAULT_GROUPS] };
  if (raw.trim() === "none") return { on: true, groups: [] };
  const named = raw.split(",").map((part) => part.trim()).map((part) => LEGACY_GROUPS[part] ?? part);
  const groups = GROUP_IDS.filter((id) => named.includes(id));
  return { on: true, groups: groups.length ? groups : [...DEFAULT_GROUPS] };
}

export function withPlacesQuery(query: string, view: PlaceView): string {
  const parameters = new URLSearchParams(query);
  if (!view.on) parameters.set("places", "off");
  else if (!view.groups.length) parameters.set("places", "none");
  else if (view.groups.length === DEFAULT_GROUPS.length && DEFAULT_GROUPS.every((id) => view.groups.includes(id))) parameters.delete("places");
  else parameters.set("places", GROUP_IDS.filter((id) => view.groups.includes(id)).join(","));
  return parameters.toString();
}

export function togglePlaceGroup(view: PlaceView, group: PlaceGroup): PlaceView {
  const groups = view.groups.includes(group)
    ? view.groups.filter((item) => item !== group)
    : GROUP_IDS.filter((id) => id === group || view.groups.includes(id));
  return { ...view, groups };
}

/** The map image of a group's icon. */
export function placeIconId(group: PlaceGroup): string {
  return `place-icon-${group}`;
}

/** Icon by the tile group: its merged group's badge. */
export function placeIcon(): ExpressionSpecification {
  const pairs = PLACE_GROUPS.flatMap((group) => group.tiles.flatMap((tile) => [tile, placeIconId(group.id)]));
  return ["match", ["get", "group"], ...pairs, placeIconId("other")] as unknown as ExpressionSpecification;
}

/**
 * A group's badge as an embroidered patch (lib/map-yarn-images.ts): a felt disc
 * in the group's colour, a running-stitch ring and the group's icon in white
 * plied yarn, 26 units square.
 */
export function placeBadgeMarkup(group: PlaceGroup): string {
  const spec = PLACE_GROUPS.find((item) => item.id === group) ?? PLACE_GROUPS[PLACE_GROUPS.length - 1];
  return placeBadgeSvg(spec.colour, `place-${spec.id}`);
}

/** Adds the six badges to a map once (drawn asynchronously); a map whose style was replaced gets them again. */
export function addPlaceIcons(map: { hasImage(id: string): boolean; addImage(id: string, image: MapImage, options?: { pixelRatio?: number }): void }, pixelRatio: number): void {
  const ratio = Math.max(1, Math.ceil(pixelRatio));
  for (const group of PLACE_GROUPS) {
    const id = placeIconId(group.id);
    if (map.hasImage(id)) continue;
    void rasterise(placeBadgeMarkup(group.id), 26, ratio).then((image) => {
      if (image && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: ratio });
    });
  }
}

/**
 * The tile groups the chosen groups cover. Chain shops (a shop with a brand: the
 * Co-op, a Tesco Express) are left out: on a map for choosing where to live they
 * read as advertising, not as character. Branded gyms and cafés stay.
 */
export function placeFilter(groups: readonly PlaceGroup[]): FilterSpecification {
  const tiles = PLACE_GROUPS.filter((group) => groups.includes(group.id)).flatMap((group) => group.tiles);
  return ["all",
    ["in", ["get", "group"], ["literal", tiles]],
    ["!", ["all", ["==", ["get", "group"], "shop"], ["has", "brand"]]],
  ] as FilterSpecification;
}

export function placeSource(origin: string, release?: string | null): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [withRelease(`${origin}/api/v1/tiles/places/{z}/{x}/{y}.pbf`, release)],
    minzoom: PLACE_MIN_ZOOM,
    maxzoom: PLACE_TILE_MAX_ZOOM,
    attribution: PLACE_ATTRIBUTION_HTML,
  };
}

// Dark ink on a light halo, as the area names: readable over any choropleth.
const LABEL_TEXT_COLOR = "#22252c";
const LABEL_HALO_COLOR = "#f8f6f0";

/**
 * One symbol layer: a badge, thinned so badges never overlap, and the name
 * from PLACE_LABEL_ZOOM (a name that would collide is dropped, its badge
 * stays); higher `score` is placed first (symbol-sort-key ascends).
 */
export function placeLayers(view: PlaceView): SymbolLayerSpecification[] {
  return [{
    id: PLACE_LAYER, type: "symbol", source: PLACE_SOURCE_ID, "source-layer": "places",
    minzoom: PLACE_MIN_ZOOM,
    filter: placeFilter(view.groups),
    layout: {
      visibility: view.on ? "visible" : "none",
      "symbol-sort-key": ["-", 0, ["to-number", ["get", "score"], 0]],
      "icon-image": placeIcon(),
      "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.8, 17, 1],
      // About half a street map's density, so the area colour stays the subject: only the most
      // important places at 14-15 (wide spacing), more as you zoom in.
      "icon-padding": ["interpolate", ["linear"], ["zoom"], 14, 40, 15, 32, 16, 22, 17, 10],
      "text-field": ["step", ["zoom"], "", PLACE_LABEL_ZOOM, ["get", "name"]],
      "text-optional": true,
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11, 17, 12.5],
      "text-max-width": 9,
      "text-variable-anchor": ["left", "right"],
      "text-radial-offset": 0.95,
      "text-justify": "auto",
      "text-padding": ["interpolate", ["linear"], ["zoom"], 14, 24, 15, 18, 16, 8, 17, 4],
    },
    paint: {
      "text-color": LABEL_TEXT_COLOR,
      "text-halo-color": LABEL_HALO_COLOR,
      "text-halo-width": 1.6,
    },
  }];
}

// "confirmed by" in the order a reader trusts them: the official register first.
const SOURCE_LABELS: ReadonlyArray<[string, string]> = [
  ["fhrs", "register"], ["overture", "Overture"], ["osm", "OpenStreetMap"], ["fsq", "Foursquare"],
];

/** "register, Overture, OpenStreetMap" from the tile's comma-joined sources; null when none is known. */
export function confirmedBy(sources: unknown): string | null {
  if (typeof sources !== "string") return null;
  const present = sources.split(",").map((source) => source.trim());
  const labels = SOURCE_LABELS.filter(([id]) => present.includes(id)).map(([, label]) => label);
  return labels.length ? labels.join(", ") : null;
}

/** A tapped place for the sheet's card: "Pizza East", "Restaurant · Hygiene 5/5", and its sources (shown behind "?"). */
export interface PlaceCardData {
  name: string;
  detail: string;
  sources: string | null;
  /** A page of its own (a school: /school/{urn}). */
  href?: string;
  linkLabel?: string;
  /** What its ♡ saves (Saved › Places or Schools); absent when it has no stable id. */
  save?: SavedItemInput;
}

/** A tapped place's card; `at` [lon, lat] is where it was tapped, for its ♡ on the map. */
export function placeCard(properties: Record<string, unknown> | undefined, at?: [number, number]): PlaceCardData | null {
  if (!properties) return null;
  const category = categoryLabel(properties.category);
  const name = typeof properties.name === "string" && properties.name ? properties.name : capitalise(category);
  const brand = typeof properties.brand === "string" && properties.brand && properties.brand !== name ? properties.brand : null;
  const detail = [capitalise(category), brand, shortHygieneLabel(properties.hygiene_rating)].filter(Boolean).join(" · ");
  const id = typeof properties.id === "string" || typeof properties.id === "number" ? String(properties.id) : null;
  const save: SavedItemInput | undefined = id ? { kind: "place", id, name, meta: capitalise(category) || undefined, ...(at ? { at } : {}) } : undefined;
  return { name, detail, sources: confirmedBy(properties.sources), ...(save ? { save } : {}) };
}

function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** "Hygiene 5/5", or the register's status in words. */
export function shortHygieneLabel(rating: unknown): string | null {
  const long = hygieneLabel(rating);
  return long ? long.replace(/^Food hygiene rating /, "Hygiene ").replace(/^Food hygiene: /, "Hygiene: ") : null;
}

/** "coffee_shop" → "coffee shop". */
export function categoryLabel(category: unknown): string {
  return typeof category === "string" && category ? category.replace(/_/g, " ") : "place";
}

/** FSA ratings are 0-5 or a status such as AwaitingInspection / Exempt. */
export function hygieneLabel(rating: unknown): string | null {
  if (typeof rating !== "string" && typeof rating !== "number") return null;
  const value = String(rating).trim();
  if (!value) return null;
  if (/^[0-5]$/.test(value)) return `Food hygiene rating ${value}/5`;
  return `Food hygiene: ${value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`;
}

/** Tooltip lines for a hovered place: its name, then category (and brand) and hygiene rating. Sources live behind "?" in the card. */
export function placeTooltipLines(properties: Record<string, unknown> | undefined): string[] {
  const card = placeCard(properties);
  return card ? [card.name, card.detail] : [];
}
