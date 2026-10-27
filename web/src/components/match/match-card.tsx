"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { MoneyInput } from "@/components/money-input";
import { HOUSE_TYPES, MAX_ZONES, PLACE_MODES, type MatchCriterion, type MatchZone, type PreferenceProfile, type RangeCriterion } from "@/lib/contracts";
import { DEFAULT_SOFT_METRES } from "@/lib/match-model";
import {
  placeSoftMinutes, placeSpan, removeCriterion, replaceCriterion, setBudget, setMust, WHERE_SPAN, type SearchItem, type Span,
} from "@/lib/match-search";
import { budgetMoney, cutText, itemLine, itemMeasure, itemName } from "@/lib/match-words";
import { formatRangeValue, formatRangeValueUnit, rangeDomain, rangeUnit, type RangeDomain } from "@/lib/range-layers";
import { describeZone, zoneKey } from "@/lib/zones";
import { track } from "@/lib/usage";
import { zoneUsage } from "@/lib/usage-layers";

import { useZoneOptions } from "../zone-fields";
import { Histogram, RangeSlider, TripChips } from "./criterion-cards";
import { ZonePortalChips } from "./portal-links";
import type { RangeLayerData } from "./use-range-values";
import { useScope } from "@/components/scope-context";
import { coversEngland } from "@/lib/scope";

export interface CardProps {
  item: SearchItem;
  profile: PreferenceProfile;
  /** How many ranked criteria there are ("Priority #2 of 3"). */
  ranked: number;
  cut: number | undefined;
  /** A range's London values (histogram, words, Fine-tune); null while loading or for other kinds. */
  data: RangeLayerData | null;
  onChange: (profile: PreferenceProfile) => void;
  /** While a handle is dragged: the search as it would be (the map and the count follow); null when let go. */
  onDraft: (profile: PreferenceProfile | null) => void;
  onClose: () => void;
  /** Corners of the area being drawn (Where › Draw on map); null when not drawing. */
  drawing?: [number, number][] | null;
  onDrawing?: (draft: [number, number][] | null) => void;
}

/**
 * One criterion's card, opened in place from its chip: two levels, the simple one (one handle, the
 * soft edge drawn as a fade and set automatically, Must) and Fine-tune (the V3-30b card: histogram, the soft-edge
 * handles; "Priority #n", the place in the list). Phones show the simple level only (match-list.css).
 */
export function CriterionCard(props: CardProps) {
  const { item } = props;
  const [fine, setFine] = useState(false);
  const kind = item.criterion.kind;
  const tunable = kind === "range" || kind === "place" || kind === "budget" || kind === "where";
  return (
    <div className={`criterion-card match-card${fine ? " match-card--fine" : ""}`} data-testid={`match-card-${item.id}`} data-level={fine ? "fine" : "simple"}>
      <CardHead {...props} />
      {kind === "budget" && <BudgetCard {...props} fine={fine} />}
      {kind === "range" && <RangeItem {...props} fine={fine} />}
      {kind === "place" && <PlaceItem {...props} fine={fine} />}
      {kind === "where" && <WhereItem {...props} fine={fine} />}
      {kind === "custom" && <p className="criterion-card__line"><span>{itemLine(item.criterion, props.profile)}</span>{cut(props.cut)}</p>}
      <div className="match-card__foot">
        {fine && item.rank !== null && (
          <span className="match-card__priority" data-testid="match-card-priority">Priority #{item.rank} of {props.ranked} <small>drag ≡ to change</small></span>
        )}
        {tunable && (
          <button type="button" className="match-card__fine link-button" aria-expanded={fine} onClick={() => setFine(!fine)} data-testid="fine-tune">
            {fine ? "Simple" : "Fine-tune ›"}
          </button>
        )}
      </div>
    </div>
  );
}

function cut(count: number | undefined): ReactNode {
  const text = cutText(count);
  return text ? <span className="criterion-impact" data-testid="match-card-cut">{text}</span> : null;
}

/** The body's first line: the measure (muted) and Must. The name and × are the row's header (board "Your order rows"). */
function CardHead({ item, profile, onChange }: CardProps) {
  const measure = itemMeasure(item.criterion);
  return (
    <div className="criterion-card__head">
      <span className="match-card__measure">{measure}</span>
      <button type="button" className="criterion-must" aria-pressed={item.must} data-testid="match-card-must"
        title={item.must ? "Must: a filter, no weight" : "Make it a Must: areas outside are out"}
        onClick={() => onChange(setMust(profile, item.id, !item.must))}>Must</button>
    </div>
  );
}

// ---- one handle with an automatic fade ----------------------------------------------------------

interface OneHandleProps {
  name: string;
  /** The span of the slider and its step. */
  span: Span;
  /** Where the handle sits (the range's end the household set). */
  value: number;
  /** The soft edge's end (the fade reaches it); equal to `value` for a Must (no fade). */
  soft: number;
  /** The good side is below the handle (≤) or above it (≥). */
  side: "below" | "above";
  format: (value: number) => string;
  onMove: (value: number) => void;
  onRelease: () => void;
  ends?: [string, string];
}

/** One handle on the household's limit; the soft edge is a fade beyond it, drawn, not dragged (simple level). */
function OneHandle({ name, span, value, soft, side, format, onMove, onRelease, ends }: OneHandleProps) {
  const width = Math.max(1e-9, span.high - span.low);
  const at = (number: number) => Math.min(100, Math.max(0, ((number - span.low) / width) * 100));
  const inLeft = side === "below" ? 0 : at(value);
  const inRight = side === "below" ? at(value) : 100;
  const fadeFrom = side === "below" ? at(value) : at(soft);
  const fadeTo = side === "below" ? at(soft) : at(value);
  return (
    <div className="one-handle" data-testid="one-handle">
      <div className="one-handle__track" aria-hidden="true">
        <span className="one-handle__in" style={{ left: `${inLeft}%`, width: `${inRight - inLeft}%` }} />
        {fadeTo > fadeFrom && (
          <span className={`one-handle__fade one-handle__fade--${side}`} style={{ left: `${fadeFrom}%`, width: `${fadeTo - fadeFrom}%` }} />
        )}
      </div>
      <input type="range" className="one-handle__input" min={span.low} max={span.high} step={span.step} value={Math.min(span.high, Math.max(span.low, value))}
        aria-label={name} aria-valuetext={format(value)}
        onChange={(event) => onMove(Number(event.target.value))}
        onPointerUp={onRelease} onKeyUp={onRelease} onBlur={onRelease} onTouchEnd={onRelease} />
      {ends && <p className="range-ends" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></p>}
    </div>
  );
}

/** Drag state shared by the cards: moves go to onDraft (live map), the last one is committed on release. */
function useDrag(props: CardProps) {
  const latest = useRef<PreferenceProfile | null>(null);
  return {
    move(next: PreferenceProfile) {
      latest.current = next;
      props.onDraft(next);
    },
    release() {
      const next = latest.current;
      latest.current = null;
      props.onDraft(null);
      if (next) props.onChange(next);
    },
  };
}

// ---- ranges --------------------------------------------------------------------------------------

/** The axis's right end: "400+ / 1,000" when London's values run past the 98th percentile, else the top value with its unit. */
function tailEnd(layer: string, domain: RangeDomain, top: number): string {
  return domain.tail ? `${formatRangeValue(layer, domain.high)}+${rangeUnit(layer)}` : formatRangeValueUnit(layer, Math.min(top, domain.high));
}

/** A London percentile's value of the layer (0 lowest … 100 highest), from the sorted values. */
function valueAt(sorted: readonly number[], percentile: number): number | null {
  if (!sorted.length) return null;
  const index = Math.round((Math.min(100, Math.max(0, percentile)) / 100) * (sorted.length - 1));
  return sorted[index];
}

function RangeItem(props: CardProps & { fine: boolean }) {
  const { item, profile, data } = props;
  const range = item.criterion as Extract<MatchCriterion, { kind: "range" }>;
  const drag = useDrag(props);
  const england = coversEngland(useScope());
  const [sorted, setSorted] = useState<number[]>([]);
  useEffect(() => { setSorted(data ? [...data.list].sort((a, b) => a - b) : []); }, [data]);
  const percentile = range.scale === "percentile";
  const toValue = percentile && sorted.length ? (p: number) => valueAt(sorted, p) : undefined;
  const name = itemName(range);
  const line = itemLine(range, profile, toValue);
  const commit = (next: MatchCriterion) => drag.move(replaceCriterion(profile, item.id, next));
  // Fine-tune: the V3-30b slider over the layer's own values (a percentile range turns into values once moved).
  if (props.fine) {
    if (percentile && !sorted.length) {
      return <><p className="criterion-card__line"><span data-testid="match-card-line">{line}</span>{cut(props.cut)}</p><p className="metric-description">{england ? "Loading values…" : "Loading London’s values…"}</p></>;
    }
    const domain: RangeDomain = rangeDomain(sorted.length ? sorted : [range.min, range.max, range.softMin, range.softMax].filter((value): value is number => value !== null));
    const asValue = (bound: number | null) => (bound === null ? null : percentile ? valueAt(sorted, bound) : bound);
    const shown: RangeCriterion = {
      layer: range.layer, min: asValue(range.min), max: asValue(range.max), importance: 1,
      softMin: range.must ? null : asValue(range.softMin), softMax: range.must ? null : asValue(range.softMax),
    };
    return (
      <>
        <p className="criterion-card__line"><span data-testid="match-card-line">{line}</span>{cut(props.cut)}</p>
        <Histogram criterion={shown} data={data} domain={domain} />
        <RangeSlider criterion={shown} domain={domain} name={name} highlight={false}
          onMove={(next) => commit({ ...range, scale: "value", min: next.min, max: next.max, softMin: next.softMin, softMax: next.softMax,
            must: range.must && next.softMin === null && next.softMax === null })}
          onRelease={drag.release} />
        <p className="range-ends" aria-hidden="true">
          <span>{formatRangeValue(range.layer, domain.low)}</span>
          <span>{formatRangeValue(range.layer, domain.high)}{domain.tail ? "+" : ""}</span>
        </p>
      </>
    );
  }
  // Simple: one handle on the household's limit (both ends set: the two-handle slider), the soft edge a fade.
  const valueDomain = rangeDomain(sorted.length ? sorted : [range.min, range.max, range.softMin, range.softMax].filter((value): value is number => value !== null));
  const span: Span = percentile ? { low: 0, high: 100, step: 1 } : { low: valueDomain.low, high: valueDomain.high, step: valueDomain.step };
  const side = range.max !== null ? "below" : "above";
  const bound = side === "below" ? range.max! : range.min ?? span.low;
  const softEnd = range.must ? bound : side === "below" ? range.softMax ?? bound : range.softMin ?? bound;
  const format = (value: number) => (percentile ? (toValue ? formatRangeValue(range.layer, toValue(value) ?? value) : `${Math.round(value)}th pct`) : formatRangeValue(range.layer, value));
  const both = range.min !== null && range.max !== null;
  // The ends say the unit ("400+ / 1,000"), so the axis reads as crimes per 1,000, not a bare count. The right end is
  // London's 98th percentile with "+", as Fine-tune's: one outlier (4,459 in the West End) never names the axis.
  const ends: [string, string] = percentile
    ? (toValue ? [formatRangeValue(range.layer, toValue(0) ?? 0), tailEnd(range.layer, valueDomain, toValue(100) ?? 0)] : ["lowest", "highest"])
    : [formatRangeValue(range.layer, span.low), tailEnd(range.layer, valueDomain, span.high)];
  return (
    <>
      <p className="criterion-card__line"><span data-testid="match-card-line">{line}</span>{cut(props.cut)}</p>
      {!both && (
        <OneHandle name={`${name}, limit`} span={span} value={bound} soft={softEnd} side={side} format={format} ends={ends}
          onMove={(value) => {
            const delta = value - bound;
            const clampSoft = (soft: number | null) => (soft === null ? null : Math.min(span.high, Math.max(span.low, soft + delta)));
            commit(side === "below"
              ? { ...range, max: value, softMax: range.softMax === null ? null : Math.max(value, clampSoft(range.softMax)!) }
              : { ...range, min: value, softMin: range.softMin === null ? null : Math.min(value, clampSoft(range.softMin)!) });
          }}
          onRelease={drag.release} />
      )}
    </>
  );
}

// ---- places --------------------------------------------------------------------------------------

function PlaceItem(props: CardProps & { fine: boolean }) {
  const { item, profile } = props;
  const place = item.criterion as Extract<MatchCriterion, { kind: "place" }>;
  const drag = useDrag(props);
  const span = placeSpan(place.targetMinutes);
  const soft = place.must ? place.targetMinutes : placeSoftMinutes(place);
  const commit = (next: MatchCriterion) => drag.move(replaceCriterion(profile, item.id, next));
  const modes = place.target.kind === "point" || place.target.kind === "any-of" ? PLACE_MODES : PLACE_MODES.filter((mode) => mode !== "transit");
  return (
    <>
      <p className="criterion-card__line"><span data-testid="match-card-line">{itemLine(place, profile)}</span>{cut(props.cut)}</p>
      <OneHandle name={`${place.label}, minutes`} span={span} value={place.targetMinutes} soft={soft} side="below"
        format={(value) => `${value} min`} ends={[`${span.low} min`, `${span.high} min`]}
        onMove={(value) => {
          const minutes = Math.max(5, value);
          // An own soft edge keeps its distance from the limit; the default (+50%) follows it.
          const own = place.softMinutes !== undefined ? Math.min(240, Math.max(minutes, place.softMinutes + (minutes - place.targetMinutes))) : undefined;
          commit({ ...place, targetMinutes: minutes, ...(own !== undefined ? { softMinutes: own } : {}) });
        }}
        onRelease={drag.release} />
      {props.fine && !place.must && (
        <label className="match-card__soft">
          <span>Soft edge: up to {soft} min</span>
          <input type="range" min={place.targetMinutes} max={Math.max(span.high, soft)} step={5} value={soft}
            aria-label={`${place.label}, soft edge`} aria-valuetext={`${soft} min`}
            onChange={(event) => commit({ ...place, softMinutes: Math.max(place.targetMinutes, Number(event.target.value)) })}
            onPointerUp={drag.release} onKeyUp={drag.release} onBlur={drag.release} onTouchEnd={drag.release} />
        </label>
      )}
      <TripChips name={place.label} minutes={place.targetMinutes} mode={place.mode} modes={modes}
        onMinutes={(targetMinutes) => props.onChange(replaceCriterion(profile, item.id, { ...place, targetMinutes,
          ...(place.softMinutes !== undefined ? { softMinutes: Math.max(targetMinutes, place.softMinutes) } : {}) }))}
        onMode={(mode) => props.onChange(replaceCriterion(profile, item.id, { ...place, mode }))} />
    </>
  );
}

// ---- budget --------------------------------------------------------------------------------------

const BUY_SPAN: Span = { low: 100_000, high: 2_000_000, step: 25_000 };
const RENT_SPAN: Span = { low: 500, high: 6_000, step: 50 };
const BEDROOMS = [0, 1, 2, 3, 4, 5] as const;

/**
 * The budget as the affordability criterion (21c point 4): the typical price (buy, by the home type picked) or the
 * rent for the bedrooms; target = the end of the range, maximum = the end of the soft edge. Never a home's value.
 */
function BudgetCard(props: CardProps & { fine: boolean }) {
  const { item, profile } = props;
  const drag = useDrag(props);
  const span = profile.market === "rent" ? RENT_SPAN : BUY_SPAN;
  const format = (value: number) => budgetMoney(value, profile.market);
  return (
    <>
      <BudgetFields profile={profile} onChange={props.onChange} />
      <BudgetInput profile={profile} shown={profile.maximumBudget} onChange={props.onChange} />
      <p className="criterion-card__line"><span data-testid="match-card-line">{itemLine(item.criterion, profile)}</span>{cut(props.cut)}</p>
      {/* Must or not (as the line): the handle is the comfortable end and the stretch fades to the maximum; a Must puts
          areas past the stretch out. */}
      <OneHandle name="Budget" span={span} value={profile.targetBudget}
        soft={profile.maximumBudget} side="below" format={format} ends={[format(span.low), `${format(span.high)}+`]}
        onMove={(value) => {
          const stretch = profile.maximumBudget / Math.max(1, profile.targetBudget);
          drag.move({ ...profile, targetBudget: value, maximumBudget: Math.max(value, Math.round((value * stretch) / span.step) * span.step) });
        }} onRelease={drag.release} />
      {props.fine && (
        <label className="match-card__soft">
          <span>Stretch to {format(profile.maximumBudget)}</span>
          <input type="range" min={profile.targetBudget} max={Math.max(span.high, profile.maximumBudget)} step={span.step} value={profile.maximumBudget}
            aria-label="Budget, stretch to" aria-valuetext={format(profile.maximumBudget)}
            onChange={(event) => drag.move({ ...profile, maximumBudget: Math.max(profile.targetBudget, Number(event.target.value)) })}
            onPointerUp={drag.release} onKeyUp={drag.release} onBlur={drag.release} onTouchEnd={drag.release} />
        </label>
      )}
    </>
  );
}

/** Buy | Rent, the home (Any | Flat | House) and the bedrooms: what the typical price is read for. */
export function BudgetFields({ profile, onChange }: { profile: PreferenceProfile; onChange: (profile: PreferenceProfile) => void }) {
  const type = profile.houseTypes?.length ? "house" : profile.propertyType ?? "any";
  return (
    <div className="budget-fields">
      <div className="segmented match-segmented" role="group" aria-label="Buy or rent">
        {(["buy", "rent"] as const).map((market) => (
          <button key={market} type="button" aria-pressed={profile.market === market} onClick={() => onChange(setBudget(profile, { market }))}>
            {market === "buy" ? "Buy" : "Rent"}
          </button>
        ))}
      </div>
      <div className="segmented match-segmented" role="group" aria-label="Home">
        {(["any", "flat", "house"] as const).map((kind) => (
          <button key={kind} type="button" aria-pressed={type === kind} onClick={() => onChange(setBudget(profile, { propertyType: kind }))}>
            {kind === "any" ? "Any" : kind === "flat" ? "Flat" : "House"}
          </button>
        ))}
      </div>
      {type === "house" && (
        // The kinds of house wanted (several may be picked; all of them = any house).
        <div className="segmented match-segmented" role="group" aria-label="House types" data-testid="home-types">
          {HOUSE_TYPES.map((kind) => {
            const chosen = profile.houseTypes?.length ? profile.houseTypes : [...HOUSE_TYPES];
            const on = chosen.includes(kind);
            const next = HOUSE_TYPES.filter((entry) => (entry === kind ? !on : chosen.includes(entry)));
            return (
              <button key={kind} type="button" aria-pressed={on} disabled={on && chosen.length === 1}
                onClick={() => onChange({ ...profile, propertyType: "house", houseTypes: next })}>
                {kind === "semi" ? "Semi" : kind[0].toUpperCase() + kind.slice(1)}
              </button>
            );
          })}
        </div>
      )}
      <div className="segmented match-segmented match-segmented--beds" role="group" aria-label="Bedrooms">
        {BEDROOMS.map((beds) => (
          <button key={beds} type="button" aria-pressed={profile.bedrooms === beds} onClick={() => onChange({ ...profile, bedrooms: beds })}
            aria-label={beds === 0 ? "Studio" : `${beds}${beds === 5 ? " or more" : ""} bedrooms`}>
            {beds === 0 ? "Studio" : beds === 5 ? "5+" : beds}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The maximum price (or rent) as typed: commits on Enter, on leaving the field, or after a pause, so the map colours
 * once per answer. An empty field takes the budget out of the search.
 */
export function BudgetInput({ profile, shown, onChange, autoFocus = false, id }: {
  profile: PreferenceProfile; shown: number | null; onChange: (profile: PreferenceProfile) => void; autoFocus?: boolean; id?: string;
}) {
  const [draft, setDraft] = useState<number | null | undefined>(undefined);
  const timer = useRef<number | null>(null);
  const commit = (value: number | null | undefined) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (value === undefined) return;
    setDraft(undefined);
    if (value === null || value < (profile.market === "rent" ? 100 : 10_000)) return;
    onChange(setBudget(profile, { maximum: Math.round(value) }));
  };
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const rent = profile.market === "rent";
  return (
    <label className="budget-input">
      <span className="sr-only">{rent ? "Max rent a month" : "Max price"}</span>
      <MoneyInput id={id} className="knit-field" pound autoFocus={autoFocus} data-testid="budget-max"
        aria-label={rent ? "Max rent a month" : "Max price"} placeholder={rent ? "Max rent, e.g. £2,500" : "Max price, e.g. £650k"}
        value={draft === undefined ? shown : draft}
        onValue={(value) => {
          setDraft(value);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(value), 900);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(draft === undefined ? shown ?? undefined : draft); } }} />
      <span className="budget-input__unit" aria-hidden="true">max</span>
    </label>
  );
}

// ---- where ------------------------------------------------------------------------------

type AddKind = "station" | "borough" | "areas";
const ADD_KINDS: { id: AddKind | "draw"; label: string }[] = [
  { id: "station", label: "Station" }, { id: "borough", label: "Borough" }, { id: "areas", label: "Areas" }, { id: "draw", label: "Draw on map" },
];

/**
 * Where: up to three zones as chips (a walk from a station, a borough, areas, an area drawn on the map),
 * "+ Add", ✕ per chip. Inside scores in full; outside falls with the distance (the soft edge, 1 km by default) and
 * Must keeps only areas inside. Zones stay the same objects in saved searches and links.
 */
function WhereItem(props: CardProps & { fine: boolean }) {
  const { item, profile } = props;
  const where = item.criterion as Extract<MatchCriterion, { kind: "where" }>;
  const drag = useDrag(props);
  const soft = where.softMetres ?? DEFAULT_SOFT_METRES;
  const update = (zones: MatchZone[]) => {
    if (!zones.length) { props.onClose(); props.onChange(removeCriterion(profile, item.id)); return; }
    props.onChange(replaceCriterion(profile, item.id, { ...where, zones }));
  };
  return (
    <>
      <p className="criterion-card__line"><span data-testid="match-card-line">Only areas inside these (up to {MAX_ZONES})</span>{cut(props.cut)}</p>
      <ZoneChips zones={where.zones} onRemove={(zone) => {
        track("zone_change", zoneUsage("remove", zone, where.zones.length - 1));
        update(where.zones.filter((entry) => entry !== zone));
      }} />
      <ZoneAdd zones={where.zones} drawing={props.drawing ?? null} onDrawing={props.onDrawing}
        onAdd={(zone) => { track("zone_change", zoneUsage("add", zone, where.zones.length + 1)); update([...where.zones, zone]); }} />
      <p className="metric-description">{where.must ? "Must: areas outside are out." : itemLine(where, profile)}</p>
      {/* Each zone opens as a search on Rightmove, Zoopla and OnTheMarket. */}
      <div className="match-card__portals">
        <span className="match-card__portals-label">Homes there</span>
        <ZonePortalChips profile={profile} />
      </div>
      {props.fine && !where.must && (
        <label className="match-card__soft">
          <span>Outside: lower to 0 at {soft >= 1000 ? `${(soft / 1000).toFixed(1).replace(/\.0$/, "")} km` : `${soft} m`}</span>
          <input type="range" min={100} max={WHERE_SPAN.high} step={WHERE_SPAN.step} value={soft} aria-label="Where, soft edge"
            aria-valuetext={`${soft} metres`}
            onChange={(event) => drag.move(replaceCriterion(profile, item.id, { ...where, softMetres: Number(event.target.value) }))}
            onPointerUp={drag.release} onKeyUp={drag.release} onBlur={drag.release} onTouchEnd={drag.release} />
        </label>
      )}
    </>
  );
}

export function ZoneChips({ zones, onRemove }: { zones: readonly MatchZone[]; onRemove: (zone: MatchZone) => void }) {
  return (
    <ul className="zone-chips" data-testid="where-zones">
      {zones.map((zone) => (
        <li key={zoneKey(zone)} className="zone-chip">
          <span>{describeZone(zone)}{zone.kind === "polygon" ? " ✎" : ""}</span>
          <button type="button" aria-label={`Remove ${describeZone(zone)}`} onClick={() => onRemove(zone)}>
            <KnitIcon name="cross" colour="currentColor" className="knit-glyph" style={{ width: 14, height: 14 }} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "+ Add": Station · Borough · Areas (a search) or Draw on map (the corners are tapped on the map's drawing bar). */
export function ZoneAdd({ zones, onAdd, drawing, onDrawing }: {
  zones: readonly MatchZone[]; onAdd: (zone: MatchZone) => void; drawing: [number, number][] | null; onDrawing?: (draft: [number, number][] | null) => void;
}) {
  const [kind, setKind] = useState<AddKind | null>(null);
  const [query, setQuery] = useState("");
  const options = useZoneOptions(query).filter((option) => kind === null
    || (kind === "station" ? option.zone.kind === "station" : kind === "borough" ? option.zone.kind === "borough" : option.zone.kind === "lsoas"));
  const full = zones.length >= MAX_ZONES;
  return (
    <div className="zone-add">
      <div className="zone-add__kinds" role="group" aria-label="Add a zone">
        <span className="zone-add__label">+ Add</span>
        {ADD_KINDS.map((entry) => (
          <button key={entry.id} type="button" disabled={full} aria-pressed={kind === entry.id || (entry.id === "draw" && drawing !== null)} data-testid={`where-add-${entry.id}`}
            onClick={() => {
              if (entry.id === "draw") { setKind(null); onDrawing?.([]); return; }
              setKind(kind === entry.id ? null : entry.id);
            }}>{entry.label}</button>
        ))}
      </div>
      {kind && (
        <>
          <input className="knit-field" aria-label={kind === "station" ? "Find a station" : kind === "borough" ? "Find a borough" : "Find an area"}
            placeholder={kind === "station" ? "Station, e.g. Brixton" : kind === "borough" ? "Borough, e.g. Southwark" : "Area or postcode"}
            value={query} onChange={(event) => setQuery(event.target.value)} data-testid="where-search" autoFocus />
          {options.length > 0 && (
            <ul className="zone-options">
              {options.map((option) => (
                <li key={option.key}>
                  <button type="button" onClick={() => { onAdd(option.zone); setQuery(""); setKind(null); }}>{option.text}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
