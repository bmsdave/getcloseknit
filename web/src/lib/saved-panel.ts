import type { CompareKind } from "./compare-table";
import type { SavedItemKind } from "./saved-items";

/** /?saved=1: the map opened on the Saved panel (the ♡ off the map). */
export const SAVED_PARAM = "saved";
export const SAVED_HREF = `/?${SAVED_PARAM}=1`;

export function wantsSaved(search: string): boolean {
  return new URLSearchParams(search).has(SAVED_PARAM);
}

export type SavedBlockId = "areas" | "homes" | "schools" | "places";
export type SavedFilter = "all" | SavedBlockId;

export interface SavedBlock {
  id: SavedBlockId;
  label: string;
  /** The saved item kind behind the block (areas live in the shortlists, homes in the user candidates). */
  kind: SavedItemKind | null;
  /** What "Compare" on the block's heading compares; cafés and gyms are never compared. */
  compare: CompareKind | null;
}

export const SAVED_BLOCKS: readonly SavedBlock[] = [
  { id: "areas", label: "Areas", kind: null, compare: "places" },
  { id: "homes", label: "Homes", kind: null, compare: "homes" },
  { id: "schools", label: "Schools", kind: "school", compare: "schools" },
  { id: "places", label: "Places", kind: "place", compare: null },
];

/**
 * A saved area's second line: "Borough" for a borough, and its £/m² once known (CUJ14 v4: "£8,900/m²"): the area
 * view's Price tile words as they are (one series, so Saved and Compare never differ).
 */
/** How many saved areas Saved ticks for you when none is ticked yet (CUJ14 v4: ♡ → Compare 2). */
export const PRE_TICKED_AREAS = 2;

/**
 * The saved areas Saved opens with ticked (CUJ03/CUJ14 boards): the best two by My match score when there is
 * a search, else the newest two (the rows' order). Areas without a score keep their order after the scored ones.
 */
export function preTickedAreas(ids: readonly string[], scores: Readonly<Record<string, number | null>> = {}): string[] {
  if (ids.length < PRE_TICKED_AREAS) return [];
  const score = (id: string) => scores[id] ?? -1;
  return ids.map((id, index) => ({ id, index }))
    .sort((a, b) => score(b.id) - score(a.id) || a.index - b.index)
    .slice(0, PRE_TICKED_AREAS).map((entry) => entry.id);
}

export function savedAreaMeta(geographyId: string, price: string | undefined): string | undefined {
  const parts = [geographyId.startsWith("uk:lad:") ? "Borough" : null, price ?? null];
  return parts.filter(Boolean).join(" · ") || undefined;
}
