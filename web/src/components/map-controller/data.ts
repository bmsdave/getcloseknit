/**
 * The area map's data: the coverage it paints by, the pieces in view, their value packs and boxes, and the first
 * view's prefetch (lib/map-coverage.ts, lib/area-boxes.ts, lib/area-tiles.ts).
 */
import type { Map as MapLibreMap } from "maplibre-gl";

import type { Carrier, GeographyId, ValuePack } from "@/lib/contracts";
import { prefetchPieceBoxes, type AreaBoxes } from "@/lib/area-boxes";
import { isAreaTiles, type AreaTiles } from "@/lib/area-tiles";
import { isCustomLayerId } from "@/lib/custom-criteria";
import {
  demoPiece, intersects, LONDON_BBOX, londonPiece, piecePackPath, setActiveView, viewPackPaths, viewPieces,
  type Bbox, type MapCoverage, type ViewPiece,
} from "@/lib/map-coverage";
import { cameraBbox, isLondonStart } from "@/lib/map-preload";
import { isLayerAvailableInMode, valuePackPath, type DataMode } from "@/lib/map-state";
import { changeBasePeriod } from "@/lib/map-trend";
import { isDetailLayer } from "@/lib/nature-layers";
import { politeFetch } from "@/lib/polite-fetch";
import { valuePackCache } from "@/lib/timeline-playback";
import { readValuePack } from "@/lib/value-pack-compact";

import type { MapController } from "./controller";
import type { AreaMapProps } from "./types";

/** The map's view as [west, south, east, north]. */
export function mapBbox(map: MapLibreMap): Bbox {
  const bounds = map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

/**
 * The coverage a map paints by. The coverage effect sets it before the map's first view key, so every paint and
 * view read has it; reading it earlier is a bug, never a reason to fall back on London's.
 */
export function coverageOf(controller: MapController): MapCoverage {
  const coverage = controller.coverage;
  if (!coverage) throw new Error("map coverage read before it loaded");
  return coverage;
}

/** The release a map's chunk URLs name (?v=), from its coverage; null on the London map. */
export function coverageVersion(controller: MapController): string | null {
  return controller.coverage?.productReleaseId ?? null;
}

/** The pieces this map's view loads for a layer drawn on `carrier` (lib/map-coverage.ts). */
export function currentPieces(controller: MapController, layer: { mode: DataMode; carrier: Carrier }): ViewPiece[] {
  const { map } = controller;
  return viewPieces(coverageOf(controller), layer.mode, layer.carrier, mapBbox(map), map.getZoom());
}

/** The area tiles a map draws from, as its coverage names them (null before it answers, or an API without them). */
export function areaTilesOf(controller: MapController): AreaTiles | null {
  const tiles = controller.coverage?.areaTiles;
  return isAreaTiles(tiles) ? tiles : null;
}

/** Each drawn area's box by id, kept per paint (the in-view test of the rank scale): a memo of immutable data. */
const areaBoxCache = new WeakMap<AreaBoxes, Map<string, Bbox>>();

export function areaBoxes(data: AreaBoxes): ReadonlyMap<string, Bbox> {
  let boxes = areaBoxCache.get(data);
  if (!boxes) areaBoxCache.set(data, boxes = new Map(data.map((area) => [area.id as string, area.bbox])));
  return boxes;
}

/** The same areas in any order (a re-scored match reorders its pack). */
export function sameAreas(left: AreaBoxes | null, right: AreaBoxes): boolean {
  if (!left || left.length !== right.length) return false;
  const held = areaBoxes(left);
  return right.every((box) => held.get(box.id) === box.bbox);
}

/** Bounding box [west, south, east, north] of one drawn area, or null. */
export function areaBounds(data: AreaBoxes | null, id: GeographyId): Bbox | null {
  return data ? areaBoxes(data).get(id) ?? null : null;
}

/** One pack from the pieces' packs: the first's month and source, every piece's areas (a piece without the month adds none). */
export function mergePacks(packs: readonly (ValuePack | null)[], props: Pick<AreaMapProps, "metric">, period: string): ValuePack | null {
  if (packs.length === 1) return packs[0];
  const found = packs.filter((pack): pack is ValuePack => pack !== null);
  if (packs.length && !found.length) return null;
  const first = found[0];
  return {
    schemaVersion: "area-value-pack.v1", metricId: first?.metricId ?? props.metric.id, period: first?.period ?? period,
    sourceVersion: first?.sourceVersion ?? "", productReleaseId: first?.productReleaseId,
    values: found.flatMap((pack) => pack.values),
  };
}

export async function fetchValuePack(controller: MapController, props: AreaMapProps, pieces: readonly ViewPiece[]): Promise<ValuePack | null> {
  if (props.metric.id === "personal-match" || isCustomLayerId(props.metric.id) || isDetailLayer(props.metric.id)) return null;
  if (!isLayerAvailableInMode(props.metric.id, props.mode)) {
    return {
      schemaVersion: "area-value-pack.v1",
      metricId: props.metric.id,
      period: props.period,
      sourceVersion: "",
      values: [],
    };
  }
  controller.fetchController?.abort();
  const fetchController = new AbortController();
  controller.fetchController = fetchController;
  controller.packFailed = false;
  try {
    const base = valuePackPath({
      metric: props.metric.id, period: props.period, mode: props.mode, release: props.release,
    });
    const version = coverageVersion(controller);
    // The price timeline prefetches the months ahead for the same pieces.
    setActiveView(pieces, version);
    // Shared with the timeline's prefetch: a pack fetched ahead paints from memory.
    const packs = await Promise.all(viewPackPaths(base, pieces, version).map((path) => valuePackCache.get(path, fetchController.signal)));
    return mergePacks(packs, props, props.period);
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") {
      console.error("Close Knit value-pack request failed", error);
      if (!fetchController.signal.aborted) controller.packFailed = true;
    }
    return null;
  }
}

/** The value pack for period − window, or null when the metric has no data that far back. */
export async function fetchChangeBase(controller: MapController, props: AreaMapProps, pieces: readonly ViewPiece[]): Promise<ValuePack | null> {
  const period = changeBasePeriod(props.period, props.changeWindow, props.metric.periods);
  if (period === null || !isLayerAvailableInMode(props.metric.id, props.mode)) return null;
  controller.baseFetchController?.abort();
  const fetchController = new AbortController();
  controller.baseFetchController = fetchController;
  try {
    const base = valuePackPath({ metric: props.metric.id, period, mode: props.mode, release: props.release });
    const version = coverageVersion(controller);
    const packs = await Promise.all(viewPackPaths(base, pieces, version).map(async (path) => {
      const response = await politeFetch(path, { signal: fetchController.signal });
      return response.ok ? readValuePack(await response.json()) : null;
    }));
    return mergePacks(packs, props, period);
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") {
      console.error("Close Knit change-base value-pack request failed", error);
    }
    return null;
  }
}

/** A layer painted from value packs whose month is not known yet (period ""): nothing to fetch until it is. */
export function waitsForMonth(props: AreaMapProps): boolean {
  // A criterion layer paints from its own pack: until it arrives there is nothing to paint (the map stays "Loading
  // map", and the layer's load time ends when its colours are on, not when the switch began).
  if (isCustomLayerId(props.metric.id) && !props.clientPack && !props.matchPack) return true;
  if (props.period || props.matchPack || props.clientPack || props.mode !== "real") return false;
  return props.metric.id !== "personal-match" && !isCustomLayerId(props.metric.id) && !isDetailLayer(props.metric.id);
}

/** The value pack the map will paint first for these props (London's one piece), or null when it paints without one. */
export function layerPackPath(props: AreaMapProps): string | null {
  const base = layerPackBase(props);
  if (!base) return null;
  const first = props.mode === "demo" ? demoPiece(props.metric.carrier) : londonPiece(props.metric.carrier);
  // Before the coverage answers: the map's release is the one the coverage names (the URL the paint then asks for).
  return piecePackPath(base, first, props.mode === "real" ? props.release : null);
}

/** The layer's value-pack URL before its pieces (map-state.valuePackPath), or null when it paints without one. */
export function layerPackBase(props: AreaMapProps): string | null {
  if (props.matchPack || props.clientPack || !props.period) return null;
  if (props.metric.id === "personal-match" || isCustomLayerId(props.metric.id) || isDetailLayer(props.metric.id)) return null;
  if (!isLayerAvailableInMode(props.metric.id, props.mode)) return null;
  return valuePackPath({ metric: props.metric.id, period: props.period, mode: props.mode, release: props.release });
}

/**
 * The first view's pieces, fetched as soon as the coverage answers: boxes and values then run alongside the
 * basemap's style instead of after it, and every piece is in hand when the map is ready to paint them together.
 */
export function prefetchStartPieces(coverage: MapCoverage, props: AreaMapProps, element: HTMLElement | null) {
  if (props.mode !== "real" || !element) return;
  if (coverage.coverage !== "england") {
    // The London map: London's one piece of boxes (its pack started with the map).
    if (isLondonStart(props.initialCamera)) prefetchPieceBoxes(londonPiece("lsoa"), props.release, coverage.productReleaseId);
    return;
  }
  const { latitude, longitude, zoom } = props.initialCamera;
  const pieces = viewPieces(coverage, props.mode, props.metric.carrier,
    cameraBbox(latitude, longitude, zoom, element.clientWidth, element.clientHeight), zoom);
  for (const entry of pieces) prefetchPieceBoxes(entry, props.release, coverage.productReleaseId);
  const base = layerPackBase(props);
  if (base) valuePackCache.prefetch(viewPackPaths(base, pieces, coverage.productReleaseId));
}

/**
 * Runs `load` once, after the first idle, as soon as the view touches Greater London: the overlays built from
 * London-only sources (the Tube network, park names) are never downloaded for a view of elsewhere in England.
 */
export function onceLondonInView(map: MapLibreMap, load: () => void): void {
  let done = false;
  const check = () => {
    if (done || !intersects(mapBbox(map), LONDON_BBOX)) return;
    done = true;
    map.off("moveend", check);
    load();
  };
  map.once("idle", () => {
    check();
    if (!done) map.on("moveend", check);
  });
}
