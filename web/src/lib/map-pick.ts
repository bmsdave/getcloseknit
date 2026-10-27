/**
 * One hit-test for the map (Map controls PR 2–4): what a tap or a hover lands on, by one priority ladder
 * over every interactive layer, so only the top object handles it and an area never takes a tap meant
 * for a school cap over it. Hover is a peek (a popup or a tooltip that takes no pointer); a click or tap
 * opens the object's card in the sheet (components/map-cards.tsx) or selects the area.
 *
 * The ladder, top first: the DOM markers over the canvas (your places, saved ♡, ranking pins) · sale pins ·
 * homes · school caps (and their "+N" folds) · local places · street trees · road collisions · stations,
 * lines (cycle lanes, green streets), sale cells and street blocks (peek only) · the area. The my-location
 * dot is on no rung: it never takes a tap.
 * Touch widens every point target to a 44 px box (WCAG 2.5.5); a mouse keeps the drawn size, with the
 * few pixels of slack each layer always had. Within a box the nearest object to the pointer wins.
 * The cursor follows the hover (opensOnClick): a pointer over what a click opens, the default over a peek,
 * a crosshair while a place is being put down (components/map-controller/interactions.ts peek).
 */
import { AREA_FILL_LAYERS, featureAreaId } from "./area-tiles";
import type { CollisionPopup } from "./map-collisions";
import { COLLISION_HIT_LAYER } from "./map-collisions";
import { CYCLE_LAYERS } from "./map-cycle-lanes";
import type { PlaceCardData } from "./map-place-layers";
import { PLACE_LAYER } from "./map-place-layers";
import { BLOCK_FILL_LAYER, DWELLING_LAYER, PARCEL_FILL_LAYER } from "./map-property-layers";
import { SALE_CELL_LAYER, SALE_PIN_LAYER, SALE_TAP_PX } from "./map-sale-layers";
import type { SchoolMapCardData } from "./map-school-layer";
import { SCHOOL_FOLD_LAYER, SCHOOL_LAYER } from "./map-school-layer";
import { GREEN_STREET_LAYER, TREE_POINT_LAYER } from "./map-street-trees";
import { TRANSIT_STATION_LAYER } from "./map-transit";
import { coarsePointer } from "./viewport";

export type PickKind =
  | "my-place" | "saved" | "rank" | "sale" | "dwelling" | "school" | "fold" | "place" | "tree" | "collision"
  | "station" | "line" | "cell" | "block" | "area";
export type PickIntent = "click" | "hover";

export interface PickPoint { x: number; y: number }
export type PickBox = [[number, number], [number, number]];

/** A rendered feature as the ladder sees it. */
export interface PickFeature {
  layer: string;
  id?: string | number;
  /** `peekOnly: true` makes this one feature a peek (a saved school's ♡): a click falls through it. */
  properties: Record<string, unknown>;
  /** A point object's place on the screen; lines and polygons have none. */
  at?: PickPoint | null;
  lngLat?: [number, number] | null;
}

/** What the ladder asks of the map: the features of some layers inside a box (hidden layers give none). */
export interface PickScene {
  query(layers: readonly string[], box: PickBox): PickFeature[];
}

export interface Pick {
  kind: PickKind;
  feature: PickFeature;
  /** Everything of the kind inside the box, nearest first (a stack of collision dots). */
  features: PickFeature[];
}

/** A finger's target: a 44 × 44 px box around it. */
export const TAP_BOX_PX = 44;

interface Rung {
  kind: Exclude<PickKind, "fold">;
  layers: readonly string[];
  /** Half the box's side, in px, for a mouse and for a finger. */
  slop: { fine: number; coarse: number };
  /** Hover only: a click falls through to the rungs below. */
  peekOnly?: boolean;
}

const HALF_TAP = TAP_BOX_PX / 2;

/** The DOM markers drawn over the canvas, each kind a pseudo-layer of the scene (registerPickMarker). */
export type MarkerKind = "my-place" | "saved" | "rank";
export const MARKER_LAYER: Record<MarkerKind, string> = { "my-place": "marker:my-place", saved: "marker:saved", rank: "marker:rank" };

/** Top first. The slacks are the ones each layer had: a cap's 63 px image is its own target, a badge 10 px, a dot 4. */
export const PICK_LADDER: readonly Rung[] = [
  { kind: "my-place", layers: [MARKER_LAYER["my-place"]], slop: { fine: 0, coarse: HALF_TAP } },
  { kind: "saved", layers: [MARKER_LAYER.saved], slop: { fine: 0, coarse: HALF_TAP } },
  // A ranking pin is a button with its own click (it selects its area): the ladder only peeks at it.
  { kind: "rank", layers: [MARKER_LAYER.rank], slop: { fine: 0, coarse: HALF_TAP }, peekOnly: true },
  { kind: "sale", layers: [SALE_PIN_LAYER], slop: { fine: SALE_TAP_PX / 2, coarse: SALE_TAP_PX / 2 } },
  { kind: "dwelling", layers: [PARCEL_FILL_LAYER, DWELLING_LAYER], slop: { fine: 0, coarse: 0 } },
  { kind: "school", layers: [SCHOOL_LAYER, SCHOOL_FOLD_LAYER], slop: { fine: 0, coarse: HALF_TAP } },
  { kind: "place", layers: [PLACE_LAYER], slop: { fine: 10, coarse: HALF_TAP } },
  { kind: "tree", layers: [TREE_POINT_LAYER], slop: { fine: 4, coarse: HALF_TAP } },
  { kind: "collision", layers: [COLLISION_HIT_LAYER], slop: { fine: 4, coarse: HALF_TAP } },
  { kind: "station", layers: [TRANSIT_STATION_LAYER], slop: { fine: 0, coarse: HALF_TAP }, peekOnly: true },
  // Lines peek: a cycle lane's type, a road's trees per 100 m. A click goes to the area under them.
  { kind: "line", layers: [...CYCLE_LAYERS, GREEN_STREET_LAYER], slop: { fine: 3, coarse: HALF_TAP }, peekOnly: true },
  { kind: "cell", layers: [SALE_CELL_LAYER], slop: { fine: 0, coarse: 0 }, peekOnly: true },
  { kind: "block", layers: [BLOCK_FILL_LAYER], slop: { fine: 0, coarse: 0 }, peekOnly: true },
  { kind: "area", layers: AREA_FILL_LAYERS, slop: { fine: 0, coarse: 0 } },
];

export function tapBox(point: PickPoint, half: number): PickBox {
  return [[point.x - half, point.y - half], [point.x + half, point.y + half]];
}

/** A rung's kind for one of its features: a fold is a school cluster. */
function kindOf(rung: Rung, feature: PickFeature): PickKind {
  if (rung.kind === "school" && (feature.properties.cluster === true || feature.layer === SCHOOL_FOLD_LAYER)) return "fold";
  return rung.kind;
}

/** Nearest to the pointer first; features without a screen point keep the map's order, after the points. */
function nearestFirst(features: PickFeature[], point: PickPoint, layers: readonly string[]): PickFeature[] {
  const distance = (feature: PickFeature) => (feature.at ? Math.hypot(feature.at.x - point.x, feature.at.y - point.y) : Infinity);
  return features
    .map((feature, index) => ({ feature, index, distance: distance(feature), layer: layers.indexOf(feature.layer) }))
    .sort((a, b) => a.layer - b.layer || a.distance - b.distance || a.index - b.index)
    .map((entry) => entry.feature);
}

/**
 * The top object under the pointer, or null over nothing. `coarse` is a finger (44 px boxes).
 * A click skips the peek-only rungs (a station, a line, a street block) and peek-only features: the tap
 * falls to what is under them.
 */
export function pickAt(point: PickPoint, scene: PickScene, options: { intent: PickIntent; coarse: boolean }): Pick | null {
  const click = options.intent === "click";
  for (const rung of PICK_LADDER) {
    if (rung.peekOnly && click) continue;
    const found = scene.query(rung.layers, tapBox(point, options.coarse ? rung.slop.coarse : rung.slop.fine))
      .filter((feature) => !(click && feature.properties.peekOnly === true));
    if (!found.length) continue;
    const features = nearestFirst(found, point, rung.layers);
    return { kind: kindOf(rung, features[0]), feature: features[0], features };
  }
  return null;
}

const peekRung = (kind: PickKind) => PICK_LADDER.find((rung) => rung.kind === (kind === "fold" ? "school" : kind))?.peekOnly === true;

/** True when a click on the hovered pick opens or selects it (a pointer cursor); false over a peek or nothing. */
export function opensOnClick(pick: Pick | null): boolean {
  return pick !== null && pick.feature.properties.peekOnly !== true && !peekRung(pick.kind);
}

// ---- DOM markers ---------------------------------------------------------------------------------------

interface Boxed { getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } }

/** What a marker tells the ladder: its element (the hit box), where it stands, and its peek's `lines`. */
export interface PickMarker {
  kind: MarkerKind;
  /** Its box takes in its children's: a pin's teardrop rises above the label beside it. */
  element: Boxed & { readonly isConnected: boolean; dataset: DOMStringMap; children: ArrayLike<Boxed> };
  lngLat: [number, number];
  properties: Record<string, unknown> & { lines: string[] };
}

const pickMarkers = new WeakMap<object, Set<PickMarker>>();

/**
 * Puts an HTML marker on the map's ladder (no handler of its own): the scene answers its kind's
 * pseudo-layer from the marker's box on screen. data-pick ("open" or "peek") gives it the cursor
 * (map-knit.css). A marker whose element has left the page drops out by itself.
 */
export function registerPickMarker(map: object, marker: PickMarker): void {
  const set = pickMarkers.get(map) ?? new Set<PickMarker>();
  pickMarkers.set(map, set);
  set.add(marker);
  marker.element.dataset.pick = marker.properties.peekOnly === true || peekRung(marker.kind) ? "peek" : "open";
}

function markerFeatures(map: PickMap, layers: readonly string[], [[x0, y0], [x1, y1]]: PickBox): PickFeature[] {
  const set = pickMarkers.get(map);
  if (!set?.size) return [];
  const frame = map.getContainer().getBoundingClientRect();
  const found: PickFeature[] = [];
  for (const marker of set) {
    if (!marker.element.isConnected) { set.delete(marker); continue; }
    const layer = MARKER_LAYER[marker.kind];
    if (!layers.includes(layer)) continue;
    const rects = [marker.element, ...Array.from(marker.element.children)].map((part) => part.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) continue;
    const left = Math.min(...rects.map((rect) => rect.left)) - frame.left;
    const top = Math.min(...rects.map((rect) => rect.top)) - frame.top;
    const right = Math.max(...rects.map((rect) => rect.right)) - frame.left;
    const bottom = Math.max(...rects.map((rect) => rect.bottom)) - frame.top;
    if (right < x0 || left > x1 || bottom < y0 || top > y1) continue;
    found.push({ layer, properties: marker.properties, at: { x: (left + right) / 2, y: (top + bottom) / 2 }, lngLat: marker.lngLat });
  }
  return found;
}

// ---- MapLibre ------------------------------------------------------------------------------------------

/** The part of a MapLibre map the ladder reads. */
export interface PickMap {
  getLayer(id: string): unknown;
  getLayoutProperty(layer: string, name: string): unknown;
  queryRenderedFeatures(box: PickBox, options: { layers: string[] }): {
    layer: { id: string }; id?: string | number; properties: Record<string, unknown> | null;
    geometry: { type: string; coordinates?: unknown };
  }[];
  project(lngLat: [number, number]): PickPoint;
  getContainer(): { getBoundingClientRect(): { left: number; top: number } };
}

export function pickScene(map: PickMap): PickScene {
  return {
    query(layers, box) {
      if (layers.some((id) => id.startsWith("marker:"))) return markerFeatures(map, layers, box);
      const shown = layers.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none");
      if (!shown.length) return [];
      return map.queryRenderedFeatures(box, { layers: shown }).map((feature) => {
        const lngLat = feature.geometry.type === "Point" ? feature.geometry.coordinates as [number, number] : null;
        return { layer: feature.layer.id, id: featureAreaId(feature), properties: feature.properties ?? {}, at: lngLat ? map.project(lngLat) : null, lngLat };
      });
    },
  };
}

/** The ladder over a live map: a finger (no hover) gets the 44 px boxes. */
export function pickOnMap(map: PickMap, point: PickPoint, intent: PickIntent): Pick | null {
  return pickAt(point, pickScene(map), { intent, coarse: coarsePointer() });
}

// ---- Cards ---------------------------------------------------------------------------------------------

/** What a tap opens in the sheet: one card per kind (components/map-cards.tsx). */
export type MapCard =
  | { kind: "place"; place: PlaceCardData }
  | { kind: "school"; school: SchoolMapCardData }
  | { kind: "collision"; content: CollisionPopup; zoomIn: (() => void) | null }
  | { kind: "tree"; lines: string[] }
  | { kind: "my-place"; placeId: string; name: string };

/** The card's name for the sheet's peek line on a phone. */
export function mapCardTitle(card: MapCard): string {
  switch (card.kind) {
    case "place": return card.place.name;
    case "school": return card.school.view.name;
    case "collision": return card.content.kind === "one" ? "Road collision" : `${card.content.count} people hurt here`;
    case "tree": return card.lines[0] ?? "Tree";
    case "my-place": return card.name;
  }
}
