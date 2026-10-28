import { headers } from "next/headers";

import { PageUnavailable } from "@/components/page-unavailable";
import { isCrawler, RetryLater } from "@/lib/crawler";

/**
 * Server only. A page whose evidence did not answer: people get PageUnavailable (Try again, served as a 200 with
 * noindex, since a page cannot set its status); a crawler gets a thrown render, a 500 it retries, never the error
 * page indexed or the page dropped for its noindex (lib/crawler.ts).
 */
export async function unavailablePage(status: number, what: string) {
  await retryLaterForCrawlers(status, what);
  return <PageUnavailable status={status} what={what} />;
}

/** For a page with its own "could not load" state: throws for a crawler (a 500), returns for people. */
export async function retryLaterForCrawlers(status: number, what: string): Promise<void> {
  if (isCrawler((await headers()).get("user-agent"))) throw new RetryLater(status, what);
}
