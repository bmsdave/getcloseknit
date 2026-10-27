"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";

import type { MiniMapStatus } from "@/components/home-mini-map-canvas";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { PRICE_METRIC_ID } from "@/lib/price-scale";
import { HOME_MAP_LAYERS, homeMapHref, mapLinks, type HomeMapLayer } from "@/lib/property-profile";

// MapLibre loads after the page has painted, and never on the server.
const MiniMapCanvas = dynamic(() => import("./home-mini-map-canvas").then((loaded) => loaded.MiniMapCanvas), { ssr: false });

/**
 * The home page's header map: the home's area on the main map's layers (Price, Crime,
 * Deprivation, Income, Social housing), a pin on the home, and the outbound Google Maps and
 * Street View links. `data-href` is where a click goes (the main map, this area, this layer);
 * `data-state` says whether the layer painted.
 */
export function HomeMiniMap({ point, geographyId, mode, release }: {
  /** The home, or null when only its area is known (the map centres on the area, with no pin). */
  point: { lat: number; lon: number } | null;
  geographyId: GeographyId | null;
  mode: DataMode;
  release: string;
}) {
  const [layer, setLayer] = useState<HomeMapLayer>(PRICE_METRIC_ID);
  const [status, setStatus] = useState<MiniMapStatus>("loading");
  // No point of its own (a street without one): the outbound links use the area's centre once its shape loads.
  const [areaCentre, setAreaCentre] = useState<{ lat: number; lon: number } | null>(null);
  const id = useId();
  const linked = point ?? areaCentre;
  const links = linked ? mapLinks(linked) : null;
  const href = geographyId ? homeMapHref(geographyId, layer) : null;
  return (
    <figure className="home-mini-map" data-testid="home-mini-map" data-state={status} data-href={href ?? undefined}>
      <div className="home-mini-map__frame">
        <MiniMapCanvas point={point} geographyId={geographyId} layer={layer} mode={mode} release={release}
          onStatus={setStatus} onAreaCentre={setAreaCentre} />
        {status === "unavailable" && <p className="home-mini-map__note">Map unavailable</p>}
        {status === "no-data" && <p className="home-mini-map__note">No map for this layer</p>}
        {/* The map's click, for keyboards: over the frame, so it adds no height. */}
        {href && <a className="home-mini-map__open" href={href} data-testid="home-mini-map-open">Open this layer on the map</a>}
      </div>
      <figcaption className="home-mini-map__bar">
        <label className="sr-only" htmlFor={id}>Map layer</label>
        <select id={id} className="knit-field home-mini-map__layer" value={layer}
          onChange={(event) => setLayer(event.target.value as HomeMapLayer)}>
          {HOME_MAP_LAYERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        {links ? (
          <span className="home-mini-map__links">
            <a href={links.maps} target="_blank" rel="noopener noreferrer" data-testid="google-maps-link">Google Maps ↗</a>
            <a href={links.streetView} target="_blank" rel="noopener noreferrer" data-testid="street-view-link">Street View ↗</a>
          </span>
        ) : <span className="home-mini-map__links-note" data-testid="map-links-note">Map links need a street point</span>}
      </figcaption>
    </figure>
  );
}
