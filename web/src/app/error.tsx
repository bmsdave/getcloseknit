"use client"; // Error boundaries must be Client Components.

import Link from "next/link";
import { useEffect } from "react";

import { SiteHeader } from "@/components/site-header";
import { pagePath, track } from "@/lib/usage";

/**
 * A page that failed to load (the evidence service down, a timeout): say so
 * plainly, offer to try again (retry re-fetches the page) and a way home.
 * The error stays in this browser's console; only that a page failed (its path template and the
 * server's digest, never the message) goes to usage, so failing pages show up in the report.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    track("client_error", { path: pagePath(window.location.pathname), digest: error.digest });
  }, [error]);
  return (
    <main className="status-page" data-testid="error-page">
      <SiteHeader />
      <h1>This page didn&apos;t load</h1>
      <p className="status-page__lead">
        Something went wrong on our side, usually for a moment only. Try again, or go back to the map.
      </p>
      <div className="status-page__actions">
        <button type="button" className="status-button status-button--primary" onClick={() => retry()} data-testid="error-retry">
          Try again
        </button>
        <Link className="status-button" href="/">Back to the map</Link>
        <Link className="status-button" href="/guide">Guide</Link>
      </div>
      {error.digest && <p className="status-page__note">Reference {error.digest}</p>}
    </main>
  );
}
