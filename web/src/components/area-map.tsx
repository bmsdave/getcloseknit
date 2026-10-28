"use client";

import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The map's own sheets load with the map (close-knit.tsx loads this file on demand), MapLibre's first
// so the knitted markers override it; text pages never download either.
import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/map-knit.css";

import { carrierOfId, type GeographyId } from "@/lib/contracts";
import { crimeCategories } from "@/lib/crime-filter";
import { useScope } from "@/components/scope-context";
import { createLayerLoadTimer, recordLayerLoad } from "@/lib/layer-load-timing";
import { previewBuildings } from "@/lib/fixtures";
import { DEFAULT_MAP_STATE, LONDON_BOUNDS, MAX_MAP_ZOOM, MIN_MAP_ZOOM, initialPitch } from "@/lib/map-state";
import { applyCanopy, applyGreenStreets, applyStreetTrees, restyleStreetTrees } from "./street-trees-map";
// The address the page was opened with: the explorer rewrites it on load, before this module (loaded
// on demand) or a remounted map reads it, so it is read with the explorer's own module.
import { BOOT_SEARCH, chosenPitch } from "./use-explorer-controller";
import { hideMapToast, showMapToast } from "@/lib/map-toast";
import { BASE_STYLE, MAP_TILE_CACHE_ZOOM_LEVELS, MAPLIBRE_WORKER_URL } from "@/lib/map-core";
import { applyBasemapTheme, BUILDING_EXTRUSION_OPACITY } from "@/lib/map-basemap-theme";
import { ensureBasemapExtras } from "@/lib/map-basemap-extras";
import { ensureLandmarks, PARK_LABEL_SOURCE, parkLabelSource, veilAnchor } from "@/lib/map-landmarks";
import { applyTransitTheme, applyTransitVisibility, ensureTransit, TRANSIT_SOURCE, transitSource } from "@/lib/map-transit";
import { DEFAULT_SCHOOL_FILTER } from "@/lib/map-school-layer";
import { showsUniversities } from "@/lib/map-university-layer";
import { SchoolMapKeys, SchoolMapPopup, type SchoolPopupOpen } from "./school/school-map-popup";
import { onUiThemeChange, resolvedUiTheme } from "@/lib/ui-themes";
import { KnitLogo } from "./knit";
import { panBounds, visiblePadding } from "@/lib/map-padding";
import { isPhone } from "@/lib/viewport";
import { applyAreaEdgeTheme } from "@/lib/area-edges";
import { areaBox } from "@/lib/area-boxes";
import { featureAreaId, registerAreaTileProtocol } from "@/lib/area-tiles";
import { subscribeLegendScale } from "@/lib/legend-range";
import {
  coverageCamera, fetchMapCoverage, LONDON_COVERAGE, NEIGHBOURHOOD_ZOOM, piecesKey, setViewScope, shapePieces, WIDE_ZOOM, type MapCoverage,
} from "@/lib/map-coverage";
import { valuePackCache } from "@/lib/timeline-playback";
import { setMapRelease } from "@/lib/release-url";
import { createCoalescingScheduler, createUpdateScope } from "@/lib/map-update-scheduler";
import { isLondonStart } from "@/lib/map-preload";
import { trackMapView } from "@/lib/usage";

import { focusMap, setMapPitch, fitPendingArea, fitWiderArea, showWiderArea } from "./map-controller/camera";
import { createMapController, disposeMapController, type MapController } from "./map-controller/controller";
import { coverageVersion, currentPieces, layerPackPath, mapBbox, onceLondonInView, prefetchStartPieces, waitsForMonth } from "./map-controller/data";
import { registerPick, showSchoolPopup } from "./map-controller/interactions";
import { applyCollisions, applyCycleLanes, applyPlaceView, applySaleView, applySchools, applyUniversities } from "./map-controller/overlays";
import {
  applyAreaFade, applyHomePaint, applyNoDataTheme, applyPlain, applySelectedParcel, areaFills, EMPTY_COLLECTION, fillBeforeLayer, firstSymbolLayer, primeAreaTiles,
  renderedAreas,
} from "./map-controller/paint";
import { LENS_SWAP_START, refreshAnalytics } from "./map-controller/refresh";
import { mapViewScope, repaintLast, rescaleOnMove } from "./map-controller/scale";
import type { AreaMapProps, RefreshOutcome } from "./map-controller/types";

export { closeMapRung, mapEscapeRungs } from "./map-controller/interactions";

const MAP_UNAVAILABLE = "Map unavailable on this device; area evidence below remains usable";
const GEOMETRY_UNAVAILABLE = "Real area geometry unavailable";
const COLOURS_UNAVAILABLE = "Map colours unavailable";
const COVERAGE_UNAVAILABLE = "Map areas unavailable";

const frameDriver = {
  request: (callback: () => void) => requestAnimationFrame(callback),
  cancel: (handle: number) => cancelAnimationFrame(handle),
};

export function AreaMap(props: AreaMapProps) {
  const container = useRef<HTMLDivElement>(null);
  // The map and everything this component remembers about it (map-controller/controller.ts).
  const controllerReference = useRef<MapController | null>(null);
  const callbacks = useRef({
    onCamera: props.onCamera, onPitch: props.onPitch, onSelect: props.onSelect,
    onSelectDwelling: props.onSelectDwelling, onSelectSale: props.onSelectSale, onMedian: props.onMedian, onPainted: props.onPainted,
  });
  const scheduler = useRef(createCoalescingScheduler(frameDriver)).current;
  const scope = useRef(createUpdateScope()).current;
  const [status, setStatus] = useState("Loading map");
  const [mapFailed, setMapFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  // The map's colours are on their way: from the first render until a refresh settles.
  const [painting, setPainting] = useState(true);
  // Map colours or area shapes that did not load (a 503): a toast says so with "Try again".
  const [retry, setRetry] = useState(0);
  const troubleToast = useRef<number | null>(null);
  // Show › Schools: the one school popup (a hover's peek, or a keyboard stop's), with the map it sits on.
  const [schoolPopup, setSchoolPopup] = useState<{ map: MapLibreMap; open: SchoolPopupOpen } | null>(null);
  // Only the crossing matters (the places chips' zoom hint): no re-render on every zoom.

  useEffect(() => {
    callbacks.current = {
      onCamera: props.onCamera, onPitch: props.onPitch, onSelect: props.onSelect,
      onSelectDwelling: props.onSelectDwelling, onSelectSale: props.onSelectSale, onMedian: props.onMedian, onPainted: props.onPainted,
    };
    if (controllerReference.current) controllerReference.current.callbacks = callbacks.current;
    // Before the overlay effects below: their sources' URLs carry the release (lib/release-url.ts).
    if (controllerReference.current) setMapRelease(controllerReference.current.map, props.release);
  });
  // The value pack starts with the map, not after the basemap's style and first tiles (it waited ~1 s
  // for them); once per mode and release: a later layer fetches as it opens. The boxes wait for the coverage
  // (prefetchStartPieces): it names the pieces.
  // A London start's first view is London's one piece (London whole: the London map's single request); a link
  // elsewhere in England waits for the coverage to know its pieces.
  useEffect(() => {
    // Below NEIGHBOURHOOD_ZOOM the England map loads regions, not London's piece: it waits for the coverage.
    if (!isLondonStart(props.initialCamera) || props.initialCamera.zoom < NEIGHBOURHOOD_ZOOM) return;
    const path = layerPackPath(props);
    if (path) valuePackCache.prefetch([path]);
  }, [props.mode, props.release]);
  // England (CLOSE_KNIT_ENGLAND): the map may go anywhere in England and loads the pieces in view (lib/map-coverage.ts).
  const [coverage, setCoverage] = useState<MapCoverage>(LONDON_COVERAGE);
  // Nothing paints before the coverage answers: a London-map paint first would show London on its own before its
  // neighbours, as if they were two maps. A coverage that did not load is said, never painted as London's: England
  // would stay grey. "Try again" asks again (lib/map-coverage.ts keeps no failure).
  const [coverageKnown, setCoverageKnown] = useState(false);
  const [coverageTries, setCoverageTries] = useState(0);
  useEffect(() => {
    let live = true;
    void fetchMapCoverage(props.mode, props.release).then((next) => {
      if (!live) return;
      prefetchStartPieces(next, props, container.current);
      setCoverage(next);
      setCoverageKnown(true);
    }, () => {
      if (!live) return;
      setPainting(false);
      setStatus(COVERAGE_UNAVAILABLE);
      // Kept as the map's trouble toast: the first paint after "Try again" clears it and says "Map ready".
      troubleToast.current = showMapToast("Map didn't load.", {
        kind: "coverage-failed", action: { label: "Try again", onClick: () => setCoverageTries((count) => count + 1) },
      });
    });
    return () => { live = false; };
  }, [props.mode, props.release, coverageTries]);
  // A linked layer's month arrives with the catalogue (lib/map-period.ts): its first view's packs start then,
  // alongside the basemap, not after it. Once: later months and layers fetch as they paint.
  const startPacked = useRef(false);
  useEffect(() => {
    if (startPacked.current || !coverageKnown || !props.period) return;
    startPacked.current = true;
    prefetchStartPieces(coverage, props, container.current);
  }, [coverageKnown, props.period]);
  // The map's name says what it covers (the served scope, FLAGS.md CLOSE_KNIT_ENGLAND).
  const place = useScope().name;
  useEffect(() => {
    controllerReference.current?.map.getCanvas().setAttribute("aria-label", canvasLabel(place));
  }, [mapReady, place]);
  // The pieces in view, as one key: a pan or zoom that needs other pieces repaints the map.
  const [viewKey, setViewKey] = useState("");
  const viewCarrier = props.metric.carrier;
  useEffect(() => {
    const controller = controllerReference.current;
    if (!mapReady || !controller || !coverageKnown) return;
    const { map } = controller;
    controller.coverage = coverage;
    const camera = coverageCamera(coverage);
    map.setMinZoom(camera.minZoom);
    map.setMaxBounds(panBounds(camera.bounds, map.getContainer().clientWidth, isPhone()));
    let shownKey = "";
    const update = () => {
      const scopeName = mapViewScope(controller, props.mode);
      setViewScope(scopeName);
      // The scale is part of the key: a pan from one region's view to one across regions repaints.
      const key = `${piecesKey(currentPieces(controller, { mode: props.mode, carrier: viewCarrier }))}|${scopeName ?? "England"}`;
      // The same pieces: no repaint is coming, so the rank scale follows the view here (lib/view-scale.ts).
      if (key === shownKey) rescaleOnMove(controller);
      shownKey = key;
      setViewKey(key);
    };
    update();
    map.on("moveend", update);
    // The reader's own scale (lib/legend-range.ts): a handle's drag recolours the last paint once per frame, no fetch.
    let frame = 0;
    const unsubscribe = subscribeLegendScale(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; repaintLast(controller); });
    });
    return () => {
      map.off("moveend", update);
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [mapReady, coverage, coverageKnown, props.mode, viewCarrier]);
  useEffect(() => createMap(container, controllerReference, props, {
    setStatus,
    onFailure,
    onReady: () => setMapReady(true),
  }), []);
  // Area tiles (lib/area-tiles.ts): the first view's start loading now, alongside its value pack.
  useEffect(() => {
    const controller = controllerReference.current;
    if (mapReady && controller && coverageKnown) primeAreaTiles(controller, props);
  }, [mapReady, coverageKnown]);
  // The basemap follows Day and Night (style load is handled in registerMapEvents).
  useEffect(() => {
    const controller = controllerReference.current;
    if (!mapReady || !controller) return;
    const { map } = controller;
    return onUiThemeChange(() => {
      applyBasemapTheme(map, resolvedUiTheme());
      applyTransitTheme(map, resolvedUiTheme());
      applyHomePaint(controller);
      applyAreaEdgeTheme(map, resolvedUiTheme());
      applyNoDataTheme(controller);
      restyleStreetTrees(map);
    });
  }, [mapReady]);
  const onMap = props.onMap;
  useEffect(() => {
    if (!mapReady || !onMap) return;
    onMap(controllerReference.current?.map ?? null);
    return () => onMap(null);
  }, [mapReady, onMap]);
  // A lens swap (another layer or comparison colours the map) is timed as performance measure
  // "ck:lens-swap": from the change to the new colours applied (refreshAnalytics).
  const lens = useRef(`${props.metric.id}|${!!props.matchPack}`);
  useEffect(() => {
    const next = `${props.metric.id}|${!!props.matchPack}`;
    if (next === lens.current) return;
    lens.current = next;
    performance.clearMarks(LENS_SWAP_START);
    performance.mark(LENS_SWAP_START);
  }, [props.metric.id, props.matchPack]);
  // Layer load time (lib/layer-load-timing.ts): from the open or switch until painted and the map idle.
  const layerTimer = useRef(createLayerLoadTimer(recordLayerLoad)).current;
  useEffect(() => { layerTimer.begin(props.metric.id); }, [props.metric.id, layerTimer]);
  useEffect(() => {
    const map = controllerReference.current?.map;
    const pending = !painting && mapReady && map ? layerTimer.painted() : null;
    if (!map || !pending) return;
    const settle = () => { layerTimer.settle(pending, map.getZoom()); };
    map.once("idle", settle);
    map.triggerRepaint();
    return () => { map.off("idle", settle); };
  }, [painting, mapReady, layerTimer]);
  useEffect(() => {
    // Waits for the first view key (the coverage effect above sets it as the map gets ready), and for the layer's
    // month when the explorer does not know it yet (lib/map-period.ts): never a pack for a month it then replaces.
    if (!mapReady || !viewKey) return;
    // Zoomed out, a ready-made criterion's MSOAs load alongside its LSOAs, not after them (refreshAnalytics).
    if (props.clientRollup && (controllerReference.current?.map.getZoom() ?? Infinity) < WIDE_ZOOM) void props.clientRollup();
    if (waitsForMonth(props)) {
      scope.issue(); // a refresh still on its way is not this layer's: it must not end the wait
      setPainting(true);
      return;
    }
    const sequence = scope.issue();
    const snapshot = props;
    const report = (outcome: RefreshOutcome) => {
      if (!scope.isCurrent(sequence)) return;
      if (outcome.failed) {
        setStatus(outcome.failed === "colours" ? COLOURS_UNAVAILABLE : GEOMETRY_UNAVAILABLE);
        troubleToast.current = showMapToast(outcome.failed === "colours" ? "Map colours didn't load." : "Area shapes didn't load.", {
          kind: `${outcome.failed}-failed`, action: { label: "Try again", onClick: () => setRetry((count) => count + 1) },
        });
        return;
      }
      if (troubleToast.current !== null) {
        hideMapToast(troubleToast.current);
        troubleToast.current = null;
        setStatus("Map ready");
      }
      snapshot.onCrimeCategories(outcome.pack && snapshot.metric.id === "crime" ? crimeCategories(outcome.pack.values) : []);
      snapshot.onLegendStops(outcome.rescale);
    };
    setPainting(true);
    scheduler.request(() => void refreshAnalytics(controllerReference.current, snapshot, { sequence, scope }, report)
      .finally(() => { if (scope.isCurrent(sequence)) setPainting(false); }));
  }, [mapReady, props.metric, props.mode, props.release, props.period, props.selected, props.matchPack, props.clientPack,
    props.clientRollup, props.scaleMode, props.changeWindow, props.excludedCrime, scheduler, scope, retry, viewKey]);
  // The saved camera can arrive after the map was made: it jumps there, once.
  const startCamera = useRef(props.initialCamera);
  useEffect(() => {
    const map = controllerReference.current?.map;
    const next = props.initialCamera;
    if (startCamera.current === next) return;
    startCamera.current = next;
    map?.jumpTo({ center: [next.longitude, next.latitude], zoom: next.zoom, bearing: next.bearing });
  }, [props.initialCamera]);
  useEffect(() => () => {
    scheduler.cancel();
    scope.invalidate();
  }, [scheduler, scope]);
  useEffect(() => {
    const controller = controllerReference.current;
    if (controller) controller.areaTooltip = props.clientTooltip ?? null;
  }, [mapReady, props.clientTooltip]);
  useEffect(() => focusMap(controllerReference.current, props.focus), [props.focus]);
  useEffect(() => {
    const controller = controllerReference.current;
    if (controller) controller.homePin = props.pin ?? null;
    if (!controller || !props.pin) return;
    // The small knitted house at its door, not a circle on the map: it stays put and readable over any colour.
    const element = document.createElement("div");
    element.className = "knit-home";
    element.dataset.testid = "home-pin";
    element.setAttribute("aria-hidden", "true");
    element.innerHTML = renderToStaticMarkup(<KnitLogo title="Your home" />, { identifierPrefix: "homepin" });
    const marker = new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat(props.pin).addTo(controller.map);
    return () => { marker.remove(); };
  }, [mapReady, props.pin]);
  useEffect(() => {
    const map = controllerReference.current?.map;
    if (!map || !props.chosenHome) return;
    // The chosen home itself, not its parcel: a title can cover a whole estate.
    const element = document.createElement("div");
    element.className = "chosen-home";
    element.dataset.testid = "chosen-home";
    element.setAttribute("aria-hidden", "true");
    const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat(props.chosenHome).addTo(map);
    return () => { marker.remove(); };
  }, [mapReady, props.chosenHome]);
  const onPick = props.onPick;
  useEffect(() => {
    const controller = controllerReference.current;
    if (controller) controller.onPick = onPick ?? null;
  }, [mapReady, onPick]);
  // MapLibre's own attribution control, mounted in the map's ⓘ corner (map-layers.tsx MapCredits)
  // beside Sources & privacy and Terms; it keeps the text in step with the loaded sources.
  useEffect(() => {
    const map = controllerReference.current?.map;
    const host = props.attributionHost;
    if (!map || !host) return;
    const control = new maplibregl.AttributionControl({
      compact: false,
      customAttribution: "<a href=\"https://maplibre.org/\" target=\"_blank\">MapLibre</a>",
    });
    host.append(control.onAdd(map));
    return () => control.onRemove();
  }, [props.attributionHost]);
  useEffect(() => {
    if (mapReady) applySelectedParcel(controllerReference.current, props.selectedParcelId);
  }, [mapReady, props.selectedParcelId]);
  // A selected district or borough is not a drawn area: outline its own shape and bring it into view,
  // once per selection. Only a new selection may fit it again: switching layers (which may draw that
  // geography for a moment) never moves the camera.
  const drawnCarrier = props.metric.carrier;
  useEffect(() => {
    const controller = controllerReference.current;
    if (mapReady && controller && controller.fittedWiderArea !== props.selected) controller.fittedWiderArea = null;
  }, [mapReady, props.selected]);
  useEffect(() => {
    const controller = controllerReference.current;
    const id = props.selected;
    if (!mapReady || !controller) return;
    if (!id || carrierOfId(id) === drawnCarrier) {
      showWiderArea(controller, null);
      return;
    }
    // Its tiles and pieces wait for the coverage (this runs again as it answers).
    const known = controller.coverage;
    if (!known) return;
    showWiderArea(controller, id);
    let live = true;
    const pieces = shapePieces(known, props.mode, id, mapBbox(controller.map));
    void areaBox(id, props.mode, props.release, pieces, coverageVersion(controller))
      .then((box) => { if (live && box) fitWiderArea(controller, id, box); }).catch(() => undefined);
    return () => { live = false; };
  }, [mapReady, props.selected, props.mode, props.release, drawnCarrier, coverage]);
  useEffect(() => setMapPitch(controllerReference.current?.map ?? null, props.pitch), [props.pitch]);
  useEffect(() => {
    if (mapReady && controllerReference.current) applySaleView(controllerReference.current, props.sales);
  }, [mapReady, props.sales]);
  useEffect(() => {
    if (mapReady && controllerReference.current) applyPlaceView(controllerReference.current, props.places);
  }, [mapReady, props.places]);
  useEffect(() => {
    if (mapReady && controllerReference.current) applyCycleLanes(controllerReference.current.map, props.cycleLanes ?? false);
  }, [mapReady, props.cycleLanes]);
  useEffect(() => {
    if (mapReady && controllerReference.current) applyTransitVisibility(controllerReference.current.map, props.stations ?? true);
  }, [mapReady, props.stations]);
  useEffect(() => {
    const controller = controllerReference.current;
    if (!mapReady || !controller) return;
    const { map } = controller;
    controller.schoolPopup = { show: (open) => setSchoolPopup(open ? { map, open } : null), open: null };
    return () => { controller.schoolPopup = null; };
  }, [mapReady]);
  useEffect(() => {
    if (mapReady && controllerReference.current) {
      applySchools(controllerReference.current, props.schools ?? false, props.schoolFilter ?? DEFAULT_SCHOOL_FILTER);
    }
  }, [mapReady, props.schools, props.schoolFilter]);
  useEffect(() => {
    if (mapReady && controllerReference.current) applyCollisions(controllerReference.current, props.collisions ?? null);
  }, [mapReady, props.collisions]);
  useEffect(() => {
    if (mapReady && controllerReference.current) applyUniversities(controllerReference.current, showsUniversities(props.metric.id));
  }, [mapReady, props.metric.id]);
  useEffect(() => {
    if (mapReady && controllerReference.current) applyPlain(controllerReference.current, props.plain ?? false);
  }, [mapReady, props.plain]);
  useEffect(() => {
    const map = controllerReference.current?.map;
    // Over Green cover or Green streets the trees' heat would repeat the layer: only the dots, from zoom 16 (Layers v5).
    if (mapReady && map) applyStreetTrees(map, props.streetTrees ?? false, firstSymbolLayer(map), props.detailLayer !== "canopy" && props.detailLayer !== "green-streets");
  }, [mapReady, props.streetTrees, props.detailLayer]);
  useEffect(() => {
    const controller = controllerReference.current;
    if (!mapReady || !controller) return;
    const { map } = controller;
    applyGreenStreets(map, props.detailLayer === "green-streets", firstSymbolLayer(map), fillBeforeLayer(map));
    applyCanopy(map, props.detailLayer === "canopy", firstSymbolLayer(map));
    controller.areaFillHidden = !!props.detailLayer;
    applyAreaFade(controller);
  }, [mapReady, props.detailLayer]);
  useEffect(() => {
    const controller = controllerReference.current;
    if (!mapReady || !controller || !props.zoomTo) return;
    controller.pendingFit = props.zoomTo.id;
    controller.fitZoom = props.zoomTo.zoom ?? null;
    fitPendingArea(controller);
  }, [mapReady, props.zoomTo]);

  function onFailure(message: string) {
    setMapFailed(true);
    setStatus(message);
  }

  return (
    <section className="map-stage" aria-label={`Interactive ${place} analytics map`} data-painting={painting && !mapFailed ? "true" : "false"}>
      <div ref={container} className="map-canvas" data-testid="map-canvas" />
      {mapFailed && (
        <div className="map-fallback" data-testid="map-fallback" role="status">
          <p>{MAP_UNAVAILABLE}</p>
        </div>
      )}
      {/* Shown after 400 ms (CSS), not announced: the status below speaks for it. */}
      <div className="map-loading" data-testid="map-loading" aria-hidden="true" hidden={!painting || mapFailed}>
        <span className="map-loading__pill">Loading map</span>
      </div>
      {/* Announced, not shown: the map itself shows when it is ready. */}
      <span className="map-status sr-only" role="status">{status}</span>
      {/* The places key shows only where places are drawn: at city zoom the map stays the area colour. */}
      <div className="map-tooltip" data-testid="map-tooltip" role="status" aria-live="polite" hidden />
      {mapReady && props.schools && controllerReference.current && (
        <SchoolMapKeys map={controllerReference.current.map}
          onFocusSchool={(point) => showSchoolPopup(controllerReference.current!, { point, focused: true })}
          onBlurSchool={() => showSchoolPopup(controllerReference.current!, null)} />
      )}
      {schoolPopup && (
        <SchoolMapPopup map={schoolPopup.map} open={schoolPopup.open} />
      )}
    </section>
  );
}

function createMap(
  container: React.RefObject<HTMLDivElement | null>,
  reference: React.MutableRefObject<MapController | null>,
  props: AreaMapProps,
  events: { setStatus: (status: string) => void; onFailure: (message: string) => void; onReady: () => void },
) {
  if (!container.current) return;
  maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
  registerAreaTileProtocol(maplibregl);
  let controller: MapController;
  // A link elsewhere in England (or zoomed out past London) opens unclamped: the coverage, once it answers, sets
  // the bounds and minimum zoom (London's pull it back into London). Any other start is held to London as before.
  const start = props.initialCamera;
  const londonStart = isLondonStart(start);
  try {
    const created = new maplibregl.Map({
      container: container.current,
      style: BASE_STYLE,
      center: [props.initialCamera.longitude, props.initialCamera.latitude],
      zoom: props.initialCamera.zoom,
      // The link's pitch, as when the map mounted with the page: it now mounts after the explorer's
      // first effects, which may already have changed props.pitch.
      pitch: initialPitch(BOOT_SEARCH, container.current.clientWidth, props.initialCamera.pitch, chosenPitch()),
      bearing: props.initialCamera.bearing,
      maxPitch: 60,
      minZoom: londonStart ? MIN_MAP_ZOOM : Math.min(MIN_MAP_ZOOM, start.zoom),
      maxZoom: MAX_MAP_ZOOM,
      ...(londonStart ? { maxBounds: panBounds(LONDON_BOUNDS, container.current.clientWidth, isPhone()) } : {}),
      // A click only selects; a double click or tap zooms in a step everywhere (Map controls PR 1,
      // as Google: the first click still selects). No shift-drag box zoom. Tilt is in the menu; the attribution
      // lives in the ⓘ corner.
      doubleClickZoom: true,
      boxZoom: false,
      attributionControl: false,
      maxTileCacheZoomLevels: MAP_TILE_CACHE_ZOOM_LEVELS,
    });
    controller = createMapController(created, {
      onCamera: props.onCamera, onPitch: props.onPitch, onSelect: props.onSelect,
      onSelectDwelling: props.onSelectDwelling, onSelectSale: props.onSelectSale, onMedian: props.onMedian, onPainted: props.onPainted,
    });
    // A link with its own position keeps it: the wider area it names is outlined, not fitted.
    if (props.selected && !props.zoomTo) controller.fittedWiderArea = props.selected;
    // A link naming an area but no position waits for its fit: moves before it (load, layout) leave
    // the address without a position, so the default camera never lands there first.
    if (props.zoomTo) {
      controller.pendingFit = props.zoomTo.id;
      controller.fitZoom = props.zoomTo.zoom ?? null;
    }
  } catch {
    events.onFailure(MAP_UNAVAILABLE);
    return;
  }
  reference.current = controller;
  const { map } = controller;
  map.getCanvas().setAttribute("aria-label", canvasLabel("London"));
  registerMapEvents(controller, events.setStatus, events.onReady);
  const keys = (event: KeyboardEvent) => chooseCentreArea(controller, event);
  map.getCanvas().addEventListener("keydown", keys, true);
  return () => {
    map.getCanvas().removeEventListener("keydown", keys, true);
    reference.current = null;
    disposeMapController(controller);
    map.remove();
  };
}

function canvasLabel(place: string): string {
  return `${place} analytics map. Use arrow keys to move, Enter to choose the area in the middle.`;
}

function registerMapEvents(controller: MapController, setStatus: (status: string) => void, onReady: () => void) {
  const { map } = controller;
  // Recolour the basemap for the theme whenever a style (re)loads.
  // House numbers and the rail network go in as the style loads: a vector tile is parsed only for
  // the source layers in use when it arrives, so added later they would stay empty until a reload.
  map.on("style.load", () => {
    const first = !controller.styleLoaded;
    controller.styleLoaded = true;
    ensureBasemapExtras(map);
    // Water and green space over the area colour (veils over the buildings, under the streets); park
    // names over the basemap's labels, under the stations' and the areas'.
    const veil = veilAnchor((id) => !!map.getLayer(id));
    // Park names (park-labels.json) are London's: they load once London is in view.
    ensureLandmarks(map, window.location.origin, resolvedUiTheme(), { ground: "water", veil }, { parkLabelsLater: true });
    // The Tube network goes in with the style, in its place among the layers, but empty: its data
    // (tfl-network.json, about 555 KB) loads after the first idle, once the basemap and areas have painted,
    // and only once London is in view (the England map may open elsewhere).
    const origin = window.location.origin;
    if (!map.getSource(TRANSIT_SOURCE)) map.addSource(TRANSIT_SOURCE, { ...transitSource(origin), data: EMPTY_COLLECTION });
    ensureTransit(map, origin, resolvedUiTheme(), window.devicePixelRatio || 1, firstSymbolLayer(map));
    onceLondonInView(map, () => {
      (map.getSource(TRANSIT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(transitSource(origin).data);
      (map.getSource(PARK_LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(parkLabelSource(origin).data);
    });
    applyBasemapTheme(map, resolvedUiTheme());
    // The map is ready for its layers once the style is in, not after the basemap's tiles ("load"): the areas'
    // shapes and colours then load and tile alongside the basemap instead of after it (layer load time, phase C).
    if (first) {
      addBuildingLayer(map);
      registerPick(controller);
      onReady();
    }
  });
  map.on("load", () => {
    setStatus("Map ready");
  });
  // A gesture before the area shapes load means the visitor has moved on.
  map.on("movestart", (event) => {
    if (event.originalEvent) {
      controller.pendingFit = null;
      controller.fitZoom = null;
      controller.distantFit = null;
    }
  });
  map.on("moveend", (event) => {
    const center = map.getCenter();
    // Pans and zooms the reader made (not fits and fly-tos): where on the map people look.
    if (event.originalEvent) trackMapView(map.getZoom(), center.lat, center.lng);
    // Until the selected area's first fit (or a gesture) the camera is not the link's yet.
    if ((controller.pendingFit !== null || controller.distantFit !== null) && !event.originalEvent) return;
    const callbacks = controller.callbacks;
    callbacks.onPitch(Math.round(map.getPitch()));
    callbacks.onCamera({
      ...DEFAULT_MAP_STATE,
      latitude: round(center.lat), longitude: round(center.lng), zoom: round(map.getZoom()),
      pitch: Math.round(map.getPitch()), bearing: round(map.getBearing()),
    });
  });
  // The basemap's own style failing (not a tile) leaves a blank map: say so, with Try again.
  // Only before the style has ever loaded: later errors (an overlay's layer or image while My match first
  // colours the map, an aborted request) leave the basemap drawn, and isStyleLoaded() is false whenever a
  // source is still updating, so it cannot tell them apart.
  map.on("error", (event: maplibregl.ErrorEvent & { sourceId?: string }) => {
    if (event.sourceId || controller.styleLoaded || map.isStyleLoaded() || controller.basemapToast) return;
    setStatus("Basemap unavailable; analytics remain usable");
    controller.basemapToast = true;
    showMapToast("Base map didn't load.", {
      kind: "basemap-failed",
      action: { label: "Try again", onClick: () => { controller.basemapToast = false; map.setStyle(BASE_STYLE); } },
    });
  });
}

function basemapVectorUrl(map: MapLibreMap): string | null {
  for (const source of Object.values(map.getStyle().sources)) {
    if (source.type === "vector" && typeof source.url === "string") return source.url;
  }
  return null;
}

function addBuildingLayer(map: MapLibreMap) {
  if (map.getSource("area-buildings")) return;
  const fixtureStyle = BASE_STYLE.startsWith("/");
  // Extrude buildings from the configured basemap's own vector tiles
  // (OpenMapTiles schema), so a pinned or self-hosted basemap is the only
  // tile host the map talks to.
  const basemapTiles = fixtureStyle ? null : basemapVectorUrl(map);
  if (!fixtureStyle && !basemapTiles) return;
  map.addSource("area-buildings", fixtureStyle
    ? { type: "geojson", data: previewBuildings() }
    : { type: "vector", url: basemapTiles! });
  map.addLayer({
    id: "neutral-3d-buildings", type: "fill-extrusion", source: "area-buildings",
    ...(fixtureStyle ? {} : { "source-layer": "building", minzoom: 15 }),
    paint: {
      "fill-extrusion-color": "#c9c5ba",
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": BUILDING_EXTRUSION_OPACITY,
    },
  }, firstSymbolLayer(map));
}

/**
 * The keyboard's click: with the map focused, Enter or Space chooses the area under the
 * middle of the visible map (clear of the top bar and the panel), as a click there would, and never
 * moves the camera. The arrow keys pan and +/− zoom as MapLibre has them.
 */
function chooseCentreArea(controller: MapController, event: KeyboardEvent) {
  if ((event.key !== "Enter" && event.key !== " ") || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  event.stopPropagation();
  const { map } = controller;
  const container = map.getContainer();
  if (container.dataset.picking === "true" || !areaFills(map).length) return;
  const pad = visiblePadding(container, 0);
  const point = new maplibregl.Point(
    (container.clientWidth + pad.left - pad.right) / 2,
    (container.clientHeight + pad.top - pad.bottom) / 2,
  );
  const hit = renderedAreas(map, point)[0];
  const id = hit ? featureAreaId(hit) : undefined;
  if (typeof id === "string") controller.callbacks.onSelect(id as GeographyId);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
