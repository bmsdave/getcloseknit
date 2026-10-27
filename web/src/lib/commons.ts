// Photos near a point from Wikimedia Commons. Commons allows embedding its
// images, so thumbnails load from Wikimedia's servers; each is credited with
// its own author and licence, and only CC BY, CC BY-SA, CC0 and public-domain
// photos pass. Many are Geograph photos copied to Commons with their credit.

export interface CommonsPhoto {
  id: string;
  title: string;
  /** Plain text; null only for public-domain or CC0 photos with no named author. */
  author: string | null;
  /** The file's Commons page: the credit link. */
  pageUrl: string;
  imageUrl: string;
  width: number;
  height: number;
  licence: string;
  licenceUrl: string | null;
  /** The Geograph photo id when the file is a Geograph copy, so the Geograph links can skip it. */
  geographId: string | null;
}

const API_URL = "https://commons.wikimedia.org/w/api.php";
// Wikimedia's API policy asks for a User-Agent naming the tool and a way to reach it.
const USER_AGENT = "CloseKnit/1.0 (https://getcloseknit.com)";
const IMAGE_HOST = /^https:\/\/(?:thumb|upload)\.wikimedia\.org\//;
const PAGE_HOST = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/;
const FREE_LICENCE = /^(?:CC BY(?:-SA)? \d\.\d|CC0(?: 1\.0)?|Public domain)$/i;
const NO_AUTHOR_NEEDED = /^(?:CC0|Public domain)/i;
const RADIUS_METRES = 500;
/** Photos change slowly: one Commons call per point a week. */
const REVALIDATE_SECONDS = 7 * 24 * 60 * 60;

type Metadata = Record<string, { value?: unknown } | undefined>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Commons' Artist field is HTML ("<a href=…>Cjc13</a>"): the text people read, nothing else. */
export function plainText(html: string | null): string | null {
  if (!html) return null;
  const decoded = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return decoded.length > 0 ? decoded.slice(0, 120) : null;
}

/**
 * "File:Hackney Town Hall - geograph.org.uk - 4914.jpg" → "Hackney Town Hall";
 * "Flickr - Duncan~ - Hackney Town Hall" → "Hackney Town Hall"; "Hackney Empire (3080219246)" → "Hackney Empire".
 */
export function tidyTitle(title: string): string {
  return title
    .replace(/^File:/, "")
    .replace(/\.(?:jpe?g|png|tiff?|webp)$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+-\s+geograph\.org\.uk\s+-\s+\d+$/i, "")
    .replace(/^Flickr\s+-\s+.+?\s+-\s+/i, "")
    .replace(/\s+\(\d{6,}\)$/, "")
    .trim();
}

function geographId(title: string): string | null {
  return /geograph\.org\.uk\s+-\s+(\d+)(?:\.\w+)?$/i.exec(title)?.[1] ?? null;
}

/** Validates a geosearch + imageinfo response: free-licence JPEG photos with a credit, nearest first, one per title. */
export function parseCommonsPhotos(payload: unknown, limit: number): CommonsPhoto[] {
  const pages = (payload as { query?: { pages?: unknown } } | null)?.query?.pages;
  if (!Array.isArray(pages)) return [];
  const ordered = pages
    .filter((page): page is Record<string, unknown> => !!page && typeof page === "object")
    .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  const photos: CommonsPhoto[] = [];
  const titles = new Set<string>();
  for (const page of ordered) {
    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] as Record<string, unknown> | undefined : undefined;
    const title = text(page.title);
    if (!info || !title || info.mime !== "image/jpeg") continue;
    const metadata = (info.extmetadata ?? {}) as Metadata;
    const licence = text(metadata.LicenseShortName?.value);
    const author = plainText(text(metadata.Artist?.value));
    const imageUrl = text(info.thumburl)?.split("?")[0] ?? null;
    const pageUrl = text(info.descriptionurl);
    const width = Number(info.thumbwidth);
    const height = Number(info.thumbheight);
    if (!licence || !FREE_LICENCE.test(licence) || (!author && !NO_AUTHOR_NEEDED.test(licence))) continue;
    if (!imageUrl || !IMAGE_HOST.test(imageUrl) || !pageUrl || !PAGE_HOST.test(pageUrl)) continue;
    if (!(width > 0 && height > 0)) continue;
    const licenceUrl = text(metadata.LicenseUrl?.value);
    // Three photos of the town hall say less than the town hall, a street and a park.
    const tidy = tidyTitle(plainText(text(metadata.ObjectName?.value)) ?? title);
    if (titles.has(tidy.toLowerCase())) continue;
    titles.add(tidy.toLowerCase());
    photos.push({
      id: String(page.pageid ?? title),
      title: tidy,
      author, pageUrl, imageUrl, width, height, licence,
      licenceUrl: licenceUrl?.startsWith("https://") ? licenceUrl : null,
      geographId: geographId(title),
    });
    if (photos.length === limit) break;
  }
  return photos;
}

/** The nearest Commons photos to a point, nearest first; [] when Commons is slow or down. */
export async function nearbyCommonsPhotos(
  latitude: number,
  longitude: number,
  limit = 4,
  fetchImpl: typeof fetch = fetch,
): Promise<CommonsPhoto[]> {
  // About 100 m of rounding: neighbouring postcodes share one cached call.
  const query = new URLSearchParams({
    action: "query", format: "json", formatversion: "2",
    generator: "geosearch", ggscoord: `${latitude.toFixed(3)}|${longitude.toFixed(3)}`,
    ggsradius: String(RADIUS_METRES), ggsnamespace: "6", ggslimit: "20",
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "320",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|ObjectName",
  });
  try {
    const response = await fetchImpl(`${API_URL}?${query}`, {
      signal: AbortSignal.timeout(2500),
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) return [];
    return parseCommonsPhotos(await response.json(), limit);
  } catch {
    return [];
  }
}
