// Geograph photos near a point, from our own copy of Geograph's photo list
// (API /api/v1/photos/nearby, migration 043). Titles and credits only:
// Geograph asks that its images are not hotlinked without permission, so each
// photo is a credited link to its Geograph page (CC BY-SA 2.0).

import { fetchEvidence } from "./evidence-service";

export interface GeographLink {
  id: string;
  title: string;
  photographer: string;
  /** The photo's page on Geograph: the credit link. */
  pageUrl: string;
  metres: number;
}

export interface GeographLinks {
  links: GeographLink[];
  licenceUrl: string;
}

const PAGE_URL = /^https:\/\/www\.geograph\.org\.uk\/photo\/\d+$/;
const LICENCE_URL = "https://creativecommons.org/licenses/by-sa/2.0/";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Validates a nearby-photos.v1 payload, skipping photos already shown as Commons images. */
export function parseGeographLinks(payload: unknown, skip: ReadonlySet<string>, limit: number): GeographLink[] {
  const photos = (payload as { photos?: unknown } | null)?.photos;
  if (!Array.isArray(photos)) return [];
  const links: GeographLink[] = [];
  for (const item of photos) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const title = text(row.title);
    const photographer = text(row.photographer);
    const pageUrl = text(row.pageUrl);
    const metres = Number(row.metres);
    if (!id || !title || !photographer || !pageUrl || !PAGE_URL.test(pageUrl) || !Number.isFinite(metres)) continue;
    if (skip.has(id)) continue;
    links.push({ id, title, photographer, pageUrl, metres });
    if (links.length === limit) break;
  }
  return links;
}

/** The nearest Geograph photos as links; [] when the API is unavailable or has no photo table yet. */
export async function nearbyGeographLinks(
  latitude: number,
  longitude: number,
  skip: ReadonlySet<string>,
  limit = 4,
): Promise<GeographLinks> {
  const query = new URLSearchParams({ lat: latitude.toFixed(5), lon: longitude.toFixed(5), limit: String(limit + skip.size) });
  try {
    const upstream = await fetchEvidence<unknown>(`/api/v1/photos/nearby?${query}`, AbortSignal.timeout(2500));
    if (upstream.status !== 200) return { links: [], licenceUrl: LICENCE_URL };
    return { links: parseGeographLinks(upstream.body, skip, limit), licenceUrl: LICENCE_URL };
  } catch {
    return { links: [], licenceUrl: LICENCE_URL };
  }
}
