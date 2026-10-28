/**
 * Why an area has no value for a measure: the API's `coverage` (api/area_api/coverage.py) on a tile, recent sales or
 * homes near a point. "london-only": the source reaches London alone (TfL, the LAEI grid, per-home data; FLAGS.md
 * CLOSE_KNIT_ENGLAND) and the area is elsewhere. The page then says "London only" (DESIGN.md §6), never "0 km",
 * "No data here" or "none".
 */
export type CoverageReason = "london-only";

export const LONDON_ONLY: CoverageReason = "london-only";

/** What the layer list, a tile or a block says on data whose coverage is London alone. */
export const LONDON_ONLY_LABEL = "London only";

/** "London only", or "Individual homes: London only" for a block. */
export function londonOnlyWords(what?: string): string {
  return what ? `${what}: ${LONDON_ONLY_LABEL}` : LONDON_ONLY_LABEL;
}

/** Whether an area of `regionCode` lies outside London's data (null: unknown, so London's words stay). */
export function outsideLondon(regionCode: string | null | undefined): boolean {
  return !!regionCode && regionCode !== "E12000007";
}
