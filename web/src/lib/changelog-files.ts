import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseEntry, sortEntries, type ChangelogEntry } from "./changelog";

/** web/content/changelog: next to the standalone server in the image (web/Dockerfile copies content/). */
export const CHANGELOG_DIR = join(process.cwd(), "content/changelog");

let cached: ChangelogEntry[] | null = null;

/** Every entry, newest first. A bad file fails loudly (the unit test reads the real folder too). */
export function loadChangelog(dir: string = CHANGELOG_DIR): ChangelogEntry[] {
  if (dir === CHANGELOG_DIR && cached && process.env.NODE_ENV === "production") return cached;
  const files = readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
  const entries = sortEntries(files.map((name) => parseEntry(readFileSync(join(dir, name), "utf8"), name)));
  if (dir === CHANGELOG_DIR) cached = entries;
  return entries;
}

export function changelogEntry(slug: string): ChangelogEntry | null {
  return loadChangelog().find((entry) => entry.slug === slug) ?? null;
}
