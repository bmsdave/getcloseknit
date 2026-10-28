/** One refresh of the area colours: the pieces in view, their packs and boxes, then one paint for all of them. */
import { paintBoxes, pieceAreas } from "@/lib/area-boxes";
import { effectiveScaleMode } from "@/lib/legend-scale";
import { chunkRegion, lsoaPieces, setViewScope, WIDE_ZOOM, type ViewPiece } from "@/lib/map-coverage";
import { matchValuePack } from "@/lib/matching";
import { areaRegion, noDataEntries, setViewCoverage, viewCoverage } from "@/lib/no-data";

import { fitMissedArea, fitPendingArea } from "./camera";
import type { MapController } from "./controller";
import { areaBoxes, areaTilesOf, coverageOf, coverageVersion, currentPieces, fetchChangeBase, fetchValuePack, mapBbox, sameAreas } from "./data";
import { diagnosticsEnabled, installDiagnostics, recordRefreshTiming } from "./diagnostics";
import { clearAreaFill, ensureTileLayers, lsoaLevels, nextKindLoaded, paintView } from "./paint";
import { mapViewScope, resolveAnalyticsView, scaleBounds } from "./scale";
import type { AreaMapProps, RefreshOutcome, RefreshTicket } from "./types";

/** A lens swap (another layer or comparison colours the map) is timed as this performance measure. */
export const LENS_SWAP = "ck:lens-swap";
export const LENS_SWAP_START = "ck:lens-swap:start";

export async function refreshAnalytics(
  controller: MapController | null,
  props: AreaMapProps,
  ticket: RefreshTicket,
  report: (outcome: RefreshOutcome) => void,
) {
  const current = () => ticket.scope.isCurrent(ticket.sequence);
  if (!controller?.map.getSource("area-buildings") || !current()) return;
  const { map } = controller;
  if (props.metric.id === "personal-match" && !props.matchPack) {
    // My match before its first criterion (or while the first answer loads): the neutral map, never every area
    // grey under the match legend, nor the last layer's colours. The next pack paints over it.
    clearAreaFill(controller);
    report({ ready: true, pack: null, rescale: null });
    return;
  }
  // Zoomed out, a ready-made criterion paints its MSOAs on the pieces every other LSOA layer loads there.
  const coverage = coverageOf(controller);
  const rollup = props.clientPack && props.clientRollup && !props.matchPack && props.mode === "real"
    && coverage.coverage === "england" && map.getZoom() < WIDE_ZOOM ? await props.clientRollup() : null;
  if (!current()) return;
  controller.rolledTooltip = rollup ? rollup.tooltip : null;
  // The layer's pieces in view (lib/map-coverage.ts); a match or client pack brings its own areas.
  // A client pack (a ready-made criterion) carries every LSOA: it paints on the LSOA pieces in view, not England's.
  const pieces = props.matchPack ? null
    : rollup ? currentPieces(controller, { mode: props.mode, carrier: "lsoa" })
      : props.clientPack ? lsoaPieces(coverage, props.mode, mapBbox(map), map.getZoom())
        : currentPieces(controller, { mode: props.mode, carrier: props.metric.carrier });
  if (rollup) {
    await paintPieces(controller, { ...props, clientPack: rollup.pack }, ticket, report, pieces);
    return;
  }
  // Every piece in view paints in the same frame, London's with its neighbours': one map, never London first.
  await paintPieces(controller, props, ticket, report, pieces);
}

/** Fetches and paints one set of pieces (null: a match or client pack's own areas); false when it did not paint. */
async function paintPieces(
  controller: MapController,
  props: AreaMapProps,
  ticket: RefreshTicket,
  report: (outcome: RefreshOutcome) => void,
  pieces: readonly ViewPiece[] | null,
): Promise<boolean> {
  const { map } = controller;
  const current = () => ticket.scope.isCurrent(ticket.sequence);
  const started = performance.now();
  const changeMode = !props.matchPack && !props.clientPack && effectiveScaleMode(props.metric.id, props.scaleMode, false) === "change";
  const [pack, base] = await Promise.all([
    props.matchPack ? matchValuePack(props.matchPack) : props.clientPack ?? fetchValuePack(controller, props, pieces ?? []),
    changeMode ? fetchChangeBase(controller, props, pieces ?? []) : null,
  ]);
  const fetched = performance.now();
  if (!current()) return false;
  if (!pack) {
    if (controller.packFailed) report({ ready: false, pack: null, rescale: null, failed: "colours" });
    return false;
  }
  // The tiles draw the shapes (lib/area-tiles.ts): only each area's box is fetched (lib/area-boxes.ts).
  const tiles = areaTilesOf(controller);
  const regionOf = (chunk: string | null) => chunkRegion(coverageOf(controller), chunk);
  // Inside the layer's coverage an area of the pieces without a value is grey, outside it clear (lib/no-data.ts).
  const missing = tiles && pieces?.length && !props.matchPack && !props.clientPack
    ? await pieceAreas(pieces, props.mode, props.release, coverageVersion(controller), regionOf)
      .then((areas) => noDataEntries(pack.values, areas, pieces[0].carrier, (box) => areaRegion(box, coverageOf(controller))))
      .catch(() => [])
    : [];
  if (!current()) return false;
  const painted = missing.length ? { ...pack, values: [...pack.values, ...missing] } : pack;
  const fresh = tiles ? await paintBoxes(painted.values, pieces, props.mode, props.release, coverageVersion(controller),
    regionOf, !!props.clientPack).catch(() => null) : null;
  // The same areas as the last paint (a match re-scored): its boxes kept, nothing about the shapes changed.
  const data = fresh && sameAreas(controller.paintedBoxes, fresh) ? controller.paintedBoxes! : fresh;
  if (!current()) return false;
  if (!data || !tiles) {
    report({ ready: false, pack: null, rescale: null, failed: "shapes" });
    return false;
  }
  // Another kind of area than the one drawn (zoomed past WIDE_ZOOM, a layer on another carrier): its tiles load
  // first, so its colours land in the frame the drawn kind's leave.
  const kind = pieces?.[0]?.carrier ?? pack.values[0]?.carrier ?? props.metric.carrier;
  if (controller.drawnKind !== kind) {
    await nextKindLoaded(controller, tiles, kind);
    if (!current()) return false;
  }
  // The scale follows the areas this paint puts in view: one region's ranks, or England's across regions.
  if (pieces) setViewScope(mapViewScope(controller, props.mode, data));
  const level = `${props.metric.id}:${pieces?.[0]?.carrier ?? "own"}`;
  const view = resolveAnalyticsView(painted, props, base, { bounds: scaleBounds(controller, level), boxes: areaBoxes(data), now: mapBbox(map) });
  controller.lastPaint = { pack: painted, props, base, data, level, ticket };
  setViewCoverage(props.matchPack ? null : viewCoverage(painted.values, areaBoxes(data), mapBbox(map)));
  ensureTileLayers(controller, data, tiles, kind, lsoaLevels(props), new Set(painted.values.map((entry) => entry.carrier)));
  // A zoomTo waiting for its box gets this one load: found or not, it is spent, so a later
  // layer switch never flies back to it. A wider area fits by its own box.
  fitPendingArea(controller);
  // Not among the pieces in view (a link to Cornwall, or an MSOA in Leeds on an LSOA layer, opens on London):
  // its own box, from its evidence (fitMissedArea).
  const missed = controller.pendingFit;
  controller.pendingFit = null;
  if (missed) fitMissedArea(controller, missed, props);
  paintView(controller, view);
  if (performance.getEntriesByName(LENS_SWAP_START, "mark").length) {
    performance.measure(LENS_SWAP, LENS_SWAP_START);
    performance.clearMarks(LENS_SWAP_START);
  }
  if (diagnosticsEnabled()) {
    installDiagnostics(controller, view);
    recordRefreshTiming(controller, { period: pack.period, fetchMs: fetched - started, applyMs: performance.now() - fetched });
  }
  report({ ready: true, pack, rescale: view.rescale });
  return true;
}
