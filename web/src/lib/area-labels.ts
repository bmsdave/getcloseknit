import { carrierOf } from "./contracts";

/**
 * Friendly area names (API migration 023): the House of Commons Library name of
 * an area's MSOA plus its majority postcode district, e.g. "Alperton East · HA0".
 * The official name ("Brent 026D") stays alongside, small, for anyone who needs it.
 */
export interface FriendlyAreaFields {
  /** HoC Library neighbourhood name (a borough: its own name); null when unknown. */
  friendlyName?: string | null;
  /** Postcode district holding most of the area's live postcodes, e.g. "NW10". */
  postcodeDistrict?: string | null;
  /** The API's one name to show: the friendly title, else the official name. */
  displayName?: string | null;
}

/**
 * A place's name as people say it: ONS lists a few local authorities inverted ("Bristol, City of",
 * "Herefordshire, County of", "Kingston upon Hull, City of"); the site shows "Bristol". Other names pass through.
 */
export function plainPlaceName(name: string | null | undefined): string | null {
  const text = name?.trim();
  return text ? text.replace(/^(.+), (?:City|County) of$/, "$1") : null;
}

export function friendlyTitle(fields: FriendlyAreaFields | null | undefined): string | null {
  const name = plainPlaceName(fields?.friendlyName);
  if (!name) return null;
  const district = fields?.postcodeDistrict?.trim();
  return district ? `${name} · ${district}` : name;
}

/**
 * The one name the site shows for an area, never a code like "Haringey 019A" when a
 * friendly name is known: the friendly title, else the API's displayName, else a result row's title
 * ("Pitshanger · W5"), else the official name; null when there is none.
 */
export function areaDisplayName(
  area: (FriendlyAreaFields & { title?: string | null; name?: string | null }) | null | undefined,
): string | null {
  return friendlyTitle(area) || plainPlaceName(area?.displayName) || plainPlaceName(area?.title) || plainPlaceName(area?.name);
}

/** An official ONS name stored as a name ("Haringey 019A", "Westminster 013") or a bare id: resolve it. */
export function isCodeName(name: string | null | undefined, geographyId?: string): boolean {
  const text = name?.trim() ?? "";
  return text === "" || text === geographyId || /^uk:(lsoa|msoa|lad):/.test(text) || /\s\d{3}[A-Z]?$/.test(text);
}

/** An area level in plain words, never "LSOA" or "MSOA". */
export function carrierWords(carrier: string): string {
  if (carrier === "lsoa") return "this neighbourhood";
  if (carrier === "msoa") return "the wider neighbourhood";
  if (carrierOf(carrier) === "lad") return "the borough";
  return "the wider area";
}

/**
 * The breadcrumb's name for the area one level up: its own title ("Hounslow"),
 * or its level in words when it has none or shares this area's title (a
 * neighbourhood's district usually carries the same friendly name).
 */
export function partOfLabel(parent: { title: string | null; carrier: string }, ownTitle: string | null): string {
  return parent.title && parent.title !== ownTitle ? parent.title : carrierWords(parent.carrier);
}

/**
 * The map panel's crumbs above an area, London down (one naming source, as the area page's
 * breadcrumbs): each wider area by its name without a postcode district ("Camden", "Euston"), never the
 * district of the wider area (EC4Y over an EC1A title) nor a generic "the wider neighbourhood". A
 * neighbourhood group named like the borough above it or the area below it is left out (St James's ›
 * St James's), and so is one with only an official code for a name.
 * `wider` is nearest first (as read up the hierarchy); `own` is the area's own name without its district.
 */
export function widerCrumbs<T extends { carrier: string; name: string | null }>(wider: readonly T[], own: string | null): (T & { label: string })[] {
  const down = [...wider].reverse();
  const crumbs: (T & { label: string })[] = [];
  down.forEach((area, index) => {
    const name = area.name?.trim() || null;
    const label = name && !isCodeName(name) ? name : carrierOf(area.carrier) === "lad" ? carrierWords(area.carrier) : null;
    if (!label) return;
    const next = index + 1 < down.length ? down[index + 1].name?.trim() || null : own?.trim() || null;
    const before = crumbs.at(-1)?.label ?? null;
    if (carrierOf(area.carrier) !== "lad" && (label === next || label === before)) return;
    crumbs.push({ ...area, label });
  });
  return crumbs;
}

/**
 * The wider area a borrowed figure comes from, said once: the friendly name
 * is the surrounding neighbourhood's own name, so "the wider area around
 * Canonbury East & Mildmay Park"; without one, "the wider area".
 */
export function widerAreaWords(fields: FriendlyAreaFields | null | undefined): string {
  const name = fields?.friendlyName?.trim();
  return name ? `the wider area around ${name}` : "the wider area";
}

/**
 * The title to show and the official name (kept for the page's Sources). Without a
 * friendly name the official name is the title and nothing sits beneath.
 */
export function areaTitle(
  officialName: string | null | undefined,
  fields: FriendlyAreaFields | null | undefined,
): { title: string | null; code: string | null } {
  const friendly = friendlyTitle(fields);
  const official = officialName?.trim() || null;
  if (!friendly) return { title: plainPlaceName(official), code: null };
  return { title: friendly, code: official && official !== friendly ? official : null };
}
