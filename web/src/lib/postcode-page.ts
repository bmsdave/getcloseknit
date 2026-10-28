/**
 * Pure planning for the permanent postcode page: which addresses to list and
 * which statistical area the postcode sits in. Data comes from the same search
 * surface the explorer uses (fixtures in demo, the evidence API in real mode).
 */
import { plainPlaceName } from "./area-labels";
import { carrierOf, type GeographyId } from "./contracts";
import type { SearchResult } from "./fixtures";
import type { PostcodeArea } from "./postcode-search";

const POSTCODE_PATTERN = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

export interface PostcodePlan {
  postcode: string;
  addresses: SearchResult[];
  geography: GeographyId | null;
  areaName: string | null;
}

export function normalisePostcode(input: string): string | null {
  const match = POSTCODE_PATTERN.exec(input.trim().toUpperCase().replace(/[-_]/g, " ").replace(/\s+/g, ""));
  return match ? `${match[1]} ${match[2]}` : null;
}

/**
 * A postcode from a URL segment: route params can arrive still encoded
 * ("E3%202DA", "E3+2DA"), so decode before normalising. A malformed escape
 * is read as typed.
 */
export function postcodeFromParam(param: string): string | null {
  let text = param.replace(/\+/g, " ");
  try {
    text = decodeURIComponent(text);
  } catch {
    // keep the raw text: "%" alone is not a postcode anyway
  }
  return normalisePostcode(text);
}

export function postcodeSlug(postcode: string): string {
  return postcode.replace(/\s+/g, "-");
}

export function planPostcodePage(
  postcode: string,
  results: SearchResult[],
  lookup: { area: PostcodeArea | null; areaName: string | null } | null,
): PostcodePlan {
  const addresses = results.filter((result) => result.addressId !== null && result.label.toUpperCase().includes(postcode));
  const area = results.find((result) => result.addressId === null) ?? null;
  const geography = addresses[0]?.geographyId ?? area?.geographyId
    ?? (lookup?.area ? `uk:${carrierOf(lookup.area.carrier)}:${lookup.area.code}` as GeographyId : null);
  return { postcode, addresses, geography, areaName: area?.label ?? lookup?.areaName ?? null };
}

/**
 * What the postcode page offers for its homes: their list when the API has one ("listed"); without one, a
 * "London only" notice outside London (per-home pages cover London's addresses for now), never a link to a 404.
 */
export function postcodeHomesState(homes: readonly unknown[] | null, inLondon: boolean): "listed" | "none" | "london-only" {
  if (homes !== null) return "listed";
  return inLondon ? "none" : "london-only";
}

/**
 * The rent table's words: the council by name, the comparison column by the area's own region (the API's
 * regionMonthlyRent), and "borough" in London, "council" elsewhere.
 */
export function rentTableWords(boroughName: string | null | undefined, region: string): { name: string; region: string; unit: string } {
  const unit = region === "London" ? "borough" : "council";
  return { name: plainPlaceName(boroughName) ?? `the ${unit}`, region, unit };
}
