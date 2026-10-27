import { NextResponse } from "next/server";

import { evidenceServiceUrl } from "@/lib/evidence-service";
import { previewBuildings } from "@/lib/fixtures";
import { BUILDING_EXTRUSION_OPACITY } from "@/lib/map-basemap-theme";

// The deterministic test style (fixture buildings) serves local demo runs only; a real deployment has no such
// style. The areas are the map's own, from tiles (lib/area-tiles.ts), as on every basemap.
export function GET() {
  if (evidenceServiceUrl()) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({
    version: 8,
    name: "Close Knit deterministic test style",
    sources: {
      "area-buildings": { type: "geojson", data: previewBuildings() },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#e9e7df" } },
      {
        id: "neutral-3d-buildings", type: "fill-extrusion", source: "area-buildings",
        paint: {
          "fill-extrusion-color": "#c9c5ba",
          "fill-extrusion-height": ["get", "render_height"],
          "fill-extrusion-base": ["get", "render_min_height"],
          "fill-extrusion-opacity": BUILDING_EXTRUSION_OPACITY,
        },
      },
    ],
  });
}
