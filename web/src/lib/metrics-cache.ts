/** Browser caching for the metric catalogue (app/api/v1/metrics): one ETag per release. */

export function catalogueEtag(releaseId: string | null | undefined): string | null {
  return releaseId && /^[\w.:-]{1,100}$/.test(releaseId) ? `"metrics-${releaseId}"` : null;
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").map((entry) => entry.trim().replace(/^W\//, "")).some((entry) => entry === etag || entry === "*");
}

/** Ten minutes fresh, then served stale while the browser revalidates in the background (a new release shows on the next load). */
export function catalogueCacheHeaders(etag: string): Record<string, string> {
  return { etag, "cache-control": "public, max-age=600, stale-while-revalidate=86400" };
}
