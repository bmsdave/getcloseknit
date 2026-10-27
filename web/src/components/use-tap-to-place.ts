"use client";

import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";

/**
 * Tap-to-place: while `active`, a crosshair and one tap on the map that becomes a point (a new place, or
 * your place moved). The map's own tap stands down meanwhile (data-picking: map-controller/interactions.ts registerPick).
 */
export function useTapToPlace(map: MapLibreMap | null, active: boolean, onPoint: (point: { latitude: number; longitude: number }) => void) {
  const latest = useRef(onPoint);
  latest.current = onPoint;
  useEffect(() => {
    if (!map || !active) return;
    const canvas = map.getCanvas();
    const container = map.getContainer();
    canvas.style.cursor = "crosshair";
    container.dataset.picking = "true";
    const click = (event: MapMouseEvent) => latest.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    map.once("click", click);
    return () => {
      canvas.style.cursor = "";
      delete container.dataset.picking;
      map.off("click", click);
    };
  }, [map, active]);
}
