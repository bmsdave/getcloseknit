"use client";

import { useMemo, useState } from "react";

import { compareHref } from "@/lib/compare-table";
import { addCompared, toggleCompared, useComparedAreas } from "@/lib/compare-selection";
import type { GeographyId, MatchPack, PreferenceProfile } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { searchCriteria, searchKey } from "@/lib/match-search";
import { isUnsetProfile } from "@/lib/profile-state";
import { removeSavedHome, removeSavedItem, useSaved, type SavedHome, type SavedItem } from "@/lib/saved-items";
import { preTickedAreas, SAVED_BLOCKS, savedAreaMeta, type SavedBlock, type SavedFilter } from "@/lib/saved-panel";
import type { SinceLine } from "@/lib/saved-since";
import { PRICE_TILE_SOURCE } from "@/lib/standouts";
import {
  DEFAULT_SHORTLIST_NAME,
  deleteShortlist,
  encodeSharedShortlist,
  listShortlists,
  ownShortlistBriefHref,
  removeAreaFromShortlists,
} from "@/lib/saved-shortlists";
import { ShareReview } from "./share-review";
import { SaveHeart } from "./area-save-actions";
import { KnitIcon } from "./knit/knit-icon";
import { useSearchPack } from "./match/use-search-pack";
import { useShareLink } from "./match/share-link";
import { ShortlistRow } from "./shortlists";
import { useResolvedNames } from "./use-area-names";
import { useSavedPrices } from "./use-saved-prices";
import { useSavedSince, type SavedSince } from "./use-saved-since";
import "../styles/saved-panel.css";

interface Row {
  key: string;
  name: string;
  meta?: string;
  /** Where the line's figure comes from (an area's £/m²: the Price per m² layer). */
  metaTitle?: string;
  href?: string;
  /** An area: chosen on the map. */
  area?: GeographyId;
  /** A place with no page: the map goes to it. */
  at?: [number, number];
  /** An area: what changed since this device's last visit. */
  since?: SinceLine;
  unsave: () => void;
}

/** The search Saved scores areas with (CUJ03 step 1): the map's pack when it has one, else its own request. */
export interface SavedMatch {
  pack: MatchPack | null;
  profile: PreferenceProfile;
  mode: DataMode;
  release: string;
}

/** Each saved area's My match score (0–100, null when out); empty with no search. */
function useSavedScores(match: SavedMatch | undefined): Record<string, number | null> {
  const searching = Boolean(match && !isUnsetProfile(match.profile) && searchCriteria(match.profile).length > 0);
  // The map already has the pack on My match; elsewhere Saved asks once, as the map would (searchKey).
  const body = match && searching && !match.pack ? searchKey(match.profile) : null;
  const fetched = useSearchPack(body, match?.mode ?? "demo", match?.release ?? "demo");
  const pack = searching ? match?.pack ?? (fetched === "failed" ? null : fetched) : null;
  return useMemo(() => Object.fromEntries((pack?.values ?? []).map((result) => [result.geographyId, result.excluded ? null : result.score])), [pack]);
}

/**
 * ♡ Saved (Saved v2): everything saved on this device, with no My match needed. Chips All · Areas · Homes ·
 * Schools · Places over one block per kind; "On map" shows each as a ♡ on the map. Areas have a tick box and,
 * with a search, their match score; "Compare · N" compares the ticked areas only (CUJ03 step 1), and with none ticked
 * Saved opens with the best two ticked (♡ → Compare · 2, two taps). Schools and homes
 * compare from their block heading (never mixed, never cafés or gyms). Named shortlists (a shared brief's Save all)
 * follow the areas: Open, Share, Delete; the automatic "My shortlist" is the Areas block itself, not listed twice.
 */
export function SavedPanel({ onClose, onMap, onToggleMap, onSelectArea, onShowPoint, match }: {
  onClose: () => void;
  onMap: boolean;
  onToggleMap: (on: boolean) => void;
  onSelectArea: (id: GeographyId) => void;
  onShowPoint: (at: [number, number]) => void;
  match?: SavedMatch;
}) {
  const saved = useSaved();
  const [filter, setFilter] = useState<SavedFilter>("all");
  // Re-read with every save (the snapshot is new on each write).
  const shortlists = useMemo(() => (saved.areas.length ? listShortlists().shortlists : [])
    .filter((entry) => entry.name !== DEFAULT_SHORTLIST_NAME), [saved]);
  const shared = useShareLink("anyone with it sees these areas and only what you included");
  // The shortlist whose share is being reviewed (no link is made before Confirm share).
  const [reviewing, setReviewing] = useState<string | null>(null);
  // Areas saved before v4 kept their code as the name ("Haringey 019A"): show today's name.
  const areaIds = useMemo(() => saved.areas.map((area) => area.geographyId), [saved]);
  const storedNames = useMemo(() => Object.fromEntries(saved.areas.map((area) => [area.geographyId, area.name])), [saved]);
  const areaNames = useResolvedNames(areaIds, storedNames);
  const since = useSavedSince(areaIds);
  const prices = useSavedPrices(areaIds, match?.mode ?? "demo");
  const scores = useSavedScores(match);
  // The ticks are the map's compared areas (one set: the tray, the map and Saved agree).
  const compared = useComparedAreas();
  const own = areaIds.filter((id) => compared.includes(id));
  const [full, setFull] = useState(false);
  // CUJ14 board, 2 taps: with none of them in the comparison, Saved shows the best two ticked and Compare · 2
  // ready. They are only shown: the shared tray stays as it was until the visitor ticks or unticks a box (the shown
  // two join it first), so opening Saved never fills the tray over the map. Once touched, the ticks are the tray's.
  const [touched, setTouched] = useState(false);
  const shown = useMemo(() => preTickedAreas(areaIds, scores), [areaIds, scores]);
  const ticked = own.length > 0 || touched ? own : shown;
  const rows = useMemo(() => blockRows({
    ...saved, areas: saved.areas.map((area) => ({ ...area, name: areaNames[area.geographyId] ?? area.name })),
  }, since, prices), [saved, areaNames, since, prices]);
  const blocks = SAVED_BLOCKS.filter((block) => rows[block.id].length > 0 && (filter === "all" || filter === block.id));

  function compare(block: SavedBlock) {
    if (!block.compare) return;
    // Comparing the shown two puts them in the tray, as ticking them would (they wait on the map afterwards).
    if (block.id === "areas" && ticked === shown) for (const id of shown) addCompared(id as GeographyId);
    const ids = block.id === "areas" ? ticked
      : block.id === "homes" ? saved.homes.flatMap((home) => (home.uprn ? [home.uprn] : []))
        : saved.items.filter((item) => item.kind === block.kind).map((item) => item.id);
    window.location.assign(compareHref(block.compare, ids));
  }

  function tick(id: GeographyId) {
    if (own.length === 0 && !touched) for (const shownId of shown) addCompared(shownId as GeographyId);
    setTouched(true);
    setFull(toggleCompared(id).refused !== null);
  }

  return (
    <section className="saved-panel evidence-panel" data-testid="saved-panel" aria-labelledby="saved-panel-title">
      {/* "Saved" alone: the count is in ♡ N beside it and on each chip (no second "· 3" to wrap). */}
      <header className="saved-panel__head">
        <h2 id="saved-panel-title">Saved</h2>
        <button type="button" className="chip-button saved-panel__switch" role="switch" aria-checked={onMap} data-testid="saved-on-map"
          onClick={() => onToggleMap(!onMap)}>
          <span className="saved-panel__track" aria-hidden="true"><span /></span> On map
        </button>
        <button type="button" className="saved-panel__close" data-testid="saved-close" aria-label="Close Saved" onClick={onClose}>
          <KnitIcon name="cross" className="knit-glyph" style={{ width: 16, height: 16 }} />
        </button>
      </header>
      {saved.count === 0 ? (
        <p className="saved-panel__empty" data-testid="saved-empty">
          Nothing saved yet. Tap <SaveHeart filled={false} size={14} /> on an area, home, school or place.
        </p>
      ) : (
        <>
          <div className="saved-panel__chips" role="group" aria-label="Show">
            {[{ id: "all" as const, label: "All", n: null }, ...SAVED_BLOCKS.filter((block) => rows[block.id].length > 0)
              .map((block) => ({ id: block.id, label: block.label, n: rows[block.id].length }))].map((chip) => (
              <button key={chip.id} type="button" className="chip-button" aria-pressed={filter === chip.id} data-testid={`saved-filter-${chip.id}`}
                onClick={() => setFilter(chip.id)}>
                {chip.label}{chip.n !== null && <span className="saved-panel__n">{chip.n}</span>}
              </button>
            ))}
          </div>
          {blocks.map((block) => {
            const areas = block.id === "areas";
            return (
              <section key={block.id} className="saved-block" data-testid={`saved-block-${block.id}`} aria-labelledby={`saved-${block.id}`}>
                <div className="saved-block__head">
                  <h3 id={`saved-${block.id}`}>{block.label}</h3>
                  {!areas && block.compare && rows[block.id].length >= 2 && (
                    <button type="button" className="link-button saved-block__compare" data-testid={`saved-compare-${block.id}`}
                      onClick={() => compare(block)}>Compare</button>
                  )}
                  {areas && rows.areas.length >= 2 && ticked.length < 2 && (
                    <span className="saved-block__hint" data-testid="saved-tick-hint">Tick two to compare</span>
                  )}
                </div>
                <ul className="saved-rows">
                  {rows[block.id].map((row) => (
                    <li key={row.key} className="saved-row" data-testid="saved-row" data-area={row.area}>
                      {row.area && (
                        <label className="saved-row__tick">
                          <input type="checkbox" checked={ticked.includes(row.area)} data-testid="saved-row-tick"
                            aria-label={`Compare ${row.name}`} onChange={() => tick(row.area!)} />
                        </label>
                      )}
                      <SavedRowName row={row} onSelectArea={onSelectArea} onShowPoint={onShowPoint} />
                      {row.area && typeof scores[row.area] === "number" && (
                        <span className="saved-row__score" data-testid="saved-row-score" title="My match score">{scores[row.area]}</span>
                      )}
                      <button type="button" className="save-heart" aria-pressed="true" aria-label={`Save ${row.name}`} title="Saved"
                        data-testid="saved-row-unsave" onClick={row.unsave}>
                        <SaveHeart filled />
                      </button>
                    </li>
                  ))}
                </ul>
                {areas && full && <p className="saved-block__hint" role="status">Compare takes four at most: untick one first.</p>}
                {areas && ticked.length >= 2 && (
                  <button type="button" className="primary-action saved-block__compare-ticked" data-testid="saved-compare-areas"
                    onClick={() => compare(block)}>
                    Compare · {ticked.length}
                  </button>
                )}
              </section>
            );
          })}
          {(filter === "all" || filter === "areas") && shortlists.length > 0 && (
            <section className="saved-block" data-testid="saved-block-shortlists" aria-labelledby="saved-shortlists-title">
              <div className="saved-block__head"><h3 id="saved-shortlists-title">Shortlists</h3></div>
              <ul className="shortlist-list">
                {shortlists.map((entry) => (
                  <ShortlistRow key={entry.id} entry={entry}
                    onOpen={() => {
                      // Your own brief: the link is redacted, the full search stays on this device.
                      const href = ownShortlistBriefHref(entry);
                      if (href) window.location.assign(href);
                    }}
                    onShare={() => setReviewing(entry.id)}
                    onDelete={() => deleteShortlist(entry.id)} />
                ))}
              </ul>
              {(() => {
                const entry = shortlists.find((item) => item.id === reviewing);
                return entry ? (
                  <ShareReview profile={entry.profile} notes={Boolean(entry.notes)}
                    candidates={entry.candidates.map((id) => areaNames[id] ?? entry.candidateNames[id] ?? id)}
                    onCancel={() => setReviewing(null)}
                    onConfirm={(inclusions) => {
                      setReviewing(null);
                      void shared.share(`${window.location.origin}/brief${encodeSharedShortlist(entry, inclusions)}`, entry.name);
                    }} />
                ) : null;
              })()}
              {shared.status}
            </section>
          )}
        </>
      )}
    </section>
  );
}

function SavedRowName({ row, onSelectArea, onShowPoint }: {
  row: Row;
  onSelectArea: (id: GeographyId) => void;
  onShowPoint: (at: [number, number]) => void;
}) {
  const text = (
    <>
      <span className="saved-row__name">{row.name}</span>
      {row.meta && <small className="saved-row__meta" title={row.metaTitle} data-testid="saved-row-meta">{row.meta}</small>}
      {row.since && (
        <small className="saved-row__since" data-changed={row.since.changed || undefined} data-testid="saved-row-since">{row.since.text}</small>
      )}
    </>
  );
  if (row.href) return <a className="saved-row__main" href={row.href}>{text}</a>;
  const go = row.area ? () => onSelectArea(row.area!) : row.at ? () => onShowPoint(row.at!) : null;
  return go
    ? <button type="button" className="saved-row__main" onClick={go}>{text}</button>
    : <span className="saved-row__main">{text}</span>;
}

/** Each block's rows, newest first. */
function blockRows({ areas, homes, items }: {
  areas: { geographyId: GeographyId; name: string }[]; homes: SavedHome[]; items: SavedItem[];
}, since: SavedSince, prices: Record<string, string>): Record<SavedBlock["id"], Row[]> {
  const itemRows = (kind: SavedItem["kind"]) => items.filter((item) => item.kind === kind).map((item): Row => ({
    key: `${item.kind}:${item.id}`, name: item.name, meta: item.meta, href: item.href, at: item.at,
    unsave: () => removeSavedItem(item.kind, item.id),
  }));
  return {
    areas: areas.map((area) => ({
      key: area.geographyId, name: area.name, area: area.geographyId,
      meta: savedAreaMeta(area.geographyId, prices[area.geographyId]), metaTitle: prices[area.geographyId] ? PRICE_TILE_SOURCE : undefined,
      since: since.lines[area.geographyId],
      unsave: () => removeAreaFromShortlists(area.geographyId),
    })),
    homes: homes.map((home) => ({ key: `home:${home.id}`, name: home.name, href: home.href, unsave: () => removeSavedHome(home.id) })),
    schools: itemRows("school"),
    places: itemRows("place"),
  };
}
