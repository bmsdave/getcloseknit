"use client";

import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

/**
 * A page whose evidence did not answer (rate limited, the API down): said plainly with Try again,
 * instead of an empty shell or a thrown render (HTTP 500, React #441 on an in-app visit).
 * Try again reloads the page, so the server reads its evidence afresh.
 */
export function PageUnavailable({ status, what = "page" }: {
  /** The API's status: 429 asks for a minute's wait. */
  status: number;
  /** What did not load: "area", "home", "school"… */
  what?: string;
}) {
  const busy = status === 429;
  return (
    <main className="status-page" data-testid="page-unavailable" data-status={status}>
      {/* Served as 200 (a page cannot set its status): never indexed as the page's content. */}
      <meta name="robots" content="noindex" />
      <SiteHeader />
      <h1>This {what} didn&apos;t load</h1>
      <p className="status-page__lead" role="status">
        {busy ? "Too many pages at once. Wait a minute, then try again." : "Usually for a moment only."}
      </p>
      <div className="status-page__actions">
        <button type="button" className="status-button status-button--primary" data-testid="page-unavailable-retry"
          onClick={() => window.location.reload()}>
          Try again
        </button>
        <Link className="status-button" href="/">Back to the map</Link>
      </div>
    </main>
  );
}
