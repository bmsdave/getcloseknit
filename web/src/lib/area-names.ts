/**
 * Area names resolved when a link is read. Shared shortlists and saved areas carry the
 * name they were written with, and older links wrote official codes ("Haringey 019A"); reading one asks
 * GET /api/v1/areas/names for today's names, so a link already sent shows the area's name too.
 */
import { friendlyTitle, isCodeName, type FriendlyAreaFields } from "./area-labels";

export const AREA_NAMES_MAX_IDS = 50;

export interface AreaNamesResponse {
  schemaVersion: "area-names.v1";
  productReleaseId?: string;
  /** Each known id's name to show; unknown ids are left out. */
  names: Record<string, string>;
}

/** Demo mode: the fixtures' friendly titles (the API's display name rule). */
export function demoAreaNames(ids: readonly string[], friendly: (id: string) => FriendlyAreaFields): AreaNamesResponse {
  const names: Record<string, string> = {};
  for (const id of ids) {
    const title = friendlyTitle(friendly(id));
    if (title) names[id] = title;
  }
  return { schemaVersion: "area-names.v1", names };
}

/** The ids whose stored name is a code or missing: only these are worth a request. */
export function idsToResolve(names: Record<string, string>, ids: readonly string[]): string[] {
  return ids.filter((id) => isCodeName(names[id], id)).slice(0, AREA_NAMES_MAX_IDS);
}

/** Today's names for these ids; {} on any failure (the stored names then stay). */
export async function fetchAreaNames(
  ids: readonly string[], fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  try {
    const response = await fetcher(`/api/v1/areas/names?ids=${encodeURIComponent(ids.join(","))}`, {
      signal, headers: { accept: "application/json" },
    });
    if (!response.ok) return {};
    const body = await response.json() as Partial<AreaNamesResponse>;
    return body?.schemaVersion === "area-names.v1" && body.names && typeof body.names === "object" ? body.names : {};
  } catch {
    return {};
  }
}

/** Stored names with resolved ones laid over them (a resolved name always wins over a code). */
export function mergeNames(stored: Record<string, string>, resolved: Record<string, string>): Record<string, string> {
  return { ...stored, ...Object.fromEntries(Object.entries(resolved).filter(([, name]) => name.trim() !== "")) };
}
