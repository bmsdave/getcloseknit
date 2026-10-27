/** Where the area map's camera goes on its own: fits to a chosen area, a found home, the selected wider area. */
import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";

import { carrierOfId, type AreaResponse, type GeographyId } from "@/lib/contracts";
import { areaTileTarget, ensureAreaTileSource } from "@/lib/area-tiles";
import { coverageCamera, fetchMapCoverage, type Bbox } from "@/lib/map-coverage";
import { paddingOffset, panBounds, visiblePadding, type Padding } from "@/lib/map-padding";
import { widerAreaHaloPaint, widerAreaOutlinePaint } from "@/lib/map-selection-paint";
import { areaEvidencePath, type DataMode } from "@/lib/map-state";
import { politeFetch } from "@/lib/polite-fetch";
import { isPhone } from "@/lib/viewport";

import type { MapController } from "./controller";
import { areaBounds, areaTilesOf } from "./data";

export const WIDER_AREA_LAYERS = { halo: "wider-area-halo", outline: "wider-area-outline" } as const;

/** A motion's length, or 0 when the reader asks for reduced motion. */
export function motionDuration(milliseconds: number): number {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : milliseconds;
  } catch {
    return milliseconds;
  }
}

/** Padding that keeps a target clear of the top bar and the dock (side panel or bottom sheet). */
export function blockPadding(map: MapLibreMap): Padding {
  return visiblePadding(map.getContainer());
}

/**
 * The selected district or borough's outline (the selection's white line over its halo), drawn from its kind's area
 * tiles at every zoom; null clears it.
 */
export function showWiderArea(controller: MapController, id: GeographyId | null) {
  const { map } = controller;
  for (const layer of Object.values(WIDER_AREA_LAYERS)) if (map.getLayer(layer)) map.removeLayer(layer);
  const tiles = areaTilesOf(controller);
  if (!id || !tiles) return;
  const target = areaTileTarget(id);
  const source = ensureAreaTileSource(map, tiles, carrierOfId(id));
  const filter: FilterSpecification = ["==", ["id"], target.id];
  const layer = { type: "line", source, "source-layer": target.sourceLayer, filter } as const;
  map.addLayer({ ...layer, id: WIDER_AREA_LAYERS.halo, paint: widerAreaHaloPaint() });
  map.addLayer({ ...layer, id: WIDER_AREA_LAYERS.outline, paint: widerAreaOutlinePaint() });
}

/** Fits the wider area into view once per selection: cleared and shown again (a layer switch back), it never refits. */
export function fitWiderArea(controller: MapController, id: GeographyId, box: Bbox) {
  if (controller.fittedWiderArea === id) return;
  controller.fittedWiderArea = id;
  const { map } = controller;
  map.fitBounds(box, { padding: blockPadding(map), maxZoom: 15, duration: motionDuration(700) });
}

function fitArea(controller: MapController, id: GeographyId): boolean {
  const box = areaBounds(controller.paintedBoxes, id);
  if (!box) return false;
  const { map } = controller;
  map.fitBounds(box, { padding: blockPadding(map), maxZoom: 15, duration: motionDuration(700) });
  return true;
}

export function fitPendingArea(controller: MapController) {
  const id = controller.pendingFit;
  if (!id || !areaBounds(controller.paintedBoxes, id)) return;
  // An ease still in flight ends here, its camera unreported; the fit's own end (inside fitBounds
  // when there is no motion) is reported, so the request is spent before it starts.
  controller.map.stop();
  controller.pendingFit = null;
  fitArea(controller, id);
}

/**
 * Fits an area the map has not loaded (England: a link naming an area without a position opens on London):
 * its box from its own evidence (bbox), under the coverage's bounds (a London start is held to London until
 * the coverage answers). The fit's end reports the camera, so the address gains the area's position.
 */
export function fitDistantArea(controller: MapController, id: GeographyId,
  props: { mode: DataMode; release: string; metric: { id: string }; period: string }) {
  if (props.mode !== "real" || controller.distantFit === id) return;
  controller.distantFit = id;
  const { map } = controller;
  const path = areaEvidencePath({ selected: id, metric: props.metric.id, period: props.period, mode: props.mode, release: props.release });
  void Promise.all([
    politeFetch(path).then((response) => (response.ok ? response.json() as Promise<AreaResponse> : null)),
    fetchMapCoverage(props.mode, props.release),
  ]).then(([body, coverage]) => {
    if (controller.distantFit !== id) return;
    controller.distantFit = null;
    const box = body?.bbox;
    if (!box) return;
    const camera = coverageCamera(coverage);
    map.setMinZoom(camera.minZoom);
    map.setMaxBounds(panBounds(camera.bounds, map.getContainer().clientWidth, isPhone()));
    map.stop();
    map.fitBounds(box, { padding: blockPadding(map), maxZoom: 15, duration: motionDuration(700) });
  }).catch(() => { if (controller.distantFit === id) controller.distantFit = null; });
}

export function focusMap(controller: MapController | null, focus: [number, number] | null) {
  if (!controller || !focus) return;
  const { map } = controller;
  // Desktop tilts towards the houses; phones and the Places overlay stay as they are (flat by default).
  const pitch = !isPhone() && !controller.placesOn ? 45 : map.getPitch();
  map.easeTo({ center: focus, zoom: 14.5, pitch, offset: paddingOffset(blockPadding(map)), duration: motionDuration(700) });
}

export function setMapPitch(map: MapLibreMap | null, pitch: number) {
  if (map?.getSource("area-buildings") && Math.round(map.getPitch()) !== pitch) {
    map.easeTo({ pitch, duration: motionDuration(350) });
  }
}
