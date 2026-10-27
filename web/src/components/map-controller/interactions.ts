/**
 * One tap, one hover (Map controls PR 2–3; lib/map-pick.ts): the area map's click and hover, the tooltip, the
 * school popup and the Esc ladder's map rungs.
 */
import type { GeoJSONSource, Map as MapLibreMap, Point } from "maplibre-gl";

import type { GeographyId } from "@/lib/contracts";
import { COLLISION_LIST_ZOOM, collisionPeekLines, collisionPopup } from "@/lib/map-collisions";
import { cycleLanePeekLines } from "@/lib/map-cycle-lanes";
import { opensOnClick, pickOnMap, type Pick, type PickFeature } from "@/lib/map-pick";
import { placeCard, placeTooltipLines } from "@/lib/map-place-layers";
import { dwellingFromFeature, hoverTarget, PROPERTY_SOURCE_ID, tooltipLines, type HoverTarget } from "@/lib/map-property-layers";
import { salePinSelection, saleTooltipLines } from "@/lib/map-sale-layers";
import { SCHOOL_SOURCE_ID, schoolMapCard, schoolPointFromProperties } from "@/lib/map-school-layer";
import { GREEN_STREET_LAYER, greenStreetPopupLines, treePopupLines } from "@/lib/map-street-trees";
import { stationPeekLines } from "@/lib/map-transit";
import { coarsePointer } from "@/lib/viewport";
import type { SchoolPopupOpen } from "../school/school-map-popup";

import { motionDuration } from "./camera";
import { controllerOf, type MapController } from "./controller";

/** The one school popup: a hover's peek or a keyboard stop's; null puts it away. */
export function showSchoolPopup(controller: MapController, open: SchoolPopupOpen | null) {
  const popups = controller.schoolPopup;
  if (!popups) return;
  popups.open = open;
  popups.show(open);
}

/** A tap on a fold (its cap or its "+N") zooms in until it opens. */
function zoomIntoFold(map: MapLibreMap, feature: PickFeature) {
  const source = map.getSource(SCHOOL_SOURCE_ID) as GeoJSONSource | undefined;
  const id = Number(feature.properties.cluster_id);
  const center = feature.lngLat;
  if (!source || !Number.isFinite(id) || !center) return;
  void source.getClusterExpansionZoom(id)
    .then((zoom) => map.easeTo({ center, zoom: Math.max(zoom, map.getZoom() + 1), duration: motionDuration(400) }))
    .catch(() => undefined);
}

/**
 * Every click and hover on the map goes through one hit-test (pickOnMap): the top object under the
 * pointer takes it, so a school cap over an area never selects the area under it. A hover (a mouse) is a
 * peek: the school's popup, or the map tooltip for the rest; a touch screen has no peek. A click or tap
 * opens the object's card in the sheet, zooms into a "+N" fold, or selects the area and closes any card;
 * the camera never moves on a select. Your places and saved ♡ are on the ladder (registerPickMarker); other
 * markers (My match's numbered pins, labels) and a zone being drawn or a place being put down (data-picking)
 * keep their own taps.
 */
export function registerPick(controller: MapController) {
  const { map } = controller;
  map.on("click", (event) => {
    if (map.getContainer().dataset.picking === "true") return;
    const target = event.originalEvent.target as Element | null;
    if (target?.closest?.(".maplibregl-marker") && !target.closest("[data-pick]")) return;
    const pick = pickOnMap(map, event.point, "click");
    const callbacks = controller.callbacks;
    const onPick = controller.onPick;
    const properties = pick?.feature.properties ?? {};
    const at = pick?.feature.lngLat ?? [event.lngLat.lng, event.lngLat.lat] as [number, number];
    switch (pick?.kind) {
      case "my-place":
        showTooltip(map, [], null);
        if (typeof properties.placeId === "string") onPick?.({ kind: "my-place", placeId: properties.placeId, name: String(properties.name ?? "") });
        return;
      case "saved": {
        // A saved home opens the home's card (as a tapped house does); a saved area selects the area.
        showTooltip(map, [], null);
        onPick?.(null);
        if (typeof properties.uprn === "string") callbacks.onSelectDwelling({ uprn: properties.uprn, addressId: null });
        else if (typeof properties.geographyId === "string") callbacks.onSelect(properties.geographyId as GeographyId);
        return;
      }
      case "sale": {
        const sale = salePinSelection(properties);
        if (sale) callbacks.onSelectSale(sale);
        return;
      }
      case "dwelling": {
        const dwelling = dwellingFromFeature(properties);
        if (!dwelling) return;
        // The chosen home's ring takes over from the hover: a tap's tooltip would otherwise stay over it.
        setHover(controller, null);
        showTooltip(map, [], null);
        callbacks.onSelectDwelling(dwelling);
        return;
      }
      case "fold":
        showSchoolPopup(controller, null);
        zoomIntoFold(map, pick.feature);
        return;
      case "school": {
        const point = schoolPointFromProperties(properties, at);
        if (!point) return;
        showSchoolPopup(controller, null);
        onPick?.({ kind: "school", school: schoolMapCard(point, controller.homePin) });
        return;
      }
      case "place": {
        const place = placeCard(properties, at);
        if (!place) return;
        // Without a sheet to open the card in, the tooltip shows the place as a hover does.
        showTooltip(map, onPick ? [] : placeTooltipLines(properties), event.point);
        onPick?.({ kind: "place", place });
        return;
      }
      case "tree":
        onPick?.({ kind: "tree", lines: treePopupLines(properties) });
        return;
      case "collision": {
        const content = collisionPopup(pick.features.map((feature) => feature.properties), map.getZoom());
        if (!content) return;
        const zoomIn = () => map.easeTo({ center: at, zoom: Math.min(map.getZoom() + 2, COLLISION_LIST_ZOOM), duration: motionDuration(400) });
        onPick?.({ kind: "collision", content, zoomIn: content.kind === "many" && content.zoomIn ? zoomIn : null });
        return;
      }
      case "area": {
        onPick?.(null);
        const id = pick.feature.id;
        // The map stays where the finger left it, and so does the phone sheet (close-knit.tsx).
        if (typeof id === "string") callbacks.onSelect(id as GeographyId);
        return;
      }
      default:
        onPick?.(null);
    }
  });
  map.on("mousemove", (event) => {
    if (coarsePointer()) return;
    peek(controller, pickOnMap(map, event.point, "hover"), event.point);
  });
  map.on("mouseout", () => peek(controller, null, null));
}

/**
 * The hover's peek: the school's popup over a cap, the tooltip for the rest. The cursor says what a click
 * does: a pointer over what it opens, the default over a peek (a station, a line), a crosshair in a mode.
 */
function peek(controller: MapController, pick: Pick | null, point: Point | null) {
  const { map } = controller;
  if (map.getContainer().dataset.picking === "true") {
    // Putting a place down or drawing a zone: the next tap is the mode's, so nothing peeks.
    map.getCanvas().style.cursor = "crosshair";
    pick = null;
  } else {
    map.getCanvas().style.cursor = opensOnClick(pick) ? "pointer" : "";
  }
  const open = controller.schoolPopup?.open;
  const school = pick?.kind === "school" && pick.feature.lngLat ? schoolPointFromProperties(pick.feature.properties, pick.feature.lngLat) : null;
  if (school) {
    if (open?.point.urn !== school.urn) showSchoolPopup(controller, { point: school });
  } else if (open && !open.focused) showSchoolPopup(controller, null);
  const hover = pick && (pick.kind === "dwelling" || pick.kind === "block") ? hoverTarget(pick.feature.layer, pick.feature.id) : null;
  setHover(controller, hover);
  showTooltip(map, pick && point ? peekLines(controller, pick) : [], point);
}

/** The tooltip's lines for what the pointer is over. */
export function peekLines(controller: MapController, pick: Pick): string[] {
  const { map } = controller;
  const { layer, properties, id } = pick.feature;
  switch (pick.kind) {
    case "sale":
    case "cell": {
      const view = controller.saleView;
      return view?.on ? saleTooltipLines(layer, properties, view) : [];
    }
    case "dwelling":
    case "block":
      return tooltipLines(layer, properties, unitSuffix(controller.hoverUnit));
    case "place": return placeTooltipLines(properties);
    case "my-place":
    case "saved":
    case "rank":
      return Array.isArray(properties.lines) ? properties.lines.map(String) : [];
    case "tree": return treePopupLines(properties);
    case "line": return layer === GREEN_STREET_LAYER ? greenStreetPopupLines(properties) : cycleLanePeekLines(properties);
    case "collision": return collisionPeekLines(collisionPopup(pick.features.map((feature) => feature.properties), map.getZoom()));
    case "station": return stationPeekLines(properties);
    case "area": {
      // A custom criterion's exact counts for the area under the pointer (its MSOA's, zoomed out); nothing on other layers.
      if (id === undefined) return [];
      const rolled = controller.rolledTooltip?.(String(id)) ?? [];
      return rolled.length ? rolled : controller.areaTooltip?.(String(id)) ?? [];
    }
    default: return [];
  }
}

/**
 * The Esc ladder's map rungs (lib/esc-ladder.ts, Map controls PR 1): a peek is the tooltip or the school
 * popup (a hover's, or a keyboard stop's). Cards live in the sheet (close-knit.tsx), so the map has none.
 */
export function mapEscapeRungs(map: MapLibreMap): { peek: boolean; card: boolean } {
  const tooltip = map.getContainer().parentElement?.querySelector<HTMLElement>(".map-tooltip");
  return { peek: (tooltip ? !tooltip.hidden : false) || (controllerOf(map)?.schoolPopup?.open ?? null) !== null, card: false };
}

/** Closes the map's rung of the ladder: every peek (the sheet closes its own card). */
export function closeMapRung(map: MapLibreMap, rung: "peek" | "card") {
  if (rung !== "peek") return;
  const controller = controllerOf(map);
  if (controller) setHover(controller, null);
  showTooltip(map, [], null);
  if (controller) showSchoolPopup(controller, null);
}

// Hover: one feature-state flag on the hovered parcel/dwelling/block plus a
// tooltip with its numbers, positioned by the pointer inside the map stage.
export function setHover(controller: MapController, target: HoverTarget | null) {
  const { map } = controller;
  const previous = controller.hovered;
  if (previous && (previous.id !== target?.id || previous.sourceLayer !== target?.sourceLayer)) {
    map.setFeatureState({ source: PROPERTY_SOURCE_ID, sourceLayer: previous.sourceLayer, id: previous.id }, { hover: false });
    controller.hovered = null;
  }
  if (target && !controller.hovered) {
    map.setFeatureState({ source: PROPERTY_SOURCE_ID, sourceLayer: target.sourceLayer, id: target.id }, { hover: true });
    controller.hovered = target;
  }
}

export function showTooltip(map: MapLibreMap, lines: string[], point: { x: number; y: number } | null) {
  const tooltip = map.getContainer().parentElement?.querySelector<HTMLElement>(".map-tooltip");
  if (!tooltip) return;
  if (!lines.length || !point) { tooltip.hidden = true; return; }
  tooltip.replaceChildren(...lines.map((line, index) => {
    const element = document.createElement(index === 0 ? "strong" : "span");
    element.textContent = line;
    return element;
  }));
  tooltip.style.left = `${point.x + 14}px`;
  tooltip.style.top = `${point.y + 14}px`;
  tooltip.hidden = false;
}

function unitSuffix(unit: string | undefined): string {
  return unit === "£/m²" ? "/m²" : unit === "£/sqft" ? "/sqft" : "";
}
