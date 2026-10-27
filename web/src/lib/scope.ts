/**
 * The places the API serves this site (GET /api/v1/scope, api/area_api/scope.py): London, or England behind
 * CLOSE_KNIT_ENGLAND (FLAGS.md). The layout reads it once per request (lib/deployment.ts serverScope) and hands it
 * to the page through components/scope-context.tsx; words built outside React read the last one published here.
 */
export interface ServedScope {
  schemaVersion: "scope.v1";
  id: string;
  level: "region" | "nation";
  name: string;
  served: { id: string; code: string; name: string }[];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  outsideReason: "outside-london" | "outside-coverage";
}

/** Demo data's scope, and the words' until the page's scope is known (on the server, before hydration). */
export const LONDON_SCOPE: ServedScope = {
  schemaVersion: "scope.v1", id: "uk:region:E12000007", level: "region", name: "London",
  served: [{ id: "uk:region:E12000007", code: "E12000007", name: "London" }],
  bbox: [-0.6, 51.2, 0.4, 51.8], outsideReason: "outside-london",
};

export function isScope(body: unknown): body is ServedScope {
  const value = body as Partial<ServedScope> | null;
  return !!value && value.schemaVersion === "scope.v1" && (value.level === "region" || value.level === "nation")
    && typeof value.name === "string" && Array.isArray(value.served) && Array.isArray(value.bbox);
}

/** The scope is all of England (CLOSE_KNIT_ENGLAND on). */
export function coversEngland(scope: ServedScope): boolean {
  return scope.level === "nation";
}

/** The scope from the site's /api/v1/scope (app/api/v1/scope/route.ts), for a page the server could not tell. */
export async function fetchScope(fetchImpl: typeof fetch = fetch): Promise<ServedScope> {
  const response = await fetchImpl("/api/v1/scope");
  const body = response.ok ? await response.json() as unknown : null;
  if (!isScope(body)) throw new Error(`scope unavailable (HTTP ${response.status})`);
  return body;
}

let current: ServedScope = LONDON_SCOPE;

/** The scope ScopeProvider last published (London until then, and on the server). */
export function loadedScope(): ServedScope {
  return current;
}

export function publishScope(scope: ServedScope): void {
  current = scope;
}
