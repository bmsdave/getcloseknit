"use client";

import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { POLYGON_POINTS, type MatchZone } from "@/lib/contracts";
import { matchInk } from "@/lib/match-map";
import { onUiThemeChange, resolvedUiTheme } from "@/lib/ui-themes";
import { zoneKey, type ZoneShape, type ZoneShapesResponse } from "@/lib/zones";

const SOURCE = "zone-draw";
const LAYERS = ["zone-draw-fill", "zone-draw-line", "zone-draw-draft", "zone-draw-corners"];
/** The zone's light tint (board V4-08: ink at 6 %). */
export const ZONE_TINT = 0.06;

interface ZoneDrawProps {
  map: MapLibreMap | null;
  zones: MatchZone[] | undefined;
  /** Corners of the area being drawn ([latitude, longitude]); null when not drawing. */
  draft: [number, number][] | null;
  onDraft: (draft: [number, number][]) => void;
}

/**
 * Drawn zones on the map: the household's polygons outlined and, while drawing, each tap adds a
 * corner (the area under the tap is not selected meanwhile). Finishing and removing live in the
 * panel ("Your search"); this layer only draws and listens.
 */
export function ZoneDraw({ map, zones, draft, onDraft }: ZoneDrawProps) {
  const [ready, setReady] = useState(0);
  const latest = useRef({ draft, onDraft });
  latest.current = { draft, onDraft };

  useEffect(() => {
    if (!map) return;
    const ensure = () => {
      if (!map.isStyleLoaded() || map.getSource(SOURCE)) return;
      const ink = matchInk(resolvedUiTheme());
      map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // A zone: a light tint in the theme's ink and a thin dashed outline, so the match colours read through.
      // The polygon being drawn fills as it grows.
      map.addLayer({ id: "zone-draw-fill", type: "fill", source: SOURCE, filter: ["in", ["get", "kind"], ["literal", ["zone", "draft-area"]]],
        paint: { "fill-color": ink, "fill-opacity": ZONE_TINT } });
      map.addLayer({ id: "zone-draw-line", type: "line", source: SOURCE, filter: ["==", ["get", "kind"], "zone"],
        layout: { "line-join": "round" }, paint: { "line-color": ink, "line-width": 2, "line-dasharray": [3, 2] } });
      map.addLayer({ id: "zone-draw-draft", type: "line", source: SOURCE, filter: ["==", ["get", "kind"], "draft"],
        layout: { "line-join": "round" }, paint: { "line-color": ink, "line-width": 2, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "zone-draw-corners", type: "circle", source: SOURCE, filter: ["==", ["get", "kind"], "corner"],
        paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#22252c", "circle-stroke-width": 2 } });
      setReady((value) => value + 1);
    };
    ensure();
    map.on("styledata", ensure);
    map.on("idle", ensure);
    // Day and Night: the outline and tint follow the theme's ink, never navy on navy.
    const unsubscribe = onUiThemeChange(() => {
      const ink = matchInk(resolvedUiTheme());
      if (map.getLayer("zone-draw-fill")) map.setPaintProperty("zone-draw-fill", "fill-color", ink);
      for (const id of ["zone-draw-line", "zone-draw-draft"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-color", ink);
    });
    return () => {
      unsubscribe();
      map.off("styledata", ensure);
      map.off("idle", ensure);
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
  }, [map]);

  const shapes = useZoneShapes(zones);
  useEffect(() => {
    const source = map?.getSource(SOURCE) as GeoJSONSource | undefined;
    source?.setData(drawnFeatures(zones, draft, shapes));
  }, [map, zones, draft, shapes, ready]);

  const drawing = draft !== null;
  useEffect(() => {
    if (!map || !drawing) return;
    const container = map.getContainer();
    container.dataset.picking = "true";
    map.getCanvas().style.cursor = "crosshair";
    const click = (event: MapMouseEvent) => {
      const { draft: current, onDraft: update } = latest.current;
      if (current && current.length < POLYGON_POINTS.max) update([...current, [round(event.lngLat.lat), round(event.lngLat.lng)]]);
    };
    map.on("click", click);
    return () => {
      delete container.dataset.picking;
      map.getCanvas().style.cursor = "";
      map.off("click", click);
    };
  }, [map, drawing]);

  return null;
}

/**
 * A station's walk, a borough or a list of areas has no corners of its own: its outline comes from the API
 * (POST /api/v1/zone-shapes), keyed by zoneKey. Asked again only when those zones change; drawn ones never ask.
 */
function useZoneShapes(zones: MatchZone[] | undefined): ReadonlyMap<string, ZoneShape["geometry"]> {
  const asked = (zones ?? []).filter((zone) => zone.kind !== "polygon");
  const key = asked.length ? JSON.stringify(asked) : null;
  const [answer, setAnswer] = useState<{ key: string; shapes: Map<string, ZoneShape["geometry"]> } | null>(null);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const sent = JSON.parse(key) as MatchZone[];
    void fetch("/api/v1/zone-shapes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ zones: sent }), signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<ZoneShapesResponse> : null))
      .then((body) => {
        if (controller.signal.aborted || !body) return;
        setAnswer({ key, shapes: new Map(sent.map((zone, index) => [zoneKey(zone), body.zones[index]?.geometry ?? null])) });
      })
      // No outline is better than a wrong one: the zone still scores, only its line is missing.
      .catch(() => undefined);
    return () => controller.abort();
  }, [key]);
  return answer && answer.key === key ? answer.shapes : NO_SHAPES;
}

const NO_SHAPES: ReadonlyMap<string, ZoneShape["geometry"]> = new Map();

/** GeoJSON for the zones (drawn ones from their corners, the rest from their loaded outlines) and the draft. */
export function drawnFeatures(zones: MatchZone[] | undefined, draft: [number, number][] | null,
  shapes: ReadonlyMap<string, ZoneShape["geometry"]> = NO_SHAPES) {
  const ring = (points: [number, number][]) => points.map(([lat, lon]) => [lon, lat]);
  const features: { type: "Feature"; properties: { kind: string }; geometry: { type: string; coordinates: unknown } }[] = [];
  for (const zone of zones ?? []) {
    if (zone.kind !== "polygon") {
      const shape = shapes.get(zoneKey(zone));
      if (shape) features.push({ type: "Feature", properties: { kind: "zone" }, geometry: shape });
      continue;
    }
    const closed = ring([...zone.points, zone.points[0]]);
    features.push({ type: "Feature", properties: { kind: "zone" }, geometry: { type: "Polygon", coordinates: [closed] } });
  }
  if (draft?.length) {
    // Three corners make an area: it fills as you go.
    if (draft.length > 2) {
      features.push({ type: "Feature", properties: { kind: "draft-area" },
        geometry: { type: "Polygon", coordinates: [ring([...draft, draft[0]])] } });
    }
    if (draft.length > 1) {
      features.push({ type: "Feature", properties: { kind: "draft" },
        geometry: { type: "LineString", coordinates: ring(draft.length > 2 ? [...draft, draft[0]] : draft) } });
    }
    for (const corner of ring(draft)) {
      features.push({ type: "Feature", properties: { kind: "corner" }, geometry: { type: "Point", coordinates: corner } });
    }
  }
  return { type: "FeatureCollection" as const, features } as GeoJSON.FeatureCollection;
}

/** Five decimals (about a metre): enough for a hand-drawn corner, and short in a shared link. */
function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
