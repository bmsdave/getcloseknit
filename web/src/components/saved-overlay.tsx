"use client";

import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { knownAreaBox } from "@/lib/area-boxes";
import type { GeographyId } from "@/lib/contracts";
import { registerPickMarker } from "@/lib/map-pick";
import { useSaved } from "@/lib/saved-items";

import { SaveHeart } from "./area-save-actions";
import "../styles/saved-panel.css";

/** The middle of an area's box once the map has loaded it (lib/area-boxes.ts), or null while it has not. */
function areaPoint(id: GeographyId): [number, number] | null {
  const box = knownAreaBox(id);
  return box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
}

// A saved home keeps its UPRN only: where it stands comes from its property record, once per visit.
const homePoints = new Map<string, Promise<[number, number] | null>>();
function homePoint(uprn: string): Promise<[number, number] | null> {
  let point = homePoints.get(uprn);
  if (!point) {
    point = fetch(`/api/v1/properties/${encodeURIComponent(uprn)}`, { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { property?: { location?: [number, number] } } | null) => payload?.property?.location ?? null)
      .catch(() => null);
    homePoints.set(uprn, point);
  }
  return point;
}

/**
 * Saved › On map: every saved thing as a ♡ on the map: homes, schools and places where they are,
 * areas at the middle of their outline (once the map has loaded it). Each ♡ is on the map's one
 * hit-test (lib/map-pick.ts): a hover peeks its name; a tap on a home opens the home's card, on an area
 * selects it; a school's or a place's ♡ only peeks (its cap or badge under it takes the tap).
 */
export function SavedOverlay({ map }: { map: MapLibreMap | null }) {
  const saved = useSaved();
  useEffect(() => {
    if (!map) return;
    let live = true;
    const markers = new Map<string, maplibregl.Marker>();
    const heart = renderToStaticMarkup(<SaveHeart filled size={16} />);
    const pin = (key: string, name: string, at: [number, number], properties: Record<string, unknown>) => {
      if (markers.has(key)) return;
      const element = document.createElement("div");
      element.className = "saved-pin";
      element.dataset.testid = "saved-pin";
      element.dataset.saved = key;
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `Saved: ${name}`);
      element.innerHTML = heart;
      registerPickMarker(map, { kind: "saved", element, lngLat: at, properties: { ...properties, lines: [name, "Saved"] } });
      markers.set(key, new maplibregl.Marker({ element }).setLngLat(at).addTo(map));
    };
    for (const item of saved.items) if (item.at) pin(`${item.kind}:${item.id}`, item.name, item.at, { peekOnly: true });
    for (const home of saved.homes) {
      const uprn = home.uprn;
      if (uprn) void homePoint(uprn).then((at) => { if (live && at) pin(`home:${home.id}`, home.name, at, { uprn }); });
    }
    const placeAreas = () => {
      for (const area of saved.areas) {
        if (markers.has(area.geographyId)) continue;
        const at = areaPoint(area.geographyId);
        if (at) pin(area.geographyId, area.name, at, { geographyId: area.geographyId });
      }
    };
    placeAreas();
    // Boxes load with the map's pieces and as it moves: place the rest when they arrive.
    map.on("idle", placeAreas);
    return () => {
      live = false;
      map.off("idle", placeAreas);
      markers.forEach((marker) => marker.remove());
    };
  }, [map, saved]);
  return null;
}
