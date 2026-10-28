/**
 * Search and AI crawlers by user agent. A page whose evidence did not answer (the API's per-viewer rate limit
 * refused a fast crawl, or it was down) must not reach them as a 200 with "This area didn't load" and a noindex:
 * they would index the error, or drop the page. They get a 500 instead (components/unavailable-page.tsx), which
 * they retry later and which slows their crawl. People keep the page with Try again.
 */
const CRAWLER = /googlebot|google-inspectiontool|googleother|adsbot-google|mediapartners-google|storebot-google|bingbot|bingpreview|msnbot|duckduckbot|yandex|baiduspider|applebot|slurp|petalbot|seznambot|qwantbot|ecosia|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-searchbot|perplexitybot|ccbot|facebookexternalhit|linkedinbot|twitterbot|slackbot/i;

export function isCrawler(userAgent: string | null | undefined): boolean {
  return !!userAgent && CRAWLER.test(userAgent);
}

/** Thrown for a crawler instead of rendering a page that did not load: Next answers it with a 500. */
export class RetryLater extends Error {
  constructor(status: number, what: string) {
    super(`${what} did not load (API ${status}): retry later`);
    this.name = "RetryLater";
  }
}
