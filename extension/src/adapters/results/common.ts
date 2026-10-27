import type { ListingFacts } from "../../types";
import { isoDateOf } from "../parse";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The day a result was first listed, from the first of `values` that says it: an ISO date, "Added on 18/09/2025",
 * "Added today" or "Listed on 18th Sep 2025". A reduction's date ("Reduced on …") is not a listing date.
 */
export function listedOnOf(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string" || /reduc/i.test(value)) continue;
    const found = isoDateOf(value) ?? dayMonthYearOf(value);
    if (found) return found;
  }
  return null;
}

function dayMonthYearOf(text: string): string | null {
  const match = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\s+(\d{4})\b/i.exec(text);
  const month = match ? MONTHS.indexOf(match[2].toLowerCase()) : -1;
  if (!match || month < 0) return null;
  return isoDateOf(`${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`);
}

/** The result with `listedOn` only when it is known: older APIs refuse the field. */
export function withListedOn<T extends object>(item: T, listedOn: string | null): T & { listedOn?: string } {
  return listedOn ? { ...item, listedOn } : item;
}

/** A portal's words for a home ("End of Terrace", "Apartment", "Semi-detached house") → the request's type. */
export function propertyTypeOf(text: unknown): NonNullable<ListingFacts["propertyType"]> {
  const t = typeof text === "string" ? text.toLowerCase() : "";
  if (/flat|apartment|maisonette|studio|penthouse|duplex/.test(t)) return "flat";
  if (/semi/.test(t)) return "semi-detached";
  if (/terrace|town ?house|mews/.test(t)) return "terraced";
  if (/bungalow/.test(t)) return "bungalow";
  if (/detached/.test(t)) return "detached";
  return "unknown";
}

/**
 * The text Next.js streams into `self.__next_f.push([1, "…"])` scripts (app router pages, Zoopla), joined:
 * each push holds a JSON string, and an object may be split across two pushes.
 */
export function flightText(scripts: string[]): string {
  const parts: string[] = [];
  for (const text of scripts) {
    if (!text.startsWith("self.__next_f.push(")) continue;
    try {
      const pushed = JSON.parse(text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"))) as unknown[];
      if (typeof pushed[1] === "string") parts.push(pushed[1]);
    } catch {
      // Not a data push.
    }
  }
  return parts.join("");
}

/** Every JSON object in `text` that holds `"key":` (the innermost object around each occurrence). */
export function objectsWithKey(text: string, key: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const marker = `"${key}":`;
  for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + marker.length)) {
    const start = openingBrace(text, at);
    const end = start < 0 ? -1 : closingBrace(text, start);
    if (end < 0) continue;
    try {
      found.push(JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>);
    } catch {
      // A key inside a string, or a block that is not JSON.
    }
  }
  return found;
}

/** The "{" that opens the object around `at` (strings are not tracked backwards: JSON.parse checks the result). */
function openingBrace(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = text[i];
    if (c === "}" || c === "]") depth++;
    else if (c === "{" || c === "[") {
      if (depth === 0) return c === "{" ? i : -1;
      depth--;
    }
  }
  return -1;
}

function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** The numbers of `var name = [ … ];` in a script (OpenRent's result arrays). */
export function numberArray(text: string, name: string): number[] | null {
  const match = new RegExp(`\\bvar ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(text);
  if (!match) return null;
  return match[1].split(",").map((value) => Number.parseFloat(value.trim()));
}
