import type { FeatureCollection, Point } from "geojson";

import { friendlyTitle, type FriendlyAreaFields } from "./area-labels";
import type { AreaLabelProperties } from "./map-area-labels";

// Demo mode only: made-up but plausible friendly names for the three preview
// areas, and label points that sit inside the preview polygons.
const DEMO_FRIENDLY: Record<string, FriendlyAreaFields> = {
  "uk:lsoa:E01000001": { friendlyName: "St James's", postcodeDistrict: "SW1A" },
  "uk:msoa:E02000001": { friendlyName: "St James's", postcodeDistrict: "SW1A" },
  "uk:lad:E09000001": { friendlyName: "Westminster", postcodeDistrict: null },
  "uk:lsoa:E01000002": { friendlyName: "Highbury", postcodeDistrict: "N5" },
  "uk:msoa:E02000002": { friendlyName: "Highbury", postcodeDistrict: "N5" },
  "uk:lad:E09000002": { friendlyName: "Islington", postcodeDistrict: null },
  "uk:lsoa:E01000003": { friendlyName: "Bankside", postcodeDistrict: "SE1" },
  "uk:msoa:E02000003": { friendlyName: "Bankside", postcodeDistrict: "SE1" },
  "uk:lad:E09000003": { friendlyName: "Southwark", postcodeDistrict: null },
};

export function demoFriendlyFields(geographyId: string): Required<FriendlyAreaFields> {
  const fields = DEMO_FRIENDLY[geographyId];
  return { friendlyName: fields?.friendlyName ?? null, postcodeDistrict: fields?.postcodeDistrict ?? null, displayName: friendlyTitle(fields) };
}

const LABELS: Array<[AreaLabelProperties["kind"], string, string, string | null, [number, number]]> = [
  ["borough", "E09000001", "Westminster", "Westminster", [-0.152, 51.507]],
  ["borough", "E09000002", "Islington", "Islington", [-0.094, 51.556]],
  ["borough", "E09000003", "Southwark", "Southwark", [-0.05, 51.507]],
  ["district", "SW1A", "SW1A · St James's", "St James's", [-0.137, 51.503]],
  ["district", "W1J", "W1J · Mayfair", "Mayfair", [-0.148, 51.516]],
  ["district", "SW1P", "SW1P · Westminster", "Westminster", [-0.13, 51.495]],
  ["district", "N5", "N5 · Highbury", "Highbury", [-0.098, 51.553]],
  ["district", "N1", "N1 · Angel", "Angel", [-0.106, 51.534]],
  ["district", "SE1", "SE1 · Bankside", "Bankside", [-0.097, 51.502]],
  ["district", "SE16", "SE16 · Rotherhithe", "Rotherhithe", [-0.05, 51.507]],
];

export function demoMapLabels(): FeatureCollection<Point, AreaLabelProperties> {
  return {
    type: "FeatureCollection",
    features: LABELS.map(([kind, code, label, name, coordinates], rank) => ({
      type: "Feature",
      properties: { kind, code, label, name, rank },
      geometry: { type: "Point", coordinates },
    })),
  };
}
