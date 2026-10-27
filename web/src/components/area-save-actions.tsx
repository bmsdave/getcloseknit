"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { addCompared, removeCompared, useComparedAreas, MAX_COMPARE } from "@/lib/compare-selection";
import { compareHref } from "@/lib/compare-table";
import type { GeographyId, PreferenceProfile } from "@/lib/contracts";
import { DEFAULT_PROFILE } from "@/lib/fixtures";
import type { DataMode } from "@/lib/map-state";
import { findLikeHref, loadLocalProfile } from "@/lib/profile-state";
import { useSaved } from "@/lib/saved-items";
import { removeAreaFromShortlists, saveAreaToShortlist, type SaveAreaResult } from "@/lib/saved-shortlists";
import { THREAD_ICONS } from "@/lib/thread-icons";
import { checkHomeHref, searchBudgetPrefill } from "@/lib/tools";
import { KnitIcon } from "./knit/knit-icon";
import { WatchListings } from "./watch-listings";

interface AreaSaveActionsProps {
  /** "lsoa", "msoa" or "borough", as in /area/<carrier>/<code>. */
  carrier: string;
  code: string;
  /** The name people use ("Highbury · N5"), as the page heading shows it. */
  name: string;
  /** The map's evidence panel: shorter words, the same actions. */
  compact?: boolean;
  /** The ♡ leads the row; false when it sits elsewhere (the map panel's header). */
  heart?: boolean;
  /** The data the page shows, recorded with a saved shortlist. */
  mode: DataMode;
  release: string;
}

const mark = (name: string) => <KnitIcon name={name} colour="var(--icon-yarn, currentColor)" className="knit-inline" style={{ width: 14, height: 14 }} />;

/**
 * One entry per feature: the next steps from an area. ♡ saves it (the only save),
 * Watch, Add to compare (the "Compare · N" tray, with an Open compare link) and, on the map's area
 * card, Like this (My match, starting from this area); the full page has Like this in What's next ›
 * Nearby. Nothing is stored until one of them is pressed; each answers in words (role=status).
 */
/** Compare for one area, answered in words (shared by the map panel's row and the area page's); ♡ is SaveAreaButton. */
function useAreaCompare({ carrier, code, name }: Pick<AreaSaveActionsProps, "carrier" | "code" | "name">) {
  const geographyId = `uk:${carrier}:${code}` as GeographyId;
  const compared = useComparedAreas();
  const inCompare = compared.includes(geographyId);
  const [notice, setNotice] = useState<string | null>(null);
  function toggleCompare() {
    if (inCompare) {
      removeCompared(geographyId);
      setNotice(`${name} left the comparison.`);
      return;
    }
    const result = addCompared(geographyId);
    setNotice(result.refused
      ? `Comparison holds ${MAX_COMPARE} areas. Remove one on the map to add ${name}.`
      : `Added to compare (${result.ids.length} of ${MAX_COMPARE}).`);
  }
  return { geographyId, comparable: carrier === "lsoa", compared, inCompare, notice, toggleCompare };
}

/** The status line under either row: what was done, with Open compare once two areas are in. */
function ActionsStatus({ notice, inCompare, compared }: { notice: string | null; inCompare: boolean; compared: GeographyId[] }) {
  return (
    <p className="area-save-actions__status" role="status">
      {notice}
      {notice && inCompare && compared.length >= 2 && <> <Link href={compareHref("places", compared)} data-testid="open-compare">Open compare</Link></>}
    </p>
  );
}

/**
 * The area page's one row: ♡ · Compare · On map · ⋯, with Watch, the evidence pack
 * and the chosen home's page in ⋯. Like this is What's next › Nearby, the page's one entry.
 */
export function AreaPageActions({ mapHref, packHref, homeHref, compareLink = null, similarHref = null, watchLabel = "Watch", ...props }:
  Omit<AreaSaveActionsProps, "compact"> & {
    mapHref: string; packHref: string | null; homeHref: string | null;
    /** A borough: Compare opens the compare page with it, as the map's selection holds neighbourhoods only. */
    compareLink?: string | null;
    /** A borough: Find similar (My match, starting from its typical neighbourhood) in ⋯. */
    similarHref?: string | null;
    watchLabel?: string;
  }) {
  const { geographyId, comparable, compared, inCompare, notice, toggleCompare } = useAreaCompare(props);
  return (
    <div className="area-save-actions area-page-actions" data-testid="area-save-actions">
      <div className="area-save-actions__row" role="group" aria-label={`Next steps for ${props.name}`}>
        <SaveAreaButton geographyId={geographyId} name={props.name} mode={props.mode} release={props.release} testId="save-area" />
        {comparable && (
          <button type="button" className="area-save-actions__button" data-testid="add-to-compare" aria-pressed={inCompare} onClick={toggleCompare}
            aria-label={inCompare ? `In compare (${compared.length})` : "Add to compare"}>
            {mark(inCompare ? "check" : "swap")} Compare
          </button>
        )}
        {!comparable && compareLink && (
          <Link className="area-save-actions__button" href={compareLink} data-testid="area-compare-link">{mark("swap")} Compare</Link>
        )}
        <Link className="area-full__primary" href={mapHref} data-testid="open-on-map">On map</Link>
        <details className="area-full__more-menu area-page-actions__more" data-testid="area-more-menu">
          <summary aria-label="More">⋯</summary>
          <div className="area-full__menu">
            <WatchListings place={props.name} className="area-full__menu-item" label={watchLabel} />
            {similarHref && <a className="area-full__menu-item" href={similarHref} data-testid="area-find-similar">Find similar</a>}
            {packHref && <Link className="area-full__menu-item" href={packHref} data-testid="area-pack-link">Evidence pack</Link>}
            {homeHref && <Link className="area-full__menu-item" href={homeHref} data-testid="area-home-page">Home page</Link>}
          </div>
        </details>
      </div>
      <ActionsStatus notice={notice} inCompare={inCompare} compared={compared} />
    </div>
  );
}

/**
 * The map's area view footer row (CUJ12/CUJ06 boards): Compare · Like this · Check a home, over "Open full
 * area page", at every sheet height. ♡ and Watch are in the view's header. A neighbourhood's only.
 */
export function AreaPanelActions({ geographyId, name, uprn }: { geographyId: GeographyId; name: string; uprn: string | null }) {
  const code = geographyId.slice("uk:lsoa:".length);
  const { compared, inCompare, notice, toggleCompare } = useAreaCompare({ carrier: "lsoa", code, name });
  // From the My match budget when the household set one to buy, else the check starts empty.
  const [budget, setBudget] = useState<ReturnType<typeof searchBudgetPrefill>>(null);
  // Read after hydration: the server render has no saved search.
  useEffect(() => setBudget(searchBudgetPrefill(loadLocalProfile(DEFAULT_PROFILE))), []);
  return (
    <div className="area-save-actions area-save-actions--compact area-panel-actions" data-testid="area-save-actions">
      <div className="area-save-actions__row" role="group" aria-label={`Next steps for ${name}`}>
        <button type="button" className="area-save-actions__button" data-testid="add-to-compare" aria-pressed={inCompare} onClick={toggleCompare}>
          {mark(inCompare ? "check" : "swap")} {inCompare ? `In compare (${compared.length})` : "Compare"}
        </button>
        <Link className="area-save-actions__button" href={findLikeHref(geographyId)} data-testid="find-like">
          {mark("search")} Like this
        </Link>
        <Link className="area-save-actions__button" href={checkHomeHref({ area: geographyId, uprn, ...budget })} data-testid="panel-check-home">
          Check a home
        </Link>
      </div>
      <ActionsStatus notice={notice} inCompare={inCompare} compared={compared} />
    </div>
  );
}

export function AreaSaveActions({ carrier, code, name, compact = false, heart = true, mode, release }: AreaSaveActionsProps) {
  const { geographyId, comparable, compared, inCompare, notice, toggleCompare } = useAreaCompare({ carrier, code, name });
  return (
    <div className={`area-save-actions${compact ? " area-save-actions--compact" : ""}`} data-testid="area-save-actions">
      <div className="area-save-actions__row" role="group" aria-label={`Next steps for ${name}`}>
        {heart && <SaveAreaButton geographyId={geographyId} name={name} mode={mode} release={release} testId="save-area" />}
        <WatchListings place={name} className="area-save-actions__button" label={compact ? "Watch" : <>
          <span className="area-save-actions__long">Watch new listings</span>
          <span className="area-save-actions__short">Watch</span>
        </>} />
        {comparable && (
          <button type="button" className="area-save-actions__button" data-testid="add-to-compare" aria-pressed={inCompare} onClick={toggleCompare}>
            {mark(inCompare ? "check" : "swap")} {inCompare ? `In compare (${compared.length})` : compact ? "Compare" : <>
              <span className="area-save-actions__long">Add to compare</span>
              <span className="area-save-actions__short">Compare</span>
            </>}
          </button>
        )}
        {comparable && compact && (
          <Link className="area-save-actions__button" href={findLikeHref(geographyId)} data-testid="find-like">
            {mark("search")} Like this
          </Link>
        )}
      </div>
      <ActionsStatus notice={notice} inCompare={inCompare} compared={compared} />
    </div>
  );
}

/** What a save answers, in words: where it went, or why it could not. */
function saveNotice(result: SaveAreaResult, name: string): string {
  if (result.ok) return result.already ? `${name} is already in “${result.shortlist.name}”.` : `Saved to “${result.shortlist.name}”.`;
  return result.reason === "full"
    ? `“${result.shortlist?.name}” holds four areas. Remove one from Saved first.`
    : result.reason === "storage-denied"
      ? "This browser is blocking storage, so the area could not be saved here."
      : "The area could not be saved.";
}

/**
 * G02: ♡ for an area on a My match row and the area card: an 18px outline heart, filled cherry
 * once the area is saved (in any shortlist); a second press unsaves it. Answers in a status line.
 */
export function SaveAreaButton({ geographyId, name, mode, release, profile, testId = "save-area-heart" }: {
  geographyId: GeographyId;
  name: string;
  mode: DataMode;
  release: string;
  /** The search saved with a new shortlist; this browser's own search when not given. */
  profile?: PreferenceProfile;
  testId?: string;
}) {
  const saved = useSaved().areas.some((area) => area.geographyId === geographyId);
  const [notice, setNotice] = useState<string | null>(null);
  function toggle() {
    if (saved) {
      const result = removeAreaFromShortlists(geographyId);
      setNotice(result.ok ? `${name} removed from Saved.` : "The area could not be removed here.");
      return;
    }
    const result = saveAreaToShortlist({ geographyId, name, profile: profile ?? loadLocalProfile(DEFAULT_PROFILE), mode, release });
    setNotice(result.ok ? `${name} saved.` : saveNotice(result, name));
  }
  return (
    <>
      <button type="button" className="save-heart" data-testid={testId} aria-pressed={saved} aria-label={`Save ${name}`}
        title={saved ? "Saved" : "Save"} onClick={toggle}>
        <SaveHeart filled={saved} />
      </button>
      <span className="sr-only" role="status">{notice}</span>
    </>
  );
}

/** The ♡ glyph: a muted yarn outline, or cherry felt inside a cherry yarn outline when saved (never an emoji). */
export function SaveHeart({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return (
    <span className="save-heart__glyph" aria-hidden="true" style={{ width: size, height: size }}>
      {filled && (
        <svg className="save-heart__felt" viewBox="0 0 24 24" focusable="false"><path d={THREAD_ICONS.heart} /></svg>
      )}
      <KnitIcon name="heart" colour={filled ? "var(--yarn-cherry)" : "var(--muted)"} className="save-heart__icon" />
    </span>
  );
}
