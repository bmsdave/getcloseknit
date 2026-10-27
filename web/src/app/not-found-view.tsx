"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { SiteHeader } from "@/components/site-header";
import { KnitIcon } from "@/components/knit/knit-icon";
import type { SearchResult } from "@/lib/fixtures";
import { useScope } from "@/components/scope-context";
import { coversEngland } from "@/lib/scope";
import { postcodeFromParam } from "@/lib/postcode-page";
import { loadSearchResults, noMatchMessage, searchResultHref } from "@/lib/postcode-search";

/**
 * Every unknown page (and every notFound()) answers here, still with its 404
 * status: the site header, a search that leads to real pages, the way back
 * to the map and the guide. A postcode nobody knows is named in plain words.
 */
export function NotFoundView() {
  const pathname = usePathname() ?? "";
  const postcode = /^\/postcode\/([^/]+)/.exec(pathname);
  const asked = postcode ? postcodeFromParam(postcode[1]) : null;
  return (
    <main className="status-page" data-testid="not-found-page">
      <SiteHeader />
      <h1>{asked ? `We can't find ${asked}` : "We can't find that page"}</h1>
      <p className="status-page__lead">
        {asked
          ? "Check the postcode, or search for a street or area name instead."
          : "The link may be old or mistyped. Search for a postcode, street or area, or go back to the map."}
      </p>
      <PageSearch />
      <nav className="status-page__actions" aria-label="Ways on">
        <Link className="status-button status-button--primary" href="/" data-testid="not-found-map">
          <KnitIcon name="arrow-left" colour="currentColor" className="knit-glyph" /> Back to the map
        </Link>
        <Link className="status-button" href="/guide">Guide</Link>
      </nav>
      <CoverageNote />
    </main>
  );
}

/** Where the map goes (FLAGS.md CLOSE_KNIT_ENGLAND): Greater London, or England with the flag on. */
function CoverageNote() {
  const england = coversEngland(useScope());
  return (
    <p className="status-page__note" data-testid="not-found-coverage">
      We cover {england ? "England" : "Greater London"}. Places outside it are not on the map yet.
    </p>
  );
}

/** A small search off the map: results are links to the postcode, home or area page. */
function PageSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadSearchResults(query, controller).then((next) => {
        if (!controller.signal.aborted) setResults(next.slice(0, 8));
      }).catch(() => setResults([]));
    }, 150);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);
  return (
    <form className="status-search" role="search" onSubmit={(event) => {
      event.preventDefault();
      const first = results?.[0];
      if (first) window.location.assign(searchResultHref(first));
    }}>
      <label htmlFor="not-found-search">Search postcode, street or area</label>
      <input id="not-found-search" type="search" value={query} autoComplete="off"
        placeholder="e.g. N1 0AA or Baker Street" onChange={(event) => setQuery(event.target.value)} />
      {results && results.length > 0 && (
        <ul className="status-search__results" aria-label="Matching places" data-testid="not-found-results">
          {results.map((result) => (
            <li key={result.id}>
              <Link href={searchResultHref(result)}><strong>{result.label}</strong><span>{result.secondaryLabel}</span></Link>
            </li>
          ))}
        </ul>
      )}
      <p className="status-search__empty" role="status">
        {results && results.length === 0 ? noMatchMessage(query) : ""}
      </p>
    </form>
  );
}
