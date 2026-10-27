/** What page.route takes as its URL: a glob, a regular expression or a predicate. */
export type UrlMatch = string | RegExp | ((url: URL) => boolean);

/**
 * Whether a page.route pattern may match `url` (e2e/fixtures.ts keeps such URLs out of a section batch). Errs
 * towards yes: a URL wrongly kept out of a batch is only read on its own.
 */
export function mayMatch(match: UrlMatch, url: URL): boolean {
  if (typeof match === "function") return match(url);
  if (match instanceof RegExp) return new RegExp(match.source, match.flags.replace("g", "")).test(url.href);
  // A glob (a path starts at the page's origin): ** spans "/", * does not, {a,b} is either. With or without
  // the query string.
  const pattern = (match.startsWith("/") ? `${url.origin}${match}` : match)
    .replace(/[.+^$()|[\]\\?]/g, "\\$&")
    .replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")
    .replace(/\{([^}]*)\}/g, (_, options: string) => `(${options.split(",").join("|")})`);
  const glob = new RegExp(`^${pattern}$`);
  return glob.test(url.href) || glob.test(`${url.origin}${url.pathname}`);
}
