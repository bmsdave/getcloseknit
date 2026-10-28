"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { GeographyId, MatchPack, MatchResult, PreferenceProfile } from "@/lib/contracts";
import type { DataMode, MatchList } from "@/lib/map-state";
import { friendlyName, matchRows } from "@/lib/match-brief";
import { areasLeft, moves, searchKey, type SearchItem } from "@/lib/match-search";
import { sinkParts, tieNote, whyParts, type Mark, type WhyPart } from "@/lib/match-words";

import { SaveAreaButton } from "../area-save-actions";
import { KnitIcon } from "../knit/knit-icon";
import { useBestValue } from "./use-best-value";

export type MatchSort = "score" | "best-value";

interface MatchResultsProps {
  pack: MatchPack;
  items: readonly SearchItem[];
  profile: PreferenceProfile;
  selected: GeographyId | null;
  onSelect: (id: GeographyId) => void;
  onHover?: (id: GeographyId | null) => void;
  /** Top 10 | Bottom 10 (MapState.matchList): the map pins the same ten. */
  list: MatchList;
  onList: (list: MatchList) => void;
  compared: GeographyId[];
  onToggleCompare: (id: GeographyId) => void;
  mode: DataMode;
  release: string;
}

const MARK_ICON: Record<Mark, string | null> = { in: null, edge: null, out: "cross", none: null };

/**
 * The ten areas the search puts first, or the ten least like it: one switch, the map pins the
 * same ten. Each top row says why in the household's priority order and shows ▲▼ after a reorder; a bottom row
 * names the criteria that sink it. "Best value" re-sorts the matches by the area's typical price against areas with
 * similar scores (an area figure, never a value for one home).
 */
export function MatchResults(props: MatchResultsProps) {
  const { pack, items, profile, list } = props;
  // Best value only when some area has 20+ sales to compare (the API's valueAreas; the preview never has).
  const valueShown = (pack.valueAreas ?? 0) > 0;
  const [chosenSort, setSort] = useState<MatchSort>("score");
  const sort: MatchSort = valueShown ? chosenSort : "score";
  const value = useBestValue(profile, props.mode, props.release, sort === "best-value" && list === "top");
  const left = areasLeft(pack).left;
  // The same ten the map pins (matchRows): one row per name, in the precise rank.
  const top = useMemo(() => matchRows(pack, profile, "top"), [pack, profile]);
  const bottom = useMemo(() => matchRows(pack, profile, "bottom"), [pack, profile]);
  const valued = useMemo(() => valueRows(value.pack, pack), [value.pack, pack]);
  const rows = list === "bottom" ? bottom : sort === "best-value" && valued.length ? valued : top;
  const arrows = useReorderMoves(items, top.map((result) => result.geographyId), searchKey(profile));
  // Equal scores in the ten shown (every area inside every range scores 100): the order comes from #1's value,
  // then #2's, so say so over the rows and lead each tied row with those values.
  const ranked = list === "top" && sort === "score";
  const scoreCounts = new Map<number, number>();
  if (ranked) for (const result of rows) if (result.score !== null) scoreCounts.set(result.score, (scoreCounts.get(result.score) ?? 0) + 1);
  const isTied = (result: MatchResult) => result.score !== null && (scoreCounts.get(result.score) ?? 0) > 1;
  const tieLine = ranked ? tieNote(rows.map((result) => result.score), items) : null;
  return (
    <section className="match-results" data-testid="match-results" aria-labelledby="match-results-title" id="match-results">
      <div className="match-results__head">
        <h3 id="match-results-title" className="match-results__title">
          {list === "bottom" ? "Least like your search" : `Top 10 of ${left.toLocaleString("en-GB")}`}
        </h3>
        <div className="match-toggle" role="group" aria-label="Which ten">
          <button type="button" aria-pressed={list === "top"} onClick={() => props.onList("top")} data-testid="match-list-top">Top 10</button>
          <button type="button" aria-pressed={list === "bottom"} onClick={() => props.onList("bottom")} data-testid="match-list-bottom">Bottom 10</button>
        </div>
      </div>
      {list === "top" && valueShown && (
        <div className="match-toggle match-toggle--quiet" role="group" aria-label="Sort" data-testid="match-sort">
          <button type="button" aria-pressed={sort === "score"} onClick={() => setSort("score")}>Best match</button>
          <button type="button" aria-pressed={sort === "best-value"} onClick={() => setSort("best-value")} data-testid="match-sort-value">Best value</button>
        </div>
      )}
      {list === "top" && sort === "best-value" && value.status === "none" && (
        <p className="match-results__note" role="status" data-testid="best-value-none">Not enough sales here to compare value.</p>
      )}
      {list === "bottom" && <p className="match-results__note">Not bad areas: the same place can top someone else&rsquo;s list.</p>}
      {list === "top" && props.compared.length === 0 && rows.length > 1 && (
        <p className="match-tray-hint" data-testid="compare-hint">Tick to compare</p>
      )}
      {tieLine && rows.length > 1 && <p className="match-results__note" data-testid="match-tie-note">{tieLine}</p>}
      {rows.length === 0 ? (
        <p className="match-results__note" role="status" data-testid="match-results-empty">No area fits yet: soften a criterion above.</p>
      ) : (
        <ol className="match-rows" data-testid={list === "bottom" ? "match-bottom" : "match-top"}>
          {rows.map((result, index) => {
            const name = friendlyName(result);
            const active = result.geographyId === props.selected;
            const tied = ranked && isTied(result);
            const parts = list === "bottom" ? sinkParts(result, items, profile) : whyParts(result, items, profile, tied);
            const moved = list === "top" && sort === "score" ? arrows.get(result.geographyId) : undefined;
            const valueLine = sort === "best-value" && list === "top" ? valueWords(result) : null;
            return (
              <li key={result.geographyId} className={`match-row${list === "bottom" ? " match-row--bottom" : ""}`} data-testid="match-row" data-id={result.geographyId}>
                <button type="button" className="match-row__main" aria-pressed={active} onClick={() => props.onSelect(result.geographyId)}
                  onMouseEnter={() => props.onHover?.(result.geographyId)} onMouseLeave={() => props.onHover?.(null)}
                  onFocus={() => props.onHover?.(result.geographyId)} onBlur={() => props.onHover?.(null)}>
                  <span className="match-row__rank" aria-label={list === "bottom" ? `Bottom ${index + 1}` : `Rank ${index + 1}`}>
                    {list === "bottom" ? `−${index + 1}` : index + 1}
                  </span>
                  <span className="match-row__text">
                    <span className="match-row__name">{name}</span>
                    {valueLine ? <span className="match-row__why" data-testid="match-row-value">{valueLine}</span>
                      : parts.length > 0 && <WhyLine parts={parts} />}
                  </span>
                  {moved !== undefined && (
                    <span className={`match-row__move match-row__move--${moved > 0 ? "up" : "down"}`} data-testid="match-row-move"
                      aria-label={moved > 0 ? `Up ${moved}` : `Down ${-moved}`}>{moved > 0 ? "▲" : "▼"}{Math.abs(moved)}</span>
                  )}
                  <span className="match-row__score" data-testid="match-score" data-tied={tied || undefined}
                    aria-label={`Score ${result.score ?? "—"} of 100${tied ? ", tied" : ""}`}>
                    {result.score ?? "—"}
                  </span>
                </button>
                <SaveAreaButton geographyId={result.geographyId} name={name} mode={props.mode} release={props.release} profile={profile}
                  testId="match-row-save" />
                {list === "top" && (
                  <button type="button" role="checkbox" className="compare-toggle" aria-checked={props.compared.includes(result.geographyId)}
                    aria-label={`Compare ${name}`} onClick={() => props.onToggleCompare(result.geographyId)}>
                    <span aria-hidden="true" className="compare-box">
                      {props.compared.includes(result.geographyId) ? <KnitIcon name="check" colour="currentColor" className="knit-glyph" style={{ width: 13, height: 13 }} /> : null}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function WhyLine({ parts }: { parts: WhyPart[] }) {
  return (
    <span className="match-row__why" data-testid="match-row-why">
      {parts.map((part, index) => (
        <span key={part.id} className={`match-why match-why--${part.mark}`}>
          {index > 0 && " · "}
          {part.mark === "edge" && <b aria-hidden="true">≈ </b>}
          {MARK_ICON[part.mark] && <KnitIcon name={MARK_ICON[part.mark]!} colour="currentColor" className="knit-inline" style={{ width: 11, height: 11 }} />}
          <span className="sr-only">{part.mark === "edge" ? "on the edge: " : part.mark === "out" ? "out: " : part.mark === "none" ? "not scored: " : ""}</span>
          {part.text}
        </span>
      ))}
    </span>
  );
}

/** The matches by value (the API's sort=best-value), names and scores from the pack on screen. */
function valueRows(valuePack: MatchPack | null, pack: MatchPack): MatchResult[] {
  if (!valuePack) return [];
  const live = new Map(pack.values.map((result) => [result.geographyId, result]));
  return valuePack.values.filter((result) => result.value && result.valueRank !== null && result.valueRank !== undefined && live.has(result.geographyId))
    .sort((a, b) => (a.valueRank ?? Infinity) - (b.valueRank ?? Infinity)).slice(0, 10)
    .map((result) => ({ ...live.get(result.geographyId)!, value: result.value, valueRank: result.valueRank }));
}

/** "18% below areas like it", "on par", "4% above": the area's typical price against areas with similar scores. */
function valueWords(result: MatchResult): string | null {
  const value = result.value;
  if (!value) return null;
  const percent = Math.round(value.valuePercent);
  if (Math.abs(percent) < 1) return `match ${result.score ?? "—"} · on par with areas like it`;
  return `match ${result.score ?? "—"} · ${Math.abs(percent)}% ${percent < 0 ? "below" : "above"} areas like it`;
}

/**
 * ▲▼ on the top ten after the household reorders (21d frame 3): the ten as they were before the last order change
 * against the ten now, kept until the next change of order.
 */
function useReorderMoves(items: readonly SearchItem[], ids: GeographyId[], searchKey: string): Map<GeographyId, number> {
  const orderKey = items.filter((item) => !item.must).map((item) => item.id).join("|");
  const state = useRef<{ order: string; search: string; settled: GeographyId[]; before: GeographyId[] | null }>(
    { order: orderKey, search: searchKey, settled: ids, before: null });
  const [arrows, setArrows] = useState<Map<GeographyId, number>>(new Map());
  const idsKey = ids.join("|");
  useEffect(() => {
    const current = state.current;
    if (current.order !== orderKey) {
      // A reorder: the ten before it are what the arrows compare with.
      state.current = { order: orderKey, search: searchKey, settled: ids, before: current.settled };
    } else if (current.search !== searchKey) {
      // Any other change of the search: no arrows.
      state.current = { order: orderKey, search: searchKey, settled: ids, before: null };
    } else if (!current.before) {
      state.current = { ...current, settled: ids };
    }
    const before = state.current.before;
    setArrows(before ? moves(before, ids) : new Map());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, searchKey, idsKey]);
  return arrows;
}
