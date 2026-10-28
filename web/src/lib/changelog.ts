/**
 * The weekly changelog (/changelog, board KHt56r65, option A): one markdown file per week in
 * web/content/changelog/<date>-<slug>.md, read on the server (lib/changelog-files.ts). This module is pure:
 * parsing and checks, the RSS feed, the post text and the share links, so tests run without the file system.
 *
 * A file is a small frontmatter block and 3–5 bullets:
 *
 *   ---
 *   date: YYYY-MM-DD
 *   title: Close Knit is public
 *   slug: close-knit-is-public
 *   number:
 *     value: 296
 *     label: local authorities with area data, in 9 regions
 *     source: Close Knit, England page
 *     url: /area/england
 *     parts: South East 64; London 33     (optional: the satin bar under the number)
 *   next: One line about next week       (optional)
 *   ---
 *   - **Open to everyone.** No sign-in. [Open the map](/)
 *
 * Bullets take **bold** and [links](/site-path) only; links stay on the site.
 */

export interface InlineText { kind: "text" | "bold"; text: string }
export interface InlineLink { kind: "link"; text: string; href: string }
export type Inline = InlineText | InlineLink;

export interface ChangelogNumber {
  value: string;
  label: string;
  source: string;
  url: string;
  parts: { name: string; value: number }[];
}

export interface ChangelogEntry {
  /** YYYY-MM-DD. */
  date: string;
  title: string;
  slug: string;
  number: ChangelogNumber | null;
  next: string | null;
  bullets: Inline[][];
}

export const CHANGELOG_PATH = "/changelog";
export const CHANGELOG_RSS_PATH = "/changelog/rss.xml";
export const CHANGELOG_TITLE = "Changelog";
export const CHANGELOG_LEAD = "Every week: what shipped, one number, what's next.";
/** The feed carries the newest 20. */
export const RSS_LIMIT = 20;

export function changelogPath(slug: string): string {
  return `${CHANGELOG_PATH}/${slug}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.md$/;
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
const NUMBER_KEYS = ["value", "label", "source", "url"] as const;

class ChangelogError extends Error {
  constructor(file: string, message: string) {
    super(`changelog ${file}: ${message}`);
  }
}

/** A site path ("/area/england", "/?layer=x", "/about#freshness"), never another site. */
export function isSitePath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/** **bold** and [text](/path) in one bullet; anything else is plain text. */
export function parseInline(text: string, file = "?"): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) out.push({ kind: "text", text: text.slice(at, match.index) });
    if (match[1] !== undefined) out.push({ kind: "bold", text: match[1] });
    else {
      const href = match[3];
      if (!isSitePath(href)) throw new ChangelogError(file, `links stay on the site: ${href}`);
      out.push({ kind: "link", text: match[2], href });
    }
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/** "South East 64; London 33" → [{name, value}]. */
function parseParts(raw: string, file: string): ChangelogNumber["parts"] {
  return raw.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = /^(.+?)\s+(\d+(?:\.\d+)?)$/.exec(part);
    if (!match) throw new ChangelogError(file, `number.parts: "${part}" is not "name value"`);
    return { name: match[1], value: Number(match[2]) };
  });
}

/** One entry file: frontmatter, then bullets. Throws on anything the board's build checks reject. */
export function parseEntry(source: string, file: string): ChangelogEntry {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") throw new ChangelogError(file, "starts with a --- frontmatter block");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new ChangelogError(file, "frontmatter has no closing ---");

  const top: Record<string, string> = {};
  const number: Record<string, string> = {};
  let inNumber = false;
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const match = /^(\s*)([a-z]+):\s*(.*)$/.exec(line);
    if (!match) throw new ChangelogError(file, `frontmatter line not understood: ${line}`);
    const [, indent, key, value] = match;
    if (indent) {
      if (!inNumber) throw new ChangelogError(file, `indented key outside number: ${key}`);
      number[key] = unquote(value);
    } else {
      inNumber = key === "number" && !value.trim();
      if (!inNumber) top[key] = unquote(value);
    }
  }

  for (const key of ["date", "title", "slug"]) if (!top[key]) throw new ChangelogError(file, `${key} is required`);
  const { date, title, slug } = top;
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new ChangelogError(file, `date is YYYY-MM-DD: ${date}`);
  if (!SLUG.test(slug)) throw new ChangelogError(file, `slug is lower-case words and dashes: ${slug}`);
  const named = FILE.exec(file.split("/").pop() ?? file);
  if (named && (named[1] !== date || named[2] !== slug)) throw new ChangelogError(file, `file name is ${date}-${slug}.md`);

  const given = NUMBER_KEYS.filter((key) => number[key]);
  if (given.length !== 0 && given.length !== NUMBER_KEYS.length) {
    throw new ChangelogError(file, "number needs value, label, source and url together, or none");
  }
  if (given.length && !isSitePath(number.url)) throw new ChangelogError(file, `number.url stays on the site: ${number.url}`);

  const bullets: Inline[][] = [];
  for (const line of lines.slice(end + 1)) {
    if (!line.trim()) continue;
    if (!line.startsWith("- ")) throw new ChangelogError(file, `body lines are "- " bullets: ${line}`);
    bullets.push(parseInline(line.slice(2).trim(), file));
  }
  if (bullets.length < 3 || bullets.length > 5) throw new ChangelogError(file, `3 to 5 bullets, not ${bullets.length}`);

  return {
    date, title, slug,
    number: given.length
      ? { value: number.value, label: number.label, source: number.source, url: number.url, parts: number.parts ? parseParts(number.parts, file) : [] }
      : null,
    next: top.next || null,
    bullets,
  };
}

/** Newest first; slugs must be unique. */
export function sortEntries(entries: readonly ChangelogEntry[]): ChangelogEntry[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.slug)) throw new Error(`changelog: slug "${entry.slug}" is used twice`);
    seen.add(entry.slug);
  }
  return [...entries].sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

/** ISO 8601 week number of a YYYY-MM-DD date. */
export function isoWeek(date: string): number {
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** "27 Oct 2026". */
export function formatEntryDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function inlineText(parts: readonly Inline[]): string {
  return parts.map((part) => part.text).join("").replace(/\s+/g, " ").trim();
}

/** Every link in the bullets, once each, in order (the entry's "Try it" chips). */
export function entryLinks(entry: ChangelogEntry): InlineLink[] {
  const links = new Map<string, InlineLink>();
  for (const part of entry.bullets.flat()) if (part.kind === "link" && !links.has(part.href)) links.set(part.href, part);
  return [...links.values()];
}

/** The bullets without their links, for the entry page (its links are the chips under them). */
export function withoutLinks(parts: readonly Inline[]): Inline[] {
  const kept = parts.filter((part) => part.kind !== "link");
  // Drop the " · " and spaces left between removed links.
  while (kept.length && kept[kept.length - 1].kind === "text" && !kept[kept.length - 1].text.replace(/[\s·]/g, "")) kept.pop();
  return kept;
}

/** One sentence for the description, the card and the posts. */
export function entrySummary(entry: ChangelogEntry): string {
  return entry.number ? `${entry.number.value} ${entry.number.label}.` : `${inlineText(withoutLinks(entry.bullets[0]))}`;
}

/** The same post for X, Bluesky and Mastodon (board: built from the file). */
export function postText(entry: ChangelogEntry): string {
  return `Week ${isoWeek(entry.date)}: ${entry.title}. ${entrySummary(entry)}`;
}

export function shareUrls(text: string, url: string): { x: string; bluesky: string } {
  return {
    x: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${url}`)}`,
  };
}

/** The reader's Mastodon server as a host ("mastodon.social", "https://fosstodon.org/" → "fosstodon.org"), or null. */
export function mastodonHost(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^@?[^@/]*@/, "").split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

export function mastodonShareUrl(host: string, text: string, url: string): string {
  return `https://${host}/share?text=${encodeURIComponent(`${text} ${url}`)}`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineHtml(parts: readonly Inline[], origin: string): string {
  return parts.map((part) => part.kind === "link"
    ? `<a href="${escapeXml(origin + part.href)}">${escapeXml(part.text)}</a>`
    : part.kind === "bold" ? `<strong>${escapeXml(part.text)}</strong>` : escapeXml(part.text)).join("");
}

/** The entry as HTML for the feed: bullets, the number with its source, next. Links absolute. */
export function entryHtml(entry: ChangelogEntry, origin: string): string {
  const html = [`<ul>${entry.bullets.map((bullet) => `<li>${inlineHtml(bullet, origin)}</li>`).join("")}</ul>`];
  if (entry.number) {
    const { value, label, source, url } = entry.number;
    html.push(`<p>Number of the week: <strong>${escapeXml(value)}</strong> ${escapeXml(label)}. Source: <a href="${escapeXml(origin + url)}">${escapeXml(source)}</a>.</p>`);
  }
  if (entry.next) html.push(`<p>Next: ${escapeXml(entry.next)}</p>`);
  return html.join("");
}

/** RSS 2.0, the newest 20 (entries come sorted newest first). */
export function rssXml(entries: readonly ChangelogEntry[], origin: string): string {
  const items = entries.slice(0, RSS_LIMIT).map((entry) => {
    const link = escapeXml(`${origin}${changelogPath(entry.slug)}`);
    return [
      "<item>",
      `<title>${escapeXml(entry.title)}</title>`,
      `<link>${link}</link>`,
      `<guid isPermaLink="true">${link}</guid>`,
      `<pubDate>${new Date(`${entry.date}T00:00:00Z`).toUTCString()}</pubDate>`,
      `<description>${escapeXml(entryHtml(entry, origin))}</description>`,
      "</item>",
    ].join("");
  });
  const built = entries[0] ? `<lastBuildDate>${new Date(`${entries[0].date}T00:00:00Z`).toUTCString()}</lastBuildDate>` : "";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    "<title>Close Knit changelog</title>",
    `<link>${escapeXml(origin + CHANGELOG_PATH)}</link>`,
    `<atom:link href="${escapeXml(origin + CHANGELOG_RSS_PATH)}" rel="self" type="application/rss+xml"/>`,
    `<description>${escapeXml(CHANGELOG_LEAD)}</description>`,
    "<language>en-gb</language>",
    built,
    ...items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}
