import type { GeographyId } from "./contracts";
import { connectivity, LIFESTYLE_AMENITY_GROUPS, type AmenityGroupSummary, type AreaPlacesResponse, type NearbyPark, type NearbyStation, type PlaceLine } from "./places";

/**
 * Demo places for the three preview areas (keyed by the shared code suffix,
 * as getAreaSummary does). Illustrative only: release ids start "preview-" so
 * real mode rejects them (readAreaPlaces).
 */
const RELEASE = "preview-places-2026";
const line = (id: string, name: string, mode: PlaceLine["mode"]): PlaceLine => ({ id, name, mode });
const JUBILEE = line("jubilee", "Jubilee", "tube");
const DISTRICT = line("district", "District", "tube");
const CIRCLE = line("circle", "Circle", "tube");
const NORTHERN = line("northern", "Northern", "tube");
const BAKERLOO = line("bakerloo", "Bakerloo", "tube");
const VICTORIA = line("victoria", "Victoria", "tube");

interface PreviewPlaces { stations: NearbyStation[]; parks: NearbyPark[]; amenities: AmenityGroupSummary[] }

/** Lifestyle counts (gyms, pools, cafes, bars) back Tailor's count tiles; they list no nearest places. */
const amenities = (counts: [number, number, number, number, number], nearest: string[][],
  lifestyle: [number, number, number, number]): AmenityGroupSummary[] => [
  ...(["groceries", "pubs", "food", "pharmacies", "gps"] as const).map((group, index) => ({
    group,
    countWithinWalk: counts[index],
    nearest: (nearest[index] ?? []).map((entry, rank) => {
      const [name, kind] = entry.split("|");
      return { name: name || null, kind, distanceMetres: 140 + rank * 170 + index * 30 };
    }),
  })),
  ...LIFESTYLE_AMENITY_GROUPS.map((group, index) => ({ group, countWithinWalk: lifestyle[index], nearest: [] })),
];

const PREVIEW: Record<string, PreviewPlaces> = {
  "000001": {
    stations: [
      { name: "Westminster", modes: ["tube"], zone: "1", lines: [CIRCLE, DISTRICT, JUBILEE], distanceMetres: 380 },
      { name: "St James's Park", modes: ["tube"], zone: "1", lines: [CIRCLE, DISTRICT], distanceMetres: 520 },
      { name: "Charing Cross", modes: ["tube", "national-rail"], zone: "1",
        lines: [BAKERLOO, NORTHERN, line("southeastern", "Southeastern", "national-rail")], distanceMetres: 940 },
      { name: "Victoria", modes: ["tube", "national-rail"], zone: "1",
        lines: [CIRCLE, DISTRICT, VICTORIA, line("southern", "Southern", "national-rail")], distanceMetres: 1350 },
    ],
    parks: [
      { name: "St James's Park", kind: "park", areaHectares: 23.1, sizeClass: "district", distanceMetres: 150 },
      { name: "Victoria Tower Gardens", kind: "park", areaHectares: 1.9, sizeClass: "small", distanceMetres: 610 },
      { name: "Green Park", kind: "park", areaHectares: 16.2, sizeClass: "local", distanceMetres: 820 },
    ],
    amenities: amenities([6, 14, 38, 2, 1], [
      ["Preview Local|convenience", "Preview Market|supermarket"],
      ["The Preview Arms|pub", "Lobby Bar|bar"],
      ["Corner Café|cafe", "Preview Kitchen|restaurant"],
      ["Preview Pharmacy|pharmacy", "|pharmacy"],
      ["Preview Medical Centre|gp"],
    ], [13, 1, 24, 9]),
  },
  "000002": {
    stations: [
      { name: "Highbury & Islington", modes: ["tube", "overground", "national-rail"], zone: "2",
        lines: [VICTORIA, line("mildmay", "Mildmay", "overground"), line("windrush", "Windrush", "overground"),
          line("great-northern", "Great Northern", "national-rail")], distanceMetres: 640 },
      { name: "Canonbury", modes: ["overground"], zone: "2", lines: [line("mildmay", "Mildmay", "overground")], distanceMetres: 1110 },
    ],
    parks: [
      { name: "Highbury Fields", kind: "park", areaHectares: 11.8, sizeClass: "local", distanceMetres: 260 },
      { name: "Preview Pocket Garden", kind: "garden", areaHectares: 0.2, sizeClass: "pocket", distanceMetres: 90 },
    ],
    amenities: amenities([4, 6, 19, 2, 2], [
      ["Preview Express|convenience", "Preview Superstore|supermarket"],
      ["The Preview Tavern|pub"],
      ["Preview Bakery|cafe", "Preview Bistro|restaurant"],
      ["North Preview Chemist|pharmacy"],
      ["Preview Health Centre|gp", "Preview Surgery|gp"],
    ], [3, 1, 11, 4]),
  },
  "000003": {
    stations: [
      { name: "Waterloo", modes: ["tube", "national-rail"], zone: "1",
        lines: [BAKERLOO, NORTHERN, JUBILEE, line("waterloo-city", "Waterloo & City", "tube"),
          line("south-western-railway", "South Western Railway", "national-rail")], distanceMetres: 450 },
      { name: "Lambeth North", modes: ["tube"], zone: "1", lines: [BAKERLOO], distanceMetres: 780 },
    ],
    parks: [
      { name: "Jubilee Gardens", kind: "park", areaHectares: 1.4, sizeClass: "small", distanceMetres: 330 },
      { name: "Archbishop's Park", kind: "park", areaHectares: 3.8, sizeClass: "local", distanceMetres: 870 },
    ],
    amenities: amenities([5, 9, 41, 1, 0], [
      ["South Bank Local|convenience"],
      ["The Preview Wharf|pub"],
      ["River Café Preview|cafe", "Preview Grill|restaurant"],
      ["Preview Pharmacy South|pharmacy"],
      [],
    ], [5, 0, 16, 7]),
  },
};

export function fixtureAreaPlaces(id: GeographyId, uprn: string | null): AreaPlacesResponse | null {
  const preview = PREVIEW[id.slice(-6)];
  if (!preview) return null;
  return {
    schemaVersion: "area-places.v1",
    productReleaseId: RELEASE,
    geographyId: id,
    origin: { kind: uprn ? "home" : "area-centre", uprn },
    available: true,
    stations: preview.stations,
    parks: preview.parks,
    walkRadiusMetres: 800,
    amenities: preview.amenities,
    connectivity: connectivity(preview.stations),
    sources: [{ id: RELEASE, licence: "demo", attribution: "Demo places for the preview areas, not real data." }],
    caveats: ["Demo data: made-up places that show how this section works."],
  };
}
