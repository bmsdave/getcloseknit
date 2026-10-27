/**
 * Layer load time (perf/layer-load/README.md): from opening the map on a layer (navigation start) or switching to
 * one, until its colours are applied and the map is idle (every source and tile in view loaded, nothing left to
 * draw). One record per layer change: performance measure "ck:layer-load" and window.__ckLayerTimings (the last 50),
 * read by e2e/perf/layer-load.spec.ts. No network and no listeners while nothing is pending.
 */
export const LAYER_LOAD_MEASURE = "ck:layer-load";
const KEPT = 50;

export type LayerLoadTrigger = "open" | "switch";

export interface LayerLoadTiming {
  layer: string;
  trigger: LayerLoadTrigger;
  /** performance.now() at the start: 0 (navigation start) for the layer the map opened on. */
  startMs: number;
  /** When the colours were last applied (the map's painting state settled). */
  paintedMs: number;
  /** When the map went idle after that. */
  endMs: number;
  ms: number;
  zoom: number | null;
}

export interface PendingLayerLoad {
  readonly layer: string;
  readonly trigger: LayerLoadTrigger;
  readonly startMs: number;
  paintedMs: number | null;
}

export interface LayerLoadTimer {
  /** A layer is asked for: the first one is the map's opening layer, any later one a switch. */
  begin(layer: string): void;
  /** Its colours are applied; null when nothing is pending. Wait for the map's idle, then call settle. */
  painted(): PendingLayerLoad | null;
  /** The map is idle after painting: records the load once, unless another layer was asked for meanwhile. */
  settle(pending: PendingLayerLoad, zoom: number | null): LayerLoadTiming | null;
}

export function createLayerLoadTimer(
  record: (timing: LayerLoadTiming) => void,
  now: () => number = () => performance.now(),
): LayerLoadTimer {
  let pending: PendingLayerLoad | null = null;
  let opened = false;
  return {
    begin(layer) {
      // The same layer again while it loads (React's dev double effect): one load, from its first start.
      if (pending?.layer === layer) return;
      const trigger: LayerLoadTrigger = opened ? "switch" : "open";
      opened = true;
      pending = { layer, trigger, startMs: trigger === "open" ? 0 : now(), paintedMs: null };
    },
    painted() {
      if (!pending) return null;
      pending.paintedMs = now();
      return pending;
    },
    settle(settled, zoom) {
      if (settled !== pending || settled.paintedMs === null) return null;
      pending = null;
      const endMs = now();
      const timing: LayerLoadTiming = {
        layer: settled.layer, trigger: settled.trigger, startMs: settled.startMs, paintedMs: settled.paintedMs,
        endMs, ms: Math.round(endMs - settled.startMs), zoom: zoom === null ? null : Math.round(zoom * 100) / 100,
      };
      record(timing);
      return timing;
    },
  };
}

declare global {
  interface Window {
    __ckLayerTimings?: LayerLoadTiming[];
  }
}

/** The browser's record: window.__ckLayerTimings and a performance measure (both stay on the device). */
export function recordLayerLoad(timing: LayerLoadTiming): void {
  if (typeof window === "undefined") return;
  const kept = window.__ckLayerTimings ?? [];
  kept.push(timing);
  window.__ckLayerTimings = kept.slice(-KEPT);
  try {
    performance.measure(LAYER_LOAD_MEASURE, { start: timing.startMs, end: timing.endMs, detail: timing });
  } catch {
    // An old browser without measure options: the window record is enough.
  }
}
