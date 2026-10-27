/**
 * What an area's ranks are "of": its English region (API rankScope, FLAGS.md CLOSE_KNIT_ENGLAND), so
 * "Safer than 80% of London" reads "… of North West" outside London. No rankScope (an older API, a
 * demo fixture) is London, as before.
 */

/** The region an area's percentiles are computed in, as the API sends it. */
export interface RankScope {
  code: string;
  name: string;
}

export const LONDON_REGION = "E12000007";
export const LONDON_SCOPE: RankScope = { code: LONDON_REGION, name: "London" };

/** ONS regions (E12), in ONS order: /area/england lists them this way. */
export const REGIONS: readonly RankScope[] = [
  { code: "E12000001", name: "North East" },
  { code: "E12000002", name: "North West" },
  { code: "E12000003", name: "Yorkshire and The Humber" },
  { code: "E12000004", name: "East Midlands" },
  { code: "E12000005", name: "West Midlands" },
  { code: "E12000006", name: "East of England" },
  LONDON_SCOPE,
  { code: "E12000008", name: "South East" },
  { code: "E12000009", name: "South West" },
];

/** A region by code; null for an unknown code. */
export function regionScope(code: string | null | undefined): RankScope | null {
  return REGIONS.find((region) => region.code === code) ?? null;
}

/** "north-west" for /area/england#north-west and the sitemap shards. */
export function regionSlug(scope: RankScope): string {
  return scope.name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
}

type ScopeSource = RankScope | { rankScope?: RankScope | null } | null | undefined | "unknown";

function scopeOf(source: ScopeSource): RankScope | null {
  if (!source || source === "unknown") return null;
  if ("rankScope" in source) return source.rankScope ?? null;
  // A payload without rankScope (e.g. people's, which has its area's `name`) is not a scope: only {code, name}.
  return "code" in source && typeof source.code === "string" && "name" in source && typeof source.name === "string"
    && source.name ? source : null;
}

/** "London", "North West", …: the name the comparison copy uses ("… of <name>"). */
export function scopeName(...sources: ScopeSource[]): string {
  for (const source of sources) {
    const scope = scopeOf(source);
    if (scope) return scope.name;
  }
  return LONDON_SCOPE.name;
}
