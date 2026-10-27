"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { DEFAULT_PROFILE } from "@/lib/fixtures";
import { flipDeltas, liftTransform, measureTops, playFlip, settleRows } from "@/lib/flip";
import type { MatchCriterion, MatchPack, MatchZone, PreferenceProfile } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { showMapToast } from "@/lib/map-toast";
import { newPlaceId } from "@/lib/match-brief";
import { criterionId, DEFAULT_SOFT_METRES } from "@/lib/match-model";
import { rowsReducer } from "@/lib/match-rows";
import { chipCriterionId, MATCH_CHIPS, suggestedChips, type MatchChip } from "@/lib/match-ranges";
import {
  addCriterion, areasLeft, chipAnswers, cutCounts, cutsMost, freshSearch, hasBudget, MAX_CRITERIA, MAX_PLACES, moveCriterion,
  placeSpan, searchCriteria, searchItems, setBudget, type SearchItem, type Span,
} from "@/lib/match-search";
import { budgetMoney, cutText, itemChip, itemName, softenedWords, weightText } from "@/lib/match-words";
import { budgetFromTools } from "@/lib/budget-source";
import { placeKindOptions, type PlaceKindOption } from "@/lib/place-kinds";
import { eraseLocalProfile } from "@/lib/profile-state";
import { rangeDomain, rangeLayer, rangeLayerMenu } from "@/lib/range-layers";
import { track } from "@/lib/usage";
import { isPhone } from "@/lib/viewport";
import { zoneUsage } from "@/lib/usage-layers";

import { BudgetFields, BudgetInput, CriterionCard, ZoneAdd } from "./match-card";
import type { FindLike } from "./use-find-like";
import { usePlaceOptions } from "./use-place-options";
import { loadRangeLayer, type RangeLayerData } from "./use-range-values";

interface MatchListProps {
  profile: PreferenceProfile;
  onChange: (profile: PreferenceProfile) => void;
  /** The match as the panel shows it (re-scored on the client until the API answers); null before the first. */
  pack: MatchPack | null;
  mode: DataMode;
  release: string;
  /** The layer on the map before My match: "Any layer…" offers it first. */
  mapLayer: string | null;
  /** Flagged layers the release leaves out (FLAGS.md): not offered. */
  hiddenLayers: readonly string[];
  /** While a handle is dragged: the search as it would be (null when let go). */
  onDraft: (profile: PreferenceProfile | null) => void;
  drawing: [number, number][] | null;
  onDrawing: (draft: [number, number][] | null) => void;
  /** "Top 10 ›": the results below (a phone sheet rises to full). */
  onShowTop: () => void;
  onShare: () => void;
  /** A "Like this" or a tool's budget link: the budget to start from and the area's criteria. */
  like?: FindLike | null;
  /** Pin a place on the map (Travel to › Pin on the map). */
  onPlacing?: (placing: boolean) => void;
  placing?: boolean;
}

/**
 * My match without a wizard: the form is the search. It opens on three rows, Budget (focused),
 * Travel to (any number of places) and What matters (one-tap chips, ordered by two inline questions); every criterion
 * is then a chip in one ordered list: Musts on top as filters, the rest ranked by their place (drag ≡; long-press on a
 * phone), each with its −N and weight. A tap opens its card in place. Under the list: "N of 4,994 areas left · Top 10"
 * and "X cuts most · Soften +N areas" with Undo in the toast.
 */
export function MatchList(props: MatchListProps) {
  const { profile, onChange, pack } = props;
  const items = useMemo(() => searchItems(profile), [profile]);
  const budget = hasBudget(profile);
  const [open, setOpen] = useState<string | null>(null);
  const counts = useMemo(() => (pack ? cutCounts(pack) : new Map<string, number>()), [pack]);
  const layers = useMemo(() => items.flatMap((item) => (item.criterion.kind === "range" && (item.criterion.scale !== "percentile" || item.id === open)
    ? [item.criterion.layer] : [])), [items, open]);
  const data = useLayerData(layers, props.mode, props.release);
  const spans = useMemo(() => spansFor(items, data), [items, data]);
  const hint = useMemo(() => (pack && items.length ? cutsMost(pack, profile, spans) : null), [pack, profile, items.length, spans]);
  const left = pack ? areasLeft(pack) : null;
  const ranked = items.filter((item) => !item.must).length;
  // A criterion that left the list closes its card.
  useEffect(() => { if (open && !items.some((item) => item.id === open)) setOpen(null); }, [items, open]);
  // A chip tapped on a phone: the sheet scrolls back up to the order and the count, so the tap shows its result
  // (the new #n, its −N and "N of 4,994 areas left"), not the chips still under the finger.
  const root = useRef<HTMLElement>(null);
  const added = useRef(false);
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    if (!isPhone()) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-testid='match-count']")
      ?.scrollIntoView?.({ block: "end", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [items.length]);
  const change = (next: PreferenceProfile) => {
    trackEdit(profile, items, next);
    onChange(next);
  };
  const soften = () => {
    if (!hint) return;
    const before = profile;
    const was = searchCriteria(before).find((item) => criterionId(item) === hint.id)!;
    const now = searchCriteria(hint.next).find((item) => criterionId(item) === hint.id)!;
    onChange(hint.next);
    track("match_edit", { action: "soften", criterion: editKind(hint.id), criteria: items.length });
    showMapToast(softenedWords(was, now, before, hint.next), { kind: "match-soften", action: { label: "Undo", onClick: () => onChange(before) } });
  };
  const reorder = (id: string, index: number) => {
    const before = profile;
    const next = moveCriterion(profile, id, index);
    if (next === profile || JSON.stringify(searchItems(next).map((item) => item.id)) === JSON.stringify(items.map((item) => item.id))) return;
    onChange(next);
    const moved = searchItems(next).find((item) => item.id === id)!;
    track("match_edit", { action: "reorder", criterion: editKind(id), criteria: items.length, rank: moved.rank ?? 0 });
    showMapToast(`${itemName(moved.criterion)} now ${moved.rank ? `#${moved.rank}` : "first"} · top 10 re-sorted`,
      { kind: "match-reorder", action: { label: "Undo", onClick: () => onChange(before) } });
  };
  // The row's ×: no question asked; the toast's Undo puts the criterion back where it was.
  const remove = (id: string) => {
    const before = profile;
    const next = rowsReducer({ profile, open }, { type: "remove", id });
    if (next.profile === profile) return;
    setOpen(next.open);
    change(next.profile);
    showMapToast("Removed", { kind: "match-remove", action: { label: "Undo", onClick: () => onChange(rowsReducer({ profile: next.profile, open: null }, { type: "restore", profile: before }).profile) } });
  };
  return (
    <section ref={root} className="match-list" data-testid="match-list" aria-label="Your search">
      <MatchPeek items={items} left={left} hint={hint} counts={counts} onSoften={soften} />
      {props.like?.open && props.like.summary && (
        <div className="match-like" data-testid="find-like-summary">
          <p>{props.like.summary}</p>
          {budget && props.like.ballpark !== null && (
            <button type="button" className="match-like__use" data-testid="find-like-use" onClick={() => {
              const like = props.like!;
              change(like.seedInto(setBudget(profile, { maximum: like.ballpark! })));
              like.dismiss();
            }}>Use it</button>
          )}
          <button type="button" className="criterion-remove" aria-label="Not from this area" onClick={props.like.dismiss}>
            <KnitIcon name="cross" colour="currentColor" className="knit-glyph" style={{ width: 14, height: 14 }} />
          </button>
        </div>
      )}
      {!budget && (
        <div className="match-row-block" data-testid="match-budget-start">
          <h3 className="match-block-title">Budget</h3>
          <BudgetFields profile={profile} onChange={change} />
          <BudgetInput profile={profile} shown={props.like?.open ? props.like.ballpark : null} autoFocus
            onChange={(next) => { const seeded = props.like?.open ? props.like.seedInto(next) : next; change(seeded); props.like?.dismiss(); }} />
        </div>
      )}
      {items.length > 0 && (
        <CriteriaList items={items} profile={profile} counts={counts} open={open} onOpen={setOpen} ranked={ranked} data={data}
          onChange={change} onDraft={props.onDraft} onReorder={reorder} onRemove={remove} drawing={props.drawing} onDrawing={props.onDrawing} />
      )}
      <TravelTo profile={profile} onChange={change} placing={props.placing ?? false} onPlacing={props.onPlacing} />
      {items.length > 0 && (
        <div className="match-count" data-testid="match-count" aria-live="polite">
          <p>
            {left ? <><strong data-testid="areas-left">{left.left.toLocaleString("en-GB")}</strong> of {left.total.toLocaleString("en-GB")} areas left</>
              : "Counting areas…"}
          </p>
          {left && left.left > 0 && <button type="button" className="match-count__top" onClick={props.onShowTop}>Top 10 ›</button>}
        </div>
      )}
      {hint && <SoftenHint hint={hint} items={items} onSoften={soften} />}
      <WhatMatters profile={profile} items={items} onChange={change} onAdded={() => { added.current = true; }} mapLayer={props.mapLayer} hidden={props.hiddenLayers} drawing={props.drawing} onDrawing={props.onDrawing} />
    </section>
  );
}

// ---- the list ---------------------------------------------------------------------------------------

interface CriteriaListProps {
  items: SearchItem[];
  profile: PreferenceProfile;
  counts: Map<string, number>;
  open: string | null;
  onOpen: (id: string | null) => void;
  ranked: number;
  data: Map<string, RangeLayerData>;
  onChange: (profile: PreferenceProfile) => void;
  onDraft: (profile: PreferenceProfile | null) => void;
  onReorder: (id: string, index: number) => void;
  onRemove: (id: string) => void;
  drawing: [number, number][] | null;
  onDrawing: (draft: [number, number][] | null) => void;
}

/**
 * A chip's words: a tool's carried budget says the price the household saw there and where it came from
 * ("Budget ≤ £500k · from Tools", CUJ06 board); the stretch above it is the card's fade.
 */
function chipLabel(criterion: MatchCriterion, profile: PreferenceProfile): string {
  if (criterion.kind === "budget" && budgetFromTools(profile)) return `Budget ≤ ${budgetMoney(profile.targetBudget, profile.market)} · from Tools`;
  return itemChip(criterion, profile);
}

/** Long-press on a phone before a drag starts, so a finger on ≡ can still scroll (ms). */
const LONG_PRESS = 350;
/** Siblings slide out of the way; the dropped row settles (ms). */
const SLIDE_MS = 180;
const SETTLE_MS = 200;

const reducedMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/**
 * Musts on top (filters, no weight), then the ranked list (board "My match · Your order rows"): each row one card
 * (≡ · #n · name · −N · weight · ×) whose open body is its lower half. Drag ≡ to reorder: a mouse at once, a finger
 * after a long press, ↑ ↓ from the keyboard. The lifted row follows the pointer on a transform; the others slide
 * (FLIP, lib/flip.ts) as the DOM re-sorts under it; the drop settles into place.
 */
function CriteriaList(props: CriteriaListProps) {
  const { items } = props;
  const [drag, setDrag] = useState<{ id: string; index: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  /** Row tops measured just before a re-sort (the FLIP "first"); consumed by the layout effect after it. */
  const before = useRef<Map<string, number> | null>(null);
  /** The row under the pointer: where it was grabbed and where its layout now puts it. */
  const lift = useRef<{ id: string; y: number; offset: number; top: number } | null>(null);
  /** The row just let go: it settles from where it was into its place. */
  const dropped = useRef<string | null>(null);
  const musts = items.filter((item) => item.must);
  const ranked = items.filter((item) => !item.must);
  const shown = (block: SearchItem[]) => {
    if (!drag) return block;
    const moving = block.find((item) => item.id === drag.id);
    if (!moving) return block;
    const rest = block.filter((item) => item !== moving);
    rest.splice(drag.index, 0, moving);
    return rest;
  };
  const order = [...shown(musts), ...shown(ranked)].map((item) => item.id).join("|");
  const rowsOf = () => new Map([...(list.current?.querySelectorAll<HTMLElement>("li[data-id]") ?? [])].map((row) => [row.dataset.id!, row] as const));
  const measure = () => { before.current = measureTops(rowsOf()); };
  const place = (row: HTMLElement, at: { y: number; offset: number; top: number }) => {
    row.style.transition = "none";
    row.style.transform = liftTransform(at.y, at.offset, at.top);
  };
  // After every re-sort: rows settle at their layout place, the lifted one keeps following the pointer, the rest
  // slide from where they were (FLIP: measure, invert, play).
  useLayoutEffect(() => {
    const first = before.current;
    before.current = null;
    const rows = rowsOf();
    settleRows(rows);
    const after = measureTops(rows);
    const lifted = lift.current;
    const liftedRow = lifted ? rows.get(lifted.id) : undefined;
    if (lifted && liftedRow) {
      lifted.top = after.get(lifted.id) ?? lifted.top;
      place(liftedRow, lifted);
    }
    if (!first) return;
    const deltas = flipDeltas(first, after);
    if (lifted) deltas.delete(lifted.id);
    const reduced = reducedMotion();
    const settling = dropped.current;
    dropped.current = null;
    if (settling && deltas.has(settling)) {
      playFlip(rows, new Map([[settling, deltas.get(settling)!]]), { ms: SETTLE_MS, easing: "ease-out", reduced });
      deltas.delete(settling);
    }
    playFlip(rows, deltas, { ms: SLIDE_MS, easing: "ease", reduced });
  }, [order, drag]);
  const begin = (item: SearchItem, event: ReactPointerEvent<HTMLButtonElement>) => {
    const handle = event.currentTarget;
    const row = handle.closest<HTMLElement>("li[data-id]");
    if (!row) return;
    const pointer = event.pointerId;
    const block = item.must ? musts : ranked;
    const start = { x: event.clientX, y: event.clientY };
    const touch = event.pointerType === "touch";
    let active = !touch;
    let moved = false;
    let index = block.indexOf(item);
    const top = row.getBoundingClientRect().top;
    const raise = () => {
      handle.dataset.dragging = "true";
      lift.current = { id: item.id, y: start.y, offset: start.y - top, top };
      place(row, lift.current);
      measure();
      setDrag({ id: item.id, index });
    };
    const timer = touch ? window.setTimeout(() => { active = true; raise(); }, LONG_PRESS) : null;
    try { handle.setPointerCapture(pointer); } catch { /* the pointer already left */ }
    const rows = () => [...(list.current?.querySelectorAll<HTMLElement>(`[data-block="${item.must ? "must" : "ranked"}"] > li`) ?? [])];
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointer) return;
      if (!active) {
        // A finger that moves before the long press is a scroll: let it go.
        if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > 8) stop(false);
        return;
      }
      if (!moved && Math.abs(moveEvent.clientY - start.y) < 4) return;
      moveEvent.preventDefault();
      if (!moved) { moved = true; if (!lift.current) raise(); }
      const at = lift.current;
      if (!at) return;
      at.y = moveEvent.clientY;
      place(row, at);
      const centres = rows().filter((entry) => entry.dataset.id !== item.id).map((entry) => {
        const box = entry.getBoundingClientRect();
        return box.top + box.height / 2;
      });
      const next = centres.filter((centre) => centre < moveEvent.clientY).length;
      if (next === index) return;
      index = next;
      measure();
      setDrag({ id: item.id, index });
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointer) stop(moved || (touch && active));
    };
    const stop = (commit: boolean) => {
      if (timer !== null) window.clearTimeout(timer);
      delete handle.dataset.dragging;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      if (lift.current) {
        measure();
        lift.current = null;
        dropped.current = item.id;
      }
      setDrag(null);
      if (commit && index !== block.indexOf(item)) props.onReorder(item.id, index);
    };
    const cancel = () => stop(false);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
  };
  const keys = (item: SearchItem, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const block = item.must ? musts : ranked;
    const at = block.indexOf(item) + step;
    if (at < 0 || at >= block.length) return;
    measure();
    props.onReorder(item.id, at);
    // Keep focus on the handle as the row moves.
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(item.id)}"] .match-item__handle`)?.focus());
  };
  const row = (item: SearchItem, position: number, total: number) => {
    const opened = props.open === item.id;
    const name = itemName(item.criterion);
    const cut = cutText(props.counts.get(item.id));
    return (
      <li key={item.id} data-id={item.id} className={`match-item${opened ? " match-item--open" : ""}${drag?.id === item.id ? " match-item--dragging" : ""}`}
        data-testid="match-item">
        <div className="match-item__row">
          <button type="button" className="match-item__handle" data-sheet-nodrag="" aria-label={`Move ${name}, ${item.must ? "Must" : `priority ${item.rank} of ${total}`}`}
            title="Drag to reorder (long-press on a phone); ↑ ↓ on the keyboard" onPointerDown={(event) => begin(item, event)} onKeyDown={(event) => keys(item, event)}>
            <KnitIcon name="menu" colour="currentColor" className="knit-glyph" style={{ width: 16, height: 16 }} />
          </button>
          <span className={`match-item__rank${item.must ? " match-item__rank--must" : ""}`} data-testid="match-item-rank">{item.must ? "Must" : `#${item.rank}`}</span>
          <button type="button" className="match-item__chip" aria-expanded={opened} data-testid="match-chip" onClick={() => props.onOpen(opened ? null : item.id)}>
            <span className="match-item__label">{item.criterion.kind === "place" ? "→ " : ""}{chipLabel(item.criterion, props.profile)}</span>
          </button>
          {cut && <span className="criterion-impact match-item__cut" data-testid="match-item-cut">{cut}</span>}
          {!item.must && <span className="match-item__weight" data-testid="match-item-weight" aria-label={`weight ${weightText(item.weight)}`}>{weightText(item.weight)}</span>}
          <button type="button" className="match-item__remove" aria-label={`Remove ${name}`} data-testid="match-item-remove" onClick={() => props.onRemove(item.id)}>
            <KnitIcon name="cross" colour="currentColor" className="knit-glyph" style={{ width: 14, height: 14 }} />
          </button>
        </div>
        {opened && (
          <CriterionCard item={item} profile={props.profile} ranked={total} cut={props.counts.get(item.id)}
            data={item.criterion.kind === "range" ? props.data.get(item.criterion.layer) ?? null : null}
            onChange={props.onChange} onDraft={props.onDraft} onClose={() => props.onOpen(null)} drawing={props.drawing} onDrawing={props.onDrawing} />
        )}
        <span className="sr-only">{position + 1} of {total}</span>
      </li>
    );
  };
  return (
    <div className="match-items" ref={list} data-testid="match-items">
      {musts.length > 0 && (
        <>
          <h3 className="match-block-title">Must <small>filters, no weight</small></h3>
          <ol className="match-items__block" data-block="must" aria-label="Must">{shown(musts).map((item, index, all) => row(item, index, all.length))}</ol>
        </>
      )}
      {ranked.length > 0 && (
        <>
          <h3 className="match-block-title">Your order <small>drag ≡ · top = most important</small></h3>
          <ol className="match-items__block" data-block="ranked" aria-label="Your order">{shown(ranked).map((item, index, all) => row(item, index, all.length))}</ol>
        </>
      )}
    </div>
  );
}

// ---- the peek, the count and Soften --------------------------------------------------------------------

/**
 * The lowered phone sheet's line (21d frame 6): "15 criteria · 14 areas", the three that cut most, Soften. Hidden at
 * half and full and on a desktop (match-list.css).
 */
function MatchPeek({ items, left, hint, counts, onSoften }: {
  items: SearchItem[]; left: { left: number; total: number } | null; hint: ReturnType<typeof cutsMost>; counts: Map<string, number>; onSoften: () => void;
}) {
  if (!items.length) return <p className="match-peek" data-testid="match-peek">Budget, places, what matters</p>;
  const most = items.filter((item) => counts.get(item.id)).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)).slice(0, 3);
  return (
    <div className="match-peek" data-testid="match-peek">
      <p><strong>{items.length} {items.length === 1 ? "criterion" : "criteria"}</strong>{left ? ` · ${left.left.toLocaleString("en-GB")} areas` : ""}</p>
      {most.length > 0 && <p className="match-peek__cuts">Cuts most: {most.map((item) => `${itemName(item.criterion)} ${cutText(counts.get(item.id))}`).join(" · ")}</p>}
      {hint && <button type="button" className="match-soften" onClick={onSoften}>Soften +{hint.gain.toLocaleString("en-GB")} areas</button>}
    </div>
  );
}

function SoftenHint({ hint, items, onSoften }: { hint: NonNullable<ReturnType<typeof cutsMost>>; items: SearchItem[]; onSoften: () => void }) {
  const item = items.find((entry) => entry.id === hint.id);
  if (!item) return null;
  return (
    <div className="match-hint" data-testid="soften-hint">
      <p><strong>{itemName(item.criterion)}</strong> cuts most</p>
      <button type="button" className="match-soften" data-testid="soften" onClick={onSoften}>Soften +{hint.gain.toLocaleString("en-GB")} areas</button>
    </div>
  );
}

// ---- Travel to ------------------------------------------------------------------------------------------

const DEFAULT_TRAVEL_MINUTES = 35;

/** "+ Work, school, gym…": a station or address (any number of places, each its own ranked card; 35 min by default). */
function TravelTo({ profile, onChange, placing, onPlacing }: {
  profile: PreferenceProfile; onChange: (profile: PreferenceProfile) => void; placing: boolean; onPlacing?: (placing: boolean) => void;
}) {
  const places = searchCriteria(profile).filter((item) => item.kind === "place");
  const travel = places.filter((item) => item.kind === "place" && (item.target.kind === "point" || item.target.kind === "any-of"));
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const options = usePlaceOptions(query);
  // "gym", "park", "M&S": the nearest of a kind first ("Gym · ≤ 10 min walk"), then stations and addresses (CUJ-13).
  const kinds = useMemo(() => placeKindOptions(query), [query]);
  const full = places.length >= MAX_PLACES;
  const addKind = (option: PlaceKindOption) => {
    onChange(addCriterion(profile, option.criterion));
    track("match_edit", { action: "add", criterion: "place", criteria: searchCriteria(profile).length + 1 });
    setQuery("");
    setTyping(false);
  };
  const add = (option: { label: string; latitude: number; longitude: number }) => {
    const ids = (profile.places ?? []);
    const criterion: MatchCriterion = {
      kind: "place", id: newPlaceId(option.label, ids), label: option.label.slice(0, 60),
      target: { kind: "point", latitude: option.latitude, longitude: option.longitude }, mode: "transit", targetMinutes: DEFAULT_TRAVEL_MINUTES, must: false,
    };
    onChange(addCriterion(profile, criterion));
    track("match_edit", { action: "add", criterion: "place", criteria: searchCriteria(profile).length + 1 });
    setQuery("");
    setTyping(false);
  };
  return (
    <div className="match-row-block" data-testid="match-travel">
      <h3 className="match-block-title">Travel to <small>any number</small></h3>
      {typing || !travel.length ? (
        <div className="travel-search">
          <input className="knit-field" value={query} onChange={(event) => setQuery(event.target.value)} disabled={full}
            placeholder={full ? `Up to ${MAX_PLACES} places` : "+ Work, school, gym…"} aria-label="Travel to: a station or address" data-testid="travel-to" />
          {(kinds.length > 0 || options.length > 0) && (
            <ul className="zone-options" data-testid="travel-options">
              {kinds.map((option) => (
                <li key={option.key}><button type="button" data-testid="travel-kind" onClick={() => addKind(option)}>{option.text}</button></li>
              ))}
              {options.map((option) => (
                <li key={option.key}><button type="button" onClick={() => add(option)}>{option.text}</button></li>
              ))}
            </ul>
          )}
          {onPlacing && (
            <button type="button" className="link-button" aria-pressed={placing} onClick={() => onPlacing(!placing)} disabled={full}>
              {placing ? "Tap the map to pin it · Cancel" : "Or pin it on the map"}
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="match-add" onClick={() => setTyping(true)} disabled={full} data-testid="travel-another">+ Another place</button>
      )}
    </div>
  );
}

// ---- What matters ----------------------------------------------------------------------------------------

const SUGGESTIONS = 7;

/**
 * One-tap chips (the old wizard's questions), ordered by two inline questions (Kids? Drive?) that only pre-order them,
 * then "Any layer…" (every Layers item as a range) and "Where…" (zones). A tap adds the card with defaults;
 * nothing to answer first.
 */
function WhatMatters({ profile, items, onChange, onAdded, mapLayer, hidden, drawing, onDrawing }: {
  profile: PreferenceProfile; items: SearchItem[]; onChange: (profile: PreferenceProfile) => void; onAdded: () => void; mapLayer: string | null;
  hidden: readonly string[];
  drawing: [number, number][] | null; onDrawing: (draft: [number, number][] | null) => void;
}) {
  const taken = new Set(items.map((item) => item.id));
  const answers = chipAnswers(profile);
  // A layer the release leaves out (Clean air while CLOSE_KNIT_AIR_QUALITY is off) is offered as if taken.
  const unoffered = new Set([...taken, ...hidden.map((layer) => `range:${layer}`)]);
  const chips = suggestedChips(answers, unoffered).slice(0, SUGGESTIONS);
  const [menu, setMenu] = useState<"layers" | "where" | null>(null);
  const full = items.length >= MAX_CRITERIA;
  const hasWhere = taken.has("zone");
  const add = (criterion: MatchCriterion, from: string) => {
    onAdded();
    onChange(addCriterion(profile, structuredClone(criterion)));
    track("match_edit", { action: "add", criterion: from === "chip" ? editKind(criterionId(criterion)) : criterion.kind, criteria: items.length + 1 });
  };
  const answer = (key: "kids" | "drive", value: boolean) => onChange({ ...profile, suggest: { ...answers, [key]: answers[key] === value ? undefined : value } });
  return (
    <div className="match-row-block match-matters" data-testid="what-matters">
      <h3 className="match-block-title">{items.length ? "Add" : "What matters"} <small>tap to add</small></h3>
      {/* The start order's two questions (V4-21d step 5) only while nothing is asked yet: once a chip is in the list
          its order is the household's own, and the CUJ01 board draws the chips alone. */}
      {items.length === 0 && <div className="match-questions">
        {(["kids", "drive"] as const).map((key) => (
          <div key={key} className="match-question" role="group" aria-label={key === "kids" ? "Kids at home?" : "Do you drive?"}>
            <span>{key === "kids" ? "Kids at home?" : "Do you drive?"}</span>
            <button type="button" aria-pressed={answers[key] === true} onClick={() => answer(key, true)}>Yes</button>
            <button type="button" aria-pressed={answers[key] === false} onClick={() => answer(key, false)}>No</button>
          </div>
        ))}
      </div>}
      <ul className="match-suggestions" aria-label="Suggested, most likely first">
        {chips.map((chip) => (
          <li key={chip.id}>
            <button type="button" className="match-suggestion" disabled={full} data-testid={`chip-${chip.id}`} onClick={() => add(chip.criterion, "chip")}>
              + {chip.label}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="match-suggestion" aria-expanded={menu === "layers"} disabled={full} data-testid="chip-any-layer"
            onClick={() => setMenu(menu === "layers" ? null : "layers")}>+ Any layer…</button>
        </li>
        {!hasWhere && (
          <li>
            <button type="button" className="match-suggestion" aria-expanded={menu === "where" || drawing !== null} disabled={full} data-testid="chip-where"
              onClick={() => setMenu(menu === "where" ? null : "where")}>+ Where…</button>
          </li>
        )}
      </ul>
      {menu === "layers" && <AnyLayer taken={[...unoffered]} mapLayer={mapLayer} onPick={(criterion) => { add(criterion, "any-layer"); setMenu(null); }} />}
      {!hasWhere && (menu === "where" || drawing !== null) && (
        <div className="match-where-start" data-testid="where-start">
          <p className="metric-description">Only areas inside these (up to 3): outside scores lower the further out.</p>
          <ZoneAdd zones={[]} drawing={drawing} onDrawing={onDrawing}
            onAdd={(zone: MatchZone) => {
              track("zone_change", zoneUsage("add", zone, 1));
              add({ kind: "where", zones: [zone], softMetres: DEFAULT_SOFT_METRES, must: false }, "where");
              setMenu(null);
            }} />
        </div>
      )}
    </div>
  );
}

/** Every Layers item as a range criterion, the layer on the map first; the better half of London by default. */
function AnyLayer({ taken, mapLayer, onPick }: { taken: string[]; mapLayer: string | null; onPick: (criterion: MatchCriterion) => void }) {
  const takenLayers = taken.filter((id) => id.startsWith("range:")).map((id) => id.slice("range:".length));
  const { first, groups } = rangeLayerMenu(mapLayer, takenLayers);
  const pick = (layer: string) => {
    const better = rangeLayer(layer)?.better ?? "lower";
    const chip = MATCH_CHIPS.find((entry: MatchChip) => chipCriterionId(entry) === `range:${layer}`);
    onPick(chip?.criterion ?? (better === "lower"
      ? { kind: "range", layer, scale: "percentile", min: null, max: 50, softMin: null, softMax: 75, must: false }
      : { kind: "range", layer, scale: "percentile", min: 50, max: null, softMin: 25, softMax: null, must: false }));
  };
  return (
    <div className="criteria-menu" data-testid="any-layer-menu">
      {first && <button type="button" className="match-suggestion match-suggestion--first" onClick={() => pick(first.layer)}>Use {first.label}</button>}
      {groups.map((group) => (
        <div key={group.id} className="criteria-menu__group">
          <h4>{group.label}</h4>
          <div className="criteria-menu__items">
            {group.items.map((item) => <button key={item.layer} type="button" className="match-suggestion" onClick={() => pick(item.layer)}>{item.label}</button>)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- the foot: share, clear, your data ---------------------------------------------------------------------

/**
 * Under the results: Share search; with My match's older extras on (lib/match-extras.ts, default off),
 * Clear (asks first) and Your data (the usage-data choice, erasing the saved search) too.
 */
export function MatchFoot({ profile, onChange, onShare, empty, extras = true }: {
  profile: PreferenceProfile; onChange: (profile: PreferenceProfile) => void; onShare: () => void; empty: boolean; extras?: boolean;
}) {
  const [asking, setAsking] = useState<"clear" | "erase" | null>(null);
  // The erase question takes focus; cancelling (button or Escape) hands it back to its trigger.
  const eraseTrigger = useRef<HTMLButtonElement>(null);
  const eraseConfirm = useRef<HTMLButtonElement>(null);
  const wasErasing = useRef(false);
  useEffect(() => {
    if (asking === "erase") eraseConfirm.current?.focus();
    else if (wasErasing.current) eraseTrigger.current?.focus();
    wasErasing.current = asking === "erase";
  }, [asking]);
  return (
    <div className="match-foot" data-testid="match-foot">
      <div className="match-foot__actions">
        {!empty && (
          <button type="button" className="match-foot__button" aria-label="Share search" onClick={onShare} data-testid="share-search">
            <KnitIcon name="arrow-out" colour="currentColor" className="knit-glyph" style={{ width: 16, height: 16 }} /> Share search
          </button>
        )}
        {!empty && extras && (
          <button type="button" className="match-foot__button" aria-expanded={asking === "clear"} onClick={() => setAsking(asking === "clear" ? null : "clear")}
            data-testid="clear-search">
            <KnitIcon name="reset" colour="currentColor" className="knit-glyph" style={{ width: 16, height: 16 }} /> Clear
          </button>
        )}
      </div>
      {asking === "clear" && (
        <div className="search-reset" role="group" aria-label="Clear the search">
          <span>Clear every criterion?</span>
          <button type="button" onClick={() => { onChange(freshSearch(profile)); setAsking(null); }}>Clear</button>
          <button type="button" onClick={() => setAsking(null)}>Keep</button>
        </div>
      )}
      {extras && <details className="match-data" data-testid="your-data">
        <summary>Your data</summary>
        <label className="consent-field">
          <input type="checkbox" checked={profile.analyticsConsent} onChange={(event) => onChange({ ...profile, analyticsConsent: event.target.checked })} />
          Share redacted usage data to improve matching
        </label>
        {/* aria-expanded: a sheet's Escape closes this question first (MapSheet), then the sheet. */}
        <button ref={eraseTrigger} type="button" className="link-button" aria-expanded={asking === "erase"}
          onClick={() => setAsking(asking === "erase" ? null : "erase")}>Erase local profile</button>
        {asking === "erase" && (
          <div data-testid="erase-preview" className="erase-actions" role="group" aria-label="Confirm erase profile"
            onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAsking(null); } }}>
            <p>Erase your saved search from this device? This cannot be undone.</p>
            <button ref={eraseConfirm} type="button" onClick={() => { wasErasing.current = false; onChange(DEFAULT_PROFILE); eraseLocalProfile(); setAsking(null); }}>Confirm erase</button>
            <button type="button" onClick={() => setAsking(null)}>Cancel erase</button>
          </div>
        )}
      </details>}
    </div>
  );
}

/** Removing a criterion, turning Must on or off, or a new budget, as match_edit events (adds are counted where they happen). */
function trackEdit(before: PreferenceProfile, items: SearchItem[], next: PreferenceProfile) {
  const after = searchItems(next);
  const now = new Map(after.map((item) => [item.id, item]));
  for (const item of items) {
    const kept = now.get(item.id);
    if (!kept) track("match_edit", { action: "remove", criterion: editKind(item.id), criteria: after.length });
    else if (kept.must !== item.must) track("match_edit", { action: "must", criterion: editKind(item.id), criteria: after.length });
  }
  const budgetNow = after.some((item) => item.id === "affordability");
  if (budgetNow && (!items.some((item) => item.id === "affordability") || before.maximumBudget !== next.maximumBudget || before.market !== next.market)) {
    track("match_edit", { action: "budget", criterion: "budget", criteria: after.length });
  }
}

/** A criterion for analytics: its chip id ("safer-streets") or its kind (budget, place, range, where, custom), never a value. */
export function editKind(id: string): string {
  const chip = MATCH_CHIPS.find((entry) => chipCriterionId(entry) === id);
  if (chip) return chip.id;
  if (id === "affordability") return "budget";
  if (id === "zone") return "where";
  return id.split(":")[0];
}

// ---- layer values ------------------------------------------------------------------------------------------

/** London's values for each layer asked (loaded once and kept, lib use-range-values). */
function useLayerData(layers: string[], mode: DataMode, release: string): Map<string, RangeLayerData> {
  const key = [...new Set(layers)].sort().join("|");
  const [data, setData] = useState<{ key: string; values: Map<string, RangeLayerData> }>({ key: "", values: new Map() });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const wanted = key.split("|");
    void Promise.all(wanted.map((layer) => loadRangeLayer(layer, mode, release).then((value) => [layer, value] as const))).then((loaded) => {
      if (!live) return;
      setData({ key: `${mode}|${release}|${key}`, values: new Map(loaded.filter((entry): entry is readonly [string, RangeLayerData] => entry[1] !== null)) });
    });
    return () => { live = false; };
  }, [key, mode, release]);
  return data.values;
}

/** Each criterion's slider span (Soften's step): a value range from its layer's values, a place from its minutes. */
function spansFor(items: SearchItem[], data: Map<string, RangeLayerData>): Map<string, Span> {
  const spans = new Map<string, Span>();
  for (const item of items) {
    const criterion = item.criterion;
    if (criterion.kind === "range" && criterion.scale !== "percentile") {
      const values = data.get(criterion.layer)?.list;
      if (values?.length) {
        const domain = rangeDomain(values);
        spans.set(item.id, { low: domain.low, high: domain.high, step: domain.step });
      }
    } else if (criterion.kind === "place") {
      spans.set(item.id, placeSpan(criterion.targetMinutes));
    }
  }
  return spans;
}
