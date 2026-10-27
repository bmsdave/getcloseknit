/**
 * Value morph between two periods of the area fill. One fill layer reads two
 * values per area from feature-state (keys `a` and `b`) and colours the blend
 * (1 − t)·a + t·b, so mid-morph every area shows a real value on the same
 * colour ramp at the layer's usual opacity (no stacked layers, nothing for
 * the basemap to show through).
 *
 * A morph writes the incoming period into the key that has no weight, then
 * moves t towards it one animation frame at a time. When it lands, that key
 * holds the shown period and the next period goes into the other one, so
 * the keys alternate and no pack is ever copied.
 *
 * Why t lives in feature-state and not in the paint expression: MapLibre
 * treats any change to a data-driven paint property as a layout change and
 * reloads every tile of the source in its worker (measured on 5k LSOAs: about
 * 8 visible updates a second). Writing t to each area's feature-state only
 * re-evaluates that layer's paint arrays, which the fill keeps on a source of
 * its own (see area-map).
 */
import type { ExpressionSpecification } from "maplibre-gl";

import { logColourExpression } from "./price-scale";

export type MorphKey = "a" | "b";
/** Feature-state key of the blend weight on `b` (0..1). */
export const MORPH_WEIGHT_KEY = "t";

/** Feature-state key of a side's evidence quality (`qa`, `qb`); the value sits under the side's own key. */
export function qualityKey(key: MorphKey): string {
  return `q${key}`;
}

const state = (key: string) => ["feature-state", key] as unknown as ExpressionSpecification;
const A = state("a");
const B = state("b");
const T = ["to-number", state(MORPH_WEIGHT_KEY), 0] as unknown as ExpressionSpecification;

/** (1 − t)·left + t·right, each side falling back to the other when missing. */
function blend(left: ExpressionSpecification, right: ExpressionSpecification): ExpressionSpecification {
  return [
    "+",
    ["*", ["-", 1, T], ["coalesce", left, right]],
    ["*", T, ["coalesce", right, left]],
  ] as unknown as ExpressionSpecification;
}

/**
 * The blended value an area shows: (1 − t)·a + t·b. A missing side takes
 * the other side's value, so an area known in only one period keeps that
 * colour through the morph instead of passing through unknown.
 */
export function morphValueExpression(): ExpressionSpecification {
  return blend(A, B);
}

/** True where neither period has a value: the area reads unknown. */
export function morphUnknownExpression(): ExpressionSpecification {
  return ["all", ["==", A, null], ["==", B, null]] as unknown as ExpressionSpecification;
}

/**
 * The fill colour: unknown where neither period has a value, else the
 * legend's ramp at the blended value — on ln(value) for the log price scale,
 * so every break-to-break step takes its equal share as the legend draws it.
 */
/**
 * The legend's stops with ties collapsed to their first colour. MapLibre refuses an interpolate
 * whose inputs are not strictly ascending, and a legend cut at percentiles ties when many areas
 * share a value (New homes pipeline: the 10th and 30th percentiles are both 0), which left the
 * fill at the unknown colour for every area.
 */
export function ascendingStops<T extends { value: number }>(stops: readonly T[]): T[] {
  return stops.filter((stop, index) => index === 0 || stop.value > stops[index - 1].value);
}

export function morphColourExpression(
  legend: readonly { value: number; colour: string }[],
  axis: "linear" | "log",
  unknownColour: string,
): ExpressionSpecification {
  const input = morphValueExpression();
  const stops = ascendingStops(legend);
  const ramp = axis === "log"
    ? logColourExpression(input, stops)
    : ["interpolate", ["linear"], input, ...stops.flatMap((stop) => [stop.value, stop.colour])];
  return ["case", morphUnknownExpression(), unknownColour, ramp] as unknown as ExpressionSpecification;
}

/**
 * The fill opacity: the opacity each side's evidence quality gets, blended
 * with the same weight, so an area that turns from observed to fallback
 * fades rather than jumps.
 */
export function morphOpacityExpression(
  opacityFor: (quality: ExpressionSpecification) => ExpressionSpecification,
): ExpressionSpecification {
  const [qa, qb] = [state(qualityKey("a")), state(qualityKey("b"))];
  const side = (own: ExpressionSpecification, other: ExpressionSpecification) =>
    opacityFor(["coalesce", own, other] as unknown as ExpressionSpecification);
  return [
    "+",
    ["*", ["-", 1, T], side(qa, qb)],
    ["*", T, side(qb, qa)],
  ] as unknown as ExpressionSpecification;
}

export function otherKey(key: MorphKey): MorphKey {
  return key === "a" ? "b" : "a";
}

/** The weight t at which a key shows alone. */
export function keyWeight(key: MorphKey): number {
  return key === "b" ? 1 : 0;
}

/** Weight t at progress p (0..1) of a morph towards `key`. */
export function morphWeight(key: MorphKey, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return key === "b" ? p : 1 - p;
}

/** The value an area shows at weight t (JS twin of morphValueExpression). */
export function blendValue(a: number | null, b: number | null, t: number): number | null {
  const left = a ?? b;
  const right = b ?? a;
  if (left === null || right === null) return null;
  return (1 - t) * left + t * right;
}

export interface MorphEntry {
  geographyId: string;
  value: number | null;
  quality: string;
}

interface Side {
  value: number | null;
  quality: string | null;
}

const EMPTY: Side = { value: null, quality: null };

export interface MorphStore {
  /** Write values into a key: only areas whose side changed, each with weight t. */
  load(key: MorphKey, entries: readonly MorphEntry[], t: number): void;
  /** Weight t on the areas whose two sides differ (the only ones it moves). */
  weigh(t: number): void;
  /** Areas without a value (or quality) in `key` drop the other key's, so they read as `key` alone. */
  settle(key: MorphKey): void;
  /** The value an area shows at weight t. */
  shown(id: string, t: number): number | null;
  /** Areas the last load left with two different sides. */
  readonly moving: number;
}

function differs(left: number | string | null, right: number | string | null): boolean {
  return left !== null && right !== null && left !== right;
}

/**
 * Mirror of the fill's feature-state: what each key holds per area, so a
 * load writes only what changed and a frame writes t only where it matters.
 */
export function createMorphStore(write: (id: string, state: Record<string, unknown>) => void): MorphStore {
  const sides: Record<MorphKey, Map<string, Side>> = { a: new Map(), b: new Map() };
  let moving: string[] = [];

  function load(key: MorphKey, entries: readonly MorphEntry[], t: number) {
    const held = sides[key];
    const seen = new Set<string>();
    const put = (id: string, side: Side) => {
      write(id, { [key]: side.value, [qualityKey(key)]: side.quality, [MORPH_WEIGHT_KEY]: t });
      held.set(id, side);
    };
    for (const entry of entries) {
      seen.add(entry.geographyId);
      const previous = held.get(entry.geographyId);
      if (previous?.value !== entry.value || previous.quality !== entry.quality) {
        put(entry.geographyId, { value: entry.value, quality: entry.quality });
      }
    }
    // Areas the view leaves out hold nothing in this key.
    for (const [id, side] of held) {
      if (!seen.has(id) && (side.value !== null || side.quality !== null)) put(id, EMPTY);
    }
    const other = sides[otherKey(key)];
    moving = [];
    for (const [id, side] of held) {
      const theirs = other.get(id) ?? EMPTY;
      if (differs(side.value, theirs.value) || differs(side.quality, theirs.quality)) moving.push(id);
    }
  }

  function weigh(t: number) {
    for (const id of moving) write(id, { [MORPH_WEIGHT_KEY]: t });
  }

  function settle(key: MorphKey) {
    const held = sides[key];
    const name = otherKey(key);
    for (const [id, theirs] of sides[name]) {
      const own = held.get(id) ?? EMPTY;
      const dropValue = own.value === null && theirs.value !== null;
      const dropQuality = own.quality === null && theirs.quality !== null;
      if (!dropValue && !dropQuality) continue;
      const next: Side = { value: dropValue ? null : theirs.value, quality: dropQuality ? null : theirs.quality };
      write(id, {
        ...(dropValue ? { [name]: null } : {}),
        ...(dropQuality ? { [qualityKey(name)]: null } : {}),
      });
      sides[name].set(id, next);
    }
  }

  return {
    load,
    weigh,
    settle,
    shown: (id, t) => blendValue(sides.a.get(id)?.value ?? null, sides.b.get(id)?.value ?? null, t),
    get moving() { return moving.length; },
  };
}

export interface MorphDriver<View> {
  /**
   * Write a view's values into `key`. Areas whose value there changes also
   * get weight `t` (the weight on screen), so the write itself shows nothing new.
   */
  load(key: MorphKey, view: View, t: number): void;
  /** Weight t on every area whose two values differ. */
  weigh(t: number): void;
  /** `key` now shows alone: areas it has no value for drop the other key's value and read unknown. */
  settle(key: MorphKey): void;
  /** A view starts to show: its morph begins, or it lands at once. */
  begin(view: View): void;
  now(): number;
  frame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface Morph<View> {
  /**
   * Show a view: at once when durationMs ≤ 0 (a morph in flight lands
   * first), else morph to it, starting at `startAt` (driver clock) when given
   * and not yet past, else now. A view that arrives mid-morph waits for the
   * morph to land and starts where it ended (or at its own `startAt`, if
   * later), so back-to-back steps never pause; a later arrival replaces a
   * waiting one.
   */
  show(view: View, durationMs: number, startAt?: number | null): void;
  /** Stop without touching the map (teardown). */
  dispose(): void;
  readonly morphing: boolean;
  /** Progress 0..1 of the morph in flight (0 at rest). */
  readonly progress: number;
  /** Weight t on screen. */
  readonly weight: number;
  /** The view shown, or being morphed to. */
  readonly current: View | null;
  /** The newest view asked for (a waiting one, else current). */
  readonly latest: View | null;
  /** Morphs landed so far. */
  readonly landed: number;
}

export function createMorph<View>(driver: MorphDriver<View>): Morph<View> {
  let shown: MorphKey = "a";
  let weight = keyWeight(shown);
  let current: View | null = null;
  let flight: { key: MorphKey; view: View; start: number; duration: number; begun: boolean } | null = null;
  let waiting: { view: View; duration: number; startAt: number | null } | null = null;
  let progress = 0;
  let landed = 0;
  let handle: number | null = null;

  function show(view: View, durationMs: number, startAt: number | null = null) {
    if (!(durationMs > 0) || current === null) {
      jump(view);
      return;
    }
    if (flight) {
      waiting = { view, duration: durationMs, startAt };
      return;
    }
    start(view, durationMs, Math.max(driver.now(), startAt ?? -Infinity));
    handle = driver.frame(step);
  }

  function jump(view: View) {
    cancel();
    waiting = null;
    if (flight) land();
    driver.load(shown, view, weight);
    driver.settle(shown);
    current = view;
    driver.begin(view);
  }

  /** Load the view into the key without weight (nothing changes on screen); frames move it from `at`. */
  function start(view: View, duration: number, at: number) {
    const key = otherKey(shown);
    driver.load(key, view, weight);
    flight = { key, view, start: at, duration, begun: false };
    current = view;
    progress = 0;
  }

  function step() {
    handle = null;
    if (!flight) return;
    const p = (driver.now() - flight.start) / flight.duration;
    if (p < 0) {
      handle = driver.frame(step);
      return;
    }
    if (!flight.begun) {
      flight.begun = true;
      driver.begin(flight.view);
    }
    if (p >= 1) {
      const end = flight.start + flight.duration;
      land();
      if (!waiting) return;
      const next = waiting;
      waiting = null;
      start(next.view, next.duration, Math.max(end, next.startAt ?? -Infinity));
      step();
      return;
    }
    progress = p;
    weight = morphWeight(flight.key, p);
    driver.weigh(weight);
    handle = driver.frame(step);
  }

  function land() {
    if (!flight) return;
    if (!flight.begun) driver.begin(flight.view);
    weight = keyWeight(flight.key);
    driver.weigh(weight);
    driver.settle(flight.key);
    shown = flight.key;
    flight = null;
    progress = 0;
    landed += 1;
  }

  function cancel() {
    if (handle !== null) driver.cancelFrame(handle);
    handle = null;
  }

  return {
    show,
    dispose() {
      cancel();
      flight = null;
      waiting = null;
    },
    get morphing() { return flight !== null; },
    get progress() { return progress; },
    get weight() { return weight; },
    get current() { return current; },
    get latest() { return waiting?.view ?? current; },
    get landed() { return landed; },
  };
}
