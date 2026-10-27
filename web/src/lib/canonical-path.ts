/**
 * One address per page: a link typed or shared in another case ("/area/lsoa/e01003998",
 * "/postcode/sw1a1aa") is sent on, 308, to the page's canonical path instead of a 404 or a duplicate.
 * A LAD's page from before step R2 (/area/borough/<code>, docs/architecture/global-geography.md) moves
 * for good, 301, to /area/lad/<code> (`movedArea`). Pure, so proxy.ts and the unit tests share it.
 */
import { postcodeFromParam, postcodeSlug } from "./postcode-page";

const AREA = /^\/area\/(lsoa|msoa|lad|borough)\/(e\d{8})(\/.*)?$/i;
const POSTCODE = /^\/postcode\/([^/]+)(\/homes)?$/;

/** The canonical path for `pathname`, or null when it already is canonical (or is no page of these kinds). */
export function canonicalPath(pathname: string): string | null {
  const area = AREA.exec(pathname);
  if (area) {
    const kind = area[1].toLowerCase();
    const path = `/area/${kind === "borough" ? "lad" : kind}/${area[2].toUpperCase()}${area[3] ?? ""}`;
    return path === pathname ? null : path;
  }
  const postcode = POSTCODE.exec(pathname);
  if (postcode && postcode[1] !== "sitemap") {
    const found = postcodeFromParam(postcode[1]);
    if (!found) return null;
    const path = `/postcode/${postcodeSlug(found)}${postcode[2] ?? ""}`;
    return path === pathname ? null : path;
  }
  return null;
}

/** Whether `pathname` is a LAD page under its old segment (/area/borough/…): it moves permanently, 301. */
export function movedArea(pathname: string): boolean {
  return /^\/area\/borough\//i.test(pathname);
}

/** An API path or query with every old LAD id (uk:borough:<code>, %-encoded colons too) as its current one. */
export function canonicalApiText(text: string): string {
  return text.replace(/uk(:|%3A)borough(:|%3A)/gi, (_, a: string, b: string) => `uk${a}lad${b}`);
}
