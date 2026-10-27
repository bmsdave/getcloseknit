"use client";

import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";

import type { PreferenceProfile } from "@/lib/contracts";
import { registerPickMarker } from "@/lib/map-pick";
import { myPlacePinMarkup } from "@/lib/place-yarn";

/**
 * Show › My places: the household's pinned places (work, school, gym, family) on any layer, each an
 * ink pin with its type's glyph and its name, as My match draws them. My match draws its own, so this
 * is used only while another layer colours the map. A tap opens the place's card (the map's one hit-test).
 */
export function MyPlacesOverlay({ map, profile }: { map: MapLibreMap | null; profile: PreferenceProfile }) {
  useEffect(() => {
    if (!map) return;
    const markers = (profile.places ?? []).flatMap((place) => {
      if (place.target.kind !== "point") return [];
      const at: [number, number] = [place.target.longitude, place.target.latitude];
      const element = document.createElement("div");
      element.className = "knit-place";
      element.dataset.testid = "my-place-pin";
      element.innerHTML = myPlacePinMarkup(place.label);
      const name = document.createElement("span");
      name.className = "knit-place-label";
      name.textContent = place.label;
      element.append(name);
      registerPickMarker(map, { kind: "my-place", element, lngLat: at, properties: { placeId: place.id, name: place.label, lines: [place.label] } });
      return [new maplibregl.Marker({ element }).setLngLat(at).addTo(map)];
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [map, profile.places]);
  return null;
}
