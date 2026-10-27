/**
 * Student areas' points (Layers v5 PR 3): universities and colleges from OpenStreetMap (amenity university or
 * college, GET /api/v1/universities/points), drawn from street zoom while Student areas colours the map, so
 * the share of students reads next to where they study. A small dot with its name from zoom 15; nothing else.
 * Pure definitions so the layers and the loader are unit-testable.
 */
import type { CircleLayerSpecification, GeoJSONSourceSpecification, SymbolLayerSpecification } from "maplibre-gl";

import { withRelease } from "./release-url";

export const UNIVERSITY_LAYER_ID = "student-share";
export const UNIVERSITY_SOURCE_ID = "universities";
export const UNIVERSITY_DOT_LAYER = "university-dots";
export const UNIVERSITY_LABEL_LAYER = "university-labels";
export const UNIVERSITY_LAYERS = [UNIVERSITY_DOT_LAYER, UNIVERSITY_LABEL_LAYER] as const;
export const UNIVERSITY_MIN_ZOOM = 13;
export const UNIVERSITY_LABEL_ZOOM = 15;
export const UNIVERSITY_ATTRIBUTION = "© OpenStreetMap contributors";

export interface UniversityPoint {
  id: string;
  name: string;
  kind: "university" | "college";
  latitude: number;
  longitude: number;
}

export interface UniversityPointsResponse {
  schemaVersion: "university-points.v1";
  productReleaseId?: string;
  points: UniversityPoint[];
}

/** Whether the map should draw the points: only under Student areas. */
export function showsUniversities(layer: string): boolean {
  return layer === UNIVERSITY_LAYER_ID;
}

export function universityPointsPath(release: string | null | undefined): string {
  return withRelease("/api/v1/universities/points", release);
}

export function universitySource(points: readonly UniversityPoint[]): GeoJSONSourceSpecification {
  return {
    type: "geojson",
    attribution: UNIVERSITY_ATTRIBUTION,
    data: {
      type: "FeatureCollection",
      features: points.map((point) => ({
        type: "Feature",
        id: point.id,
        geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
        properties: { name: point.name, kind: point.kind },
      })),
    },
  };
}

/** A white-ringed ink dot (universities a size larger than colleges) and the name under it from zoom 15. */
export function universityLayers(): [CircleLayerSpecification, SymbolLayerSpecification] {
  return [
    {
      id: UNIVERSITY_DOT_LAYER, type: "circle", source: UNIVERSITY_SOURCE_ID, minzoom: UNIVERSITY_MIN_ZOOM,
      paint: {
        "circle-radius": ["case", ["==", ["get", "kind"], "university"], 5, 3.5],
        "circle-color": "#253494",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: UNIVERSITY_LABEL_LAYER, type: "symbol", source: UNIVERSITY_SOURCE_ID, minzoom: UNIVERSITY_LABEL_ZOOM,
      layout: {
        "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 0.9], "text-anchor": "top",
        "text-max-width": 10, "text-optional": true,
      },
      paint: { "text-color": "#253494", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
    },
  ];
}

const loads = new Map<string, Promise<UniversityPoint[] | null>>();

/** The points once per path (the release is in it); a failed load is tried again next time. */
export function loadUniversityPoints(path: string): Promise<UniversityPoint[] | null> {
  let load = loads.get(path);
  if (!load) {
    load = fetch(path)
      .then((response) => (response.ok ? response.json() as Promise<UniversityPointsResponse> : null))
      .then((payload) => payload?.points ?? null)
      .catch(() => null);
    load.then((points) => { if (!points) loads.delete(path); }).catch(() => undefined);
    loads.set(path, load);
  }
  return load;
}
