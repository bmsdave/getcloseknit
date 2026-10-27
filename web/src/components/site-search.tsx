"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { SearchResult } from "@/lib/fixtures";
import { kindOf, loadSearchResults, noMatchMessage, searchGroups, searchResultHref } from "@/lib/postcode-search";
import { track } from "@/lib/usage";
import { PHONE_QUERY } from "@/lib/viewport";

import { KnitIcon } from "./knit/knit-icon";

interface AreaSearch {
  query: string;
  results: SearchResult[];
  activeIndex: number;
  listId: string;
  open: boolean;
  /** The last finished search for the current text found nothing. */
  noMatch: boolean;
  setQuery: (query: string) => void;
  setActiveIndex: (index: number | ((current: number) => number)) => void;
  choose: (result: SearchResult) => void;
  /** Enter: take the highlighted (or first) result, now or when it loads. */
  submit: () => void;
  dismiss: () => void;
}

/**
 * The site's one Search (the map's top bar and every page's header): a small field
 * that finds postcodes, homes, areas, schools, stations and places, its results
 * grouped by kind in a keyboard listbox. A postcode, school or home row opens its
 * page; on the map (onSelect) an area, station or place is chosen there, and off
 * it opens its page or the map at that point. On phones the search opens as an
 * overlay over its bar (the bar hides the rest while data-searching); `collapsible`
 * shows it as a round Search button there until tapped.
 */
export function SiteSearch({ id, onSelect, onSearch, collapsible = false, placeholder = "Search" }: {
  /** The field's id (the map's is "area-search": the ≡ menu's Search focuses it). */
  id: string;
  /** The field's hint; the map's short layout says "Choose an area" here. Its label stays "Search". */
  placeholder?: string;
  onSelect?: (result: SearchResult) => void;
  /** The visitor started typing a search. */
  onSearch?: () => void;
  collapsible?: boolean;
}) {
  const search = useSiteSearch(onSelect);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const phone = useMedia(collapsible ? "(max-width: 640px)" : PHONE_QUERY);
  const [focused, setFocused] = useState(false);
  // collapsible: the round button was tapped, so the field shows until the search closes.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (wrap.current && !wrap.current.contains(event.target as Node)) search.dismiss();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [search]);
  useEffect(() => {
    if (expanded) input.current?.focus();
  }, [expanded]);
  // Phones: once there is something typed (or results), the search takes the whole bar as an overlay.
  const overlay = phone && (expanded || search.open || search.noMatch || (focused && search.query.trim() !== ""));
  function close() {
    search.dismiss();
    setFocused(false);
    setExpanded(false);
  }
  return (
    <div className="search-wrap" ref={wrap} data-searching={overlay} data-collapsible={collapsible}
      onBlur={(event) => {
        // Focus left the search (field, results and Cancel): it closes.
        if (wrap.current?.contains(event.relatedTarget as Node | null)) return;
        close();
      }}>
      {collapsible && (
        <button type="button" className="search-open" aria-label="Search" onClick={() => setExpanded(true)}>
          <KnitIcon name="search" colour="var(--icon-yarn, var(--ink))" style={{ width: 19, height: 19 }} />
        </button>
      )}
      <label className="sr-only" htmlFor={id}>Search</label>
      <KnitIcon name="search" colour="var(--icon-yarn, var(--ink))" className="search-ring" style={{ width: 14, height: 14 }} />
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-expanded={search.open}
        aria-controls={search.listId}
        aria-activedescendant={activeOptionId(search)}
        aria-autocomplete="list"
        value={search.query}
        onChange={(event) => {
          search.setQuery(event.target.value);
          if (event.target.value.trim()) onSearch?.();
        }}
        onKeyDown={(event) => onSearchKey(event, search)}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {search.open && (
        <p className="sr-only" role="status">
          {`${search.results.length} results. Use arrow keys to choose.`}
        </p>
      )}
      {search.open && <SearchResults search={search} />}
      {search.noMatch && (
        <p className="search-empty" role="status" data-testid="search-no-match">{noMatchMessage(search.query)}</p>
      )}
      {overlay && (
        <button type="button" className="search-cancel" onClick={() => { close(); input.current?.blur(); }}>
          Cancel
        </button>
      )}
    </div>
  );
}

/** The results, one group per kind under a short label; options keep one flat order for the arrow keys. */
function SearchResults({ search }: { search: AreaSearch }) {
  let index = -1;
  return (
    <div className="search-results" role="listbox" id={search.listId} aria-label="Search results">
      {/* The card clips (overflow: hidden) and this inner box scrolls: a scrolled list can never paint an empty
          block below the card over the map. */}
      <div className="search-results__scroll">
      {searchGroups(search.results).map((group) => {
        const labelId = `${search.listId}-${group.label}`;
        return (
          <div className="search-group" role="group" aria-labelledby={labelId} key={group.label}>
            <div className="search-group__label" id={labelId} role="presentation">{group.label}</div>
            {group.options.map((result) => {
              index += 1;
              const at = index;
              return (
                <button
                  type="button"
                  key={result.id}
                  id={optionId(search.listId, at)}
                  role="option"
                  aria-selected={at === search.activeIndex}
                  data-active={at === search.activeIndex}
                  onClick={() => search.choose(result)}
                  onMouseEnter={() => search.setActiveIndex(at)}
                >
                  <strong>{result.label}</strong><span>{result.secondaryLabel}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      </div>
    </div>
  );
}

/** Whether a media query matches (lib/viewport.ts has the layouts' queries); false on the server and the first render. */
export function useMedia(media: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(media);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [media]);
  return matches;
}

function useSiteSearch(onSelect: ((result: SearchResult) => void) | undefined): AreaSearch {
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const [noMatchFor, setNoMatchFor] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const liveQuery = useRef(query);
  liveQuery.current = query;
  // Enter pressed before the results arrived: choose the first one on arrival.
  const submitted = useRef<string | null>(null);
  useEffect(() => {
    if (committed !== null && query === committed) return;
    return debounceSearch(query, inflight, liveQuery, (next) => {
      const wanted = submitted.current === query;
      submitted.current = null;
      if (wanted && next.length > 0) return choose(next[0], next);
      setResults(next);
      setActiveIndex(next.length ? 0 : -1);
      setNoMatchFor(next.length || query.trim().length < 2 ? null : query);
    });
    // choose is recreated each render and only reads stable setters/props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, committed]);

  function choose(result: SearchResult, shown: SearchResult[] = results) {
    track("search", { ...searchDetails(result, query), results: shown.length, position: shown.indexOf(result) });
    if (result.href || !onSelect) {
      setResults([]);
      setActiveIndex(-1);
      // A full load: the map reads its query (a station's point) on boot, and the header
      // renders without the app router in tests.
      window.location.assign(searchResultHref(result));
      return;
    }
    onSelect(result);
    setCommitted(result.label);
    setQuery(result.label);
    setResults([]);
    setActiveIndex(-1);
  }

  function submit() {
    // A full postcode opens its page only once the search has confirmed it
    // (its row leads the list); an unknown one waits and says so, never a 404.
    const result = results[Math.max(activeIndex, 0)];
    if (result) choose(result);
    else if (query.trim().length >= 2) submitted.current = query;
  }

  function dismiss() {
    inflight.current?.abort();
    submitted.current = null;
    setResults([]);
    setActiveIndex(-1);
    setNoMatchFor(null);
  }

  // A query that still finds nothing a moment after typing stopped, once: kept (masked) to improve search.
  useEffect(() => {
    if (noMatchFor === null) return;
    const timeout = window.setTimeout(() => track("search_empty", { query: noMatchFor }), 1500);
    return () => window.clearTimeout(timeout);
  }, [noMatchFor]);

  return {
    query, results, activeIndex, listId,
    open: results.length > 0,
    noMatch: noMatchFor !== null && noMatchFor === query,
    setQuery, setActiveIndex, choose, submit, dismiss,
  };
}

function debounceSearch(
  query: string,
  inflight: { current: AbortController | null },
  liveQuery: { current: string },
  onResults: (results: SearchResult[]) => void,
) {
  if (query.trim().length < 2) {
    onResults([]);
    return;
  }
  const controller = new AbortController();
  inflight.current = controller;
  const timeout = window.setTimeout(() => {
    void loadSearchResults(query, controller, { everything: true }).then((next) => {
      if (controller.signal.aborted || query !== liveQuery.current) return;
      onResults(next);
    });
  }, 120);
  return () => {
    window.clearTimeout(timeout);
    controller.abort();
  };
}

function onSearchKey(event: React.KeyboardEvent, search: AreaSearch) {
  if (event.key === "ArrowDown" && search.open) {
    event.preventDefault();
    search.setActiveIndex((index) => (index + 1) % search.results.length);
  } else if (event.key === "ArrowUp" && search.open) {
    event.preventDefault();
    search.setActiveIndex((index) => (index - 1 + search.results.length) % search.results.length);
  } else if (event.key === "Enter") {
    event.preventDefault();
    search.submit();
  } else if (event.key === "Escape" && search.open) {
    event.preventDefault();
    search.dismiss();
  }
}

function activeOptionId(search: AreaSearch): string | undefined {
  if (!search.open || search.activeIndex < 0) return undefined;
  return optionId(search.listId, search.activeIndex);
}

function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

const DISTRICT = /\b([A-Z]{1,2}\d[A-Z\d]?) ?\d[A-Z]{2}\b/;

/**
 * A chosen search result for usage: what was typed (the API keeps words and a postcode's district, never a
 * house number), the kind, and the place: an area by its id and name; a home, street or postcode only by
 * its postcode district, never the address.
 */
function searchDetails(result: SearchResult, query: string) {
  const kind = resultKind(result);
  const district = DISTRICT.exec(`${result.label} ${result.secondaryLabel ?? ""}`.toUpperCase())?.[1] ?? null;
  const area = kind === "home" ? null : result.geographyId;
  const label = ["lsoa", "msoa", "borough"].includes(kind) ? result.label : null;
  return { kind, query, area, label, district };
}

/** What kind of result was chosen: a home, a street or postcode page, a school, station or place, or an area by its level. */
function resultKind(result: SearchResult): string {
  if (result.uprn || result.addressId) return "home";
  const kind = kindOf(result);
  if (kind === "station" || kind === "place") return kind;
  if (result.href) return result.href.split("/")[1] || "page";
  const level = result.geographyId.split(":")[1];
  return level === "lad" ? "borough" : level ?? "area";  // analytics keep "borough" for a LAD
}
