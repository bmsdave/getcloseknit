import { carrierOf as carrierOfKind, carrierOfId, type Carrier, type GeographyId, type SectorListItem } from "./contracts";
import type { SearchKind, SearchResult, StreetMatch } from "./fixtures";
import { normalisePostcode, postcodeSlug } from "./postcode-page";
import { sectorPath, sectorTitle } from "./sector";
import { streetHomePath } from "./street-home";

export interface PostcodeArea {
  carrier: Carrier;
  code: string;
}

export interface PostcodeLookup {
  postcode: string;
  longitude: number | null;
  latitude: number | null;
  areaName: string | null;
  districtName: string | null;
  area: PostcodeArea | null;
}

const POSTCODE_PATTERN = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const POSTCODES_IO_URL = "https://api.postcodes.io/postcodes/";

export function isPostcodeQuery(query: string): boolean {
  return POSTCODE_PATTERN.test(query.trim());
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function areaFromCodes(codes: Record<string, unknown>): PostcodeArea | null {
  const lsoa = text(codes.lsoa21) ?? text(codes.lsoa) ?? text(codes.lsoa11);
  if (lsoa) return { carrier: "lsoa", code: lsoa };
  const msoa = text(codes.msoa21) ?? text(codes.msoa) ?? text(codes.msoa11);
  if (msoa) return { carrier: "msoa", code: msoa };
  const borough = text(codes.admin_district);
  if (borough) return { carrier: "lad", code: borough };
  return null;
}

/** Validates a postcodes.io single-postcode payload into a usable lookup. */
export function parsePostcodeLookup(payload: unknown): PostcodeLookup | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { status?: unknown; result?: unknown };
  if (body.status !== 200 || !body.result || typeof body.result !== "object") return null;
  const result = body.result as Record<string, unknown>;
  const codes = result.codes;
  if (!codes || typeof codes !== "object") return null;
  const postcode = text(result.postcode);
  if (!postcode) return null;
  return {
    postcode,
    longitude: number(result.longitude),
    latitude: number(result.latitude),
    areaName: text(result.lsoa) ?? text(result.msoa),
    districtName: text(result.admin_district),
    area: areaFromCodes(codes as Record<string, unknown>),
  };
}

export async function lookupPostcode(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PostcodeLookup | null> {
  try {
    const response = await fetchImpl(`${POSTCODES_IO_URL}${encodeURIComponent(query.trim())}`, {
      signal: AbortSignal.timeout(2500),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return parsePostcodeLookup(await response.json());
  } catch {
    return null;
  }
}

function geographyId(area: PostcodeArea): GeographyId {
  return `uk:${carrierOfKind(area.carrier)}:${area.code}` as GeographyId;
}

/**
 * Area search with a postcode fallback: upstream results win; only when the
 * upstream knows nothing and the query is postcode-shaped do we resolve the
 * postcode to its statistical geography and search again by ONS code.
 */
export async function searchWithPostcodeFallback(args: {
  query: string;
  searchUpstream: (query: string) => Promise<SearchResult[]>;
  lookupPostcode: (query: string) => Promise<PostcodeLookup | null>;
}): Promise<SearchResult[]> {
  const direct = await args.searchUpstream(args.query);
  if (direct.length > 0 || !isPostcodeQuery(args.query)) return direct;
  const found = await args.lookupPostcode(args.query).catch(() => null);
  if (!found?.area) return [];
  const byCode = await args.searchUpstream(found.area.code).catch((): SearchResult[] => []);
  const point: [number, number] | null =
    found.longitude === null || found.latitude === null ? null : [found.longitude, found.latitude];
  // Show what was asked for: the postcode, with its area as the detail.
  if (byCode.length > 0) {
    const [area, ...rest] = byCode;
    return [{
      ...area,
      label: found.postcode,
      secondaryLabel: [area.label, found.districtName].filter((part) => part).join(" · "),
      center: point ?? area.center,
    }, ...rest];
  }
  if (point === null) return [];
  const secondary = [found.areaName, found.districtName].filter((part) => part).join(" · ") || found.area.code;
  return [{
    id: geographyId(found.area),
    label: found.postcode,
    secondaryLabel: secondary,
    geographyId: geographyId(found.area),
    uprn: null,
    addressId: null,
    center: point,
  }];
}

// ---- Search box: what the explorer's search offers -------------------------------------------

const ONS_CODE = /^[EW]\d{8}$/;
/** An official area name such as "Islington 014B" (MSOA 014, LSOA 014B): its borough is the words before the number. */
const ONS_AREA_NAME = /^(.+?) \d{3}[A-Z]?$/;
const AREA_RANK: Record<string, number> = { lad: 0, msoa: 1, lsoa: 2 };

function carrierOf(result: SearchResult): Carrier {
  return carrierOfId(result.geographyId);
}

/** "Flat 4, Kinross House, London, London, N1 0AA" → "Flat 4, Kinross House, London, N1 0AA". */
export function tidyAddressLabel(label: string): string {
  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.filter((part, index) => index === 0 || part.toLowerCase() !== parts[index - 1].toLowerCase()).join(", ");
}

/**
 * Plain words for an area row's detail: no ONS codes, "Islington 014B" read as its borough. A borough outside
 * London (CLOSE_KNIT_ENGLAND: any English LAD) is a local authority; London's are E09 (owner decision:
 * the word comes from the LAD's type, its local_type, never from the id or URL segment, which say lad).
 */
function tidyAreaDetail(secondary: string, geographyId: string): string {
  const borough = geographyId.startsWith("uk:lad:") && !geographyId.startsWith("uk:lad:E09") ? "Local authority" : "London borough";
  const parts = secondary.split(" · ").map((part) => part.trim()).filter((part) => part && !ONS_CODE.test(part));
  const words = parts.map((part) => (part === "borough" ? borough : ONS_AREA_NAME.exec(part)?.[1] ?? part));
  return [...new Set(words)].join(" · ");
}

/** A row's kind: the API's, else read from the row (a street, a home, a page, or the area's level). */
export function kindOf(result: SearchResult): SearchKind {
  if (result.kind) return result.kind;
  if (result.street) return "street";
  if (result.addressId !== null || result.uprn !== null) return "address";
  if (result.href?.startsWith("/postcode/")) return "postcode";
  if (result.href?.startsWith("/sector/")) return "sector";
  return carrierOf(result) as SearchKind;
}

/** The search box's groups, in this order of kinds; short labels (design CUJ-02 v2). */
const SEARCH_GROUPS: { label: string; kinds: readonly SearchKind[] }[] = [
  { label: "Postcode", kinds: ["postcode", "sector"] },
  { label: "Homes", kinds: ["address", "street"] },
  { label: "Areas", kinds: ["lad", "msoa", "lsoa"] },
  { label: "Schools", kinds: ["school"] },
  { label: "Stations", kinds: ["station"] },
  { label: "Places", kinds: ["place"] },
];

export interface SearchGroup {
  label: string;
  options: SearchResult[];
}

/**
 * Options grouped by kind: postcode pages first, then each group where the search ranked its best
 * row (a name finds its areas before homes on a street of that name; a postcode, its homes).
 */
export function searchGroups(options: SearchResult[]): SearchGroup[] {
  const groups: SearchGroup[] = [];
  for (const option of options) {
    const label = SEARCH_GROUPS.find((group) => group.kinds.includes(kindOf(option)))?.label ?? "Areas";
    const group = groups.find((known) => known.label === label);
    if (group) group.options.push(option);
    else groups.push({ label, options: [option] });
  }
  return groups.sort((a, b) => Number(b.label === "Postcode") - Number(a.label === "Postcode"));
}

const POSTCODE_OPTIONS = 5;
/** An outcode ("SW1A") or a sector ("W5 1"): a partial postcode. */
const PARTIAL_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)(?:\s*(\d))?$/;
const POSTCODE_IN_TEXT = /\b([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})\b/g;

/** The postcode page row: "SW1A 1AA · Prices & sales" → /postcode/SW1A-1AA. */
function postcodeOption(postcode: string, near: SearchResult | undefined): SearchResult {
  return {
    id: `postcode:${postcode}`,
    kind: "postcode",
    label: postcode,
    secondaryLabel: "Prices & sales",
    geographyId: near?.geographyId ?? ("uk:postcode:" + postcode.replace(/\s/g, "")) as GeographyId,
    uprn: null,
    addressId: null,
    center: near?.center ?? [0, 0],
    href: `/postcode/${postcodeSlug(postcode)}`,
  };
}

/**
 * The full postcodes the results name for a partial one ("SW1A", "W5 1"), in the order found,
 * at most five: each is a page the search has confirmed. [] for any other query.
 */
function partialPostcodeOptions(query: string, results: SearchResult[]): SearchResult[] {
  const partial = PARTIAL_POSTCODE.exec(query.trim().toUpperCase());
  if (!partial) return [];
  const [, outcode, sector] = partial;
  const found = new Map<string, SearchResult>();
  for (const result of results) {
    for (const [, outward, inward] of `${result.label} ${result.secondaryLabel}`.toUpperCase().matchAll(POSTCODE_IN_TEXT)) {
      if (outward !== outcode || (sector && !inward.startsWith(sector))) continue;
      const postcode = `${outward} ${inward}`;
      if (!found.has(postcode)) found.set(postcode, postcodeOption(postcode, result));
    }
  }
  return [...found.values()].slice(0, POSTCODE_OPTIONS);
}

/**
 * The search box's options, grouped by kind (searchGroups). A full postcode the
 * search knows comes first as its own page ("N1 0AA · Prices & sales" →
 * /postcode/N1-0AA); a partial one ("SW1A") offers up to five full postcodes the
 * results name; one nothing confirms is never offered (it would only open a 404).
 * Addresses come without the doubled town ("London, London"); areas collapse to one
 * row per neighbourhood name (the borough, then the MSOA, stands for its LSOAs) and
 * never show an ONS code or an official name such as "Islington 014B".
 */
export function searchOptions(query: string, results: SearchResult[]): SearchResult[] {
  const options: SearchResult[] = [];
  const postcode = isPostcodeQuery(query) ? normalisePostcode(query) : null;
  if (postcode && confirmsPostcode(postcode, results)) options.push(postcodeOption(postcode, results[0]));
  options.push(...partialPostcodeOptions(query, results));
  const areas = new Map<string, SearchResult>();
  const oneStreet = results.filter((result) => result.street).length === 1;
  for (const result of results) {
    const kind = kindOf(result);
    // A page of its own (a postcode sector, a school) or a point (a station, a park): offered as it came.
    if ((result.href && !result.street) || kind === "station" || kind === "place") {
      options.push({ ...result, kind });
      continue;
    }
    if (result.street) {
      options.push(...streetOptions(result, result.street, oneStreet));
      continue;
    }
    if (result.addressId !== null || result.uprn !== null) {
      options.push({
        ...result,
        kind,
        label: tidyAddressLabel(result.label),
        secondaryLabel: result.secondaryLabel.replace(/\b1 recorded sales\b/, "1 recorded sale"),
      });
      continue;
    }
    const [name, ...rest] = result.label.split(" · ");
    const plainName = ONS_AREA_NAME.exec(name)?.[1] ?? name;
    const key = plainName.toLowerCase();
    const tidy = { ...result, kind, label: [plainName, ...rest].join(" · "), secondaryLabel: tidyAreaDetail(result.secondaryLabel, result.geographyId) };
    const kept = areas.get(key);
    if (!kept) {
      areas.set(key, tidy);
      options.push(tidy);
    } else if ((AREA_RANK[carrierOf(result)] ?? 9) < (AREA_RANK[carrierOf(kept)] ?? 9)) {
      areas.set(key, tidy);
      options[options.indexOf(kept)] = tidy;
    }
  }
  return searchGroups(options).flatMap((group) => group.options);
}

const STREET_POSTCODE_OPTIONS = 4;

/**
 * The row for a street search: with a house number the street-level home page, which says why
 * the postcode is likely (the neighbouring numbers); a street alone opens the postcode page.
 */
export function streetHref(postcode: string, street: StreetMatch): string {
  if (street.number !== null) return streetHomePath(postcode, `${street.number} ${street.name}`);
  return `/postcode/${postcodeSlug(postcode)}`;
}

/**
 * A street found for an address with no recorded sale. A likely postcode gives one row to its
 * page; otherwise the only street found lists each of its postcodes ("Valley Road, NW5 1AA"),
 * and one of several streets gets one row to its main postcode. A street with no recorded homes
 * at all opens its area.
 */
function streetOptions(result: SearchResult, street: StreetMatch, oneStreet: boolean): SearchResult[] {
  const place = [...new Set([street.locality, street.borough].filter((part): part is string => !!part))].join(", ");
  const home = street.number !== null ? `${street.number} ${street.name}` : null;
  const base = { ...result, kind: "street" as const, street: undefined, uprn: null, addressId: null };
  // Recorded homes share the number (flats at 66): open their postcode, never "no recorded sale".
  if (street.number !== null && street.neighbours.length === 1 && street.neighbours[0] === street.number &&
      street.numberPostcodes.length > 1) {
    // A tower's flats at one number across several postcodes: one row per postcode.
    return street.numberPostcodes.map((postcode) => ({
      ...base,
      id: `street:${street.name}:${postcode}:${street.number}`,
      label: home ?? street.name,
      secondaryLabel: [`Recorded homes at no. ${street.number} in ${postcode}`, place].filter(Boolean).join(" · "),
      href: `/postcode/${postcodeSlug(postcode)}`,
    }));
  }
  if (street.likelyPostcode && street.number !== null && street.neighbours.length === 1 && street.neighbours[0] === street.number) {
    return [{
      ...base,
      id: `street:${street.name}:${street.likelyPostcode}:${street.number}`,
      label: home ?? street.name,
      secondaryLabel: [`Recorded homes at no. ${street.number} in ${street.likelyPostcode}`, place].filter(Boolean).join(" · "),
      href: `/postcode/${postcodeSlug(street.likelyPostcode)}`,
    }];
  }
  if (street.likelyPostcode) {
    return [{
      ...base,
      id: `street:${street.name}:${street.likelyPostcode}:${street.number}`,
      label: home ?? street.name,
      secondaryLabel: [`Likely ${street.likelyPostcode}`, place, "no recorded sale"].filter(Boolean).join(" · "),
      href: streetHref(street.likelyPostcode, street),
    }];
  }
  if (street.postcodes.length === 0) {
    return [{
      ...base,
      id: `street:${street.name}:${result.geographyId}`,
      label: home ?? street.name,
      secondaryLabel: ["Street", place, "no recorded sales"].filter(Boolean).join(" · "),
      href: searchResultHref({ ...result, href: undefined }),
    }];
  }
  if (!oneStreet) {
    return [{
      ...base,
      id: `street:${street.name}:${result.geographyId}:${street.number}`,
      label: home ?? street.name,
      secondaryLabel: [place, home ? "no recorded sale" : "street"].filter(Boolean).join(" · "),
      href: streetHref(street.postcodes[0], street),
    }];
  }
  return street.postcodes.slice(0, STREET_POSTCODE_OPTIONS).map((postcode) => ({
    ...base,
    id: `street:${street.name}:${postcode}:${street.number}`,
    label: `${street.name}, ${postcode}`,
    secondaryLabel: [home ? `No recorded sale for no. ${street.number}` : "Street", place].filter(Boolean).join(" · "),
    href: streetHref(postcode, street),
  }));
}

/** A result names the postcode (an address in it, or the lookup's own row): the postcode exists. */
function confirmsPostcode(postcode: string, results: SearchResult[]): boolean {
  const compact = postcode.replace(/\s/g, "");
  return results.some((result) => `${result.label} ${result.secondaryLabel}`.toUpperCase().replace(/\s/g, "").includes(compact));
}

/**
 * The search row for a typed sector ("W5 1") that the sector list confirms: its page,
 * never a guess (an unknown sector would only open a 404).
 */
export function sectorResults(code: string, list: readonly SectorListItem[]): SearchResult[] {
  const found = list.find((item) => item.code.toUpperCase() === code.toUpperCase());
  if (!found) return [];
  return [{
    id: `sector:${found.code}`,
    kind: "sector",
    label: `${sectorTitle(found)}: £/m² and price index`,
    secondaryLabel: "Postcode sector · price range, growth since 2004, nearby sectors and streets",
    geographyId: `uk:sector:${found.slug}` as GeographyId,
    uprn: null,
    addressId: null,
    center: [0, 0],
    href: sectorPath(found.code),
  }];
}

/** The line under the search when nothing matched: a postcode gets told to check it, or try a street. */
export function noMatchMessage(query: string): string {
  const postcode = isPostcodeQuery(query) ? normalisePostcode(query) : null;
  if (postcode) return `We can't find ${postcode} — check it, or try a street or area name.`;
  return `Nothing matches “${query.trim()}”.`;
}

/** The zoom a station or park opens the map at: its streets in view. */
const POINT_ZOOM = 15;

/**
 * Where a search result leads off the map: the postcode, school or home's page, the map at a
 * station or park (with the area it is in chosen), else the area page.
 */
export function searchResultHref(result: SearchResult): string {
  if (result.href) return result.href;
  const kind = kindOf(result);
  if (kind === "station" || kind === "place") {
    const [lng, lat] = result.center;
    return `/?${new URLSearchParams({ lat: String(lat), lng: String(lng), zoom: String(POINT_ZOOM), selected: result.geographyId })}`;
  }
  if (result.uprn && /^\d{1,12}$/.test(result.uprn)) return `/property/${result.uprn}`;
  const [, carrier, code] = result.geographyId.split(":");
  return `/area/${carrier}/${code}`;
}

/** The postcode page for a typed full postcode ("n1 0aa" → "/postcode/N1-0AA"); null for anything else. */
export function postcodeHref(query: string): string | null {
  const postcode = isPostcodeQuery(query) ? normalisePostcode(query) : null;
  return postcode ? `/postcode/${postcodeSlug(postcode)}` : null;
}

/**
 * The search box's options for `query` from /api/v1/search; [] when aborted or refused.
 * `everything`: the site's one Search, with schools, stations and places too (scope=all).
 */
export async function loadSearchResults(
  query: string, controller: AbortController, { everything = false }: { everything?: boolean } = {},
): Promise<SearchResult[]> {
  let response;
  // "sw1a1ab" is searched as "SW1A 1AB", the way addresses spell it.
  const asked = (isPostcodeQuery(query) ? normalisePostcode(query) : null) ?? query;
  try {
    response = await fetch(`/api/v1/search?q=${encodeURIComponent(asked)}${everything ? "&scope=all" : ""}`, {
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) return [];
    throw error;
  }
  if (!response.ok) return [];
  const payload = (await response.json()) as { results: SearchResult[] };
  return searchOptions(query, payload.results);
}
