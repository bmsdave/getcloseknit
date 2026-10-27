import assert from "node:assert/strict";
import test from "node:test";

import {
  blendValue,
  createMorph,
  createMorphStore,
  keyWeight,
  ascendingStops,
  morphColourExpression,
  morphOpacityExpression,
  morphUnknownExpression,
  morphValueExpression,
  morphWeight,
  type MorphEntry,
} from "../src/lib/map-morph";
import { selectionFillOpacity } from "../src/lib/map-selection-paint";
import { logColourExpression } from "../src/lib/price-scale";

/** The few MapLibre expression operators the morph uses, evaluated against one area's feature-state. */
function evaluate(expression: unknown, state: Record<string, unknown>): unknown {
  const run = (node: unknown): unknown => {
    if (!Array.isArray(node)) return node;
    const [operator, ...args] = node as [string, ...unknown[]];
    const numbers = () => args.map((arg) => run(arg) as number);
    switch (operator) {
      case "feature-state": return state[args[0] as string] ?? null;
      case "to-number": {
        const value = run(args[0]);
        return typeof value === "number" ? value : run(args[1]);
      }
      case "coalesce": {
        for (const arg of args) {
          const value = run(arg);
          if (value !== null && value !== undefined) return value;
        }
        return null;
      }
      case "+": return numbers().reduce((sum, value) => sum + value, 0);
      case "*": return numbers().reduce((product, value) => product * value, 1);
      case "-": { const [left, right] = numbers(); return left - right; }
      case "==": return run(args[0]) === run(args[1]);
      case "all": return args.every((arg) => run(arg) === true);
      case "boolean": { const value = run(args[0]); return typeof value === "boolean" ? value : run(args[1]); }
      case "case":
        for (let index = 0; index < args.length - 1; index += 2) {
          if (run(args[index])) return run(args[index + 1]);
        }
        return run(args[args.length - 1]);
      default: throw new Error(`unsupported operator in test evaluator: ${operator}`);
    }
  };
  return run(expression);
}

// Blend expression

test("the blend expression shows (1 − t)·a + t·b and falls back to the side that is known", () => {
  const value = morphValueExpression();
  assert.equal(evaluate(value, { a: 1000, b: 2000, t: 0 }), 1000);
  assert.equal(evaluate(value, { a: 1000, b: 2000, t: 0.25 }), 1250);
  assert.equal(evaluate(value, { a: 1000, b: 2000, t: 1 }), 2000);
  assert.equal(evaluate(value, { a: 1000, b: 2000 }), 1000, "no weight yet reads as a");
  for (const t of [0, 0.5, 1]) {
    assert.equal(evaluate(value, { a: null, b: 2000, t }), 2000);
    assert.equal(evaluate(value, { a: 1000, t }), 1000);
  }
  assert.equal(evaluate(morphUnknownExpression(), { a: null, b: null, t: 0.5 }), true);
  assert.equal(evaluate(morphUnknownExpression(), { a: null, b: 3, t: 0.5 }), false);
  assert.equal(evaluate(value, { a: 1000, b: 2000, t: 0.25 }), blendValue(1000, 2000, 0.25));
  assert.equal(blendValue(null, null, 0.5), null);
});

test("the fill colour is the legend ramp at the blended value, unknown when neither side is known", () => {
  const stops = [{ value: 1000, colour: "#000000" }, { value: 10000, colour: "#ffffff" }];
  const log = morphColourExpression(stops, "log", "#cccccc") as unknown[];
  assert.deepEqual(log, ["case", morphUnknownExpression(), "#cccccc", logColourExpression(morphValueExpression(), stops)]);
  const linear = morphColourExpression(stops, "linear", "#cccccc") as unknown[];
  assert.deepEqual(linear[3], ["interpolate", ["linear"], morphValueExpression(), 1000, "#000000", 10000, "#ffffff"]);
  // Nothing in the colour reads the whole-layer opacity or a second layer.
  assert.ok(!JSON.stringify(log).includes("layer-opacity"));
});

test("a legend with tied stops still paints: ties collapse so interpolate inputs stay strictly ascending", () => {
  // The New homes pipeline legend on prod (2026-10-20): the 10th and 30th percentiles were both 0,
  // MapLibre rejected the fill colour and every area stayed grey.
  const legend = [
    { value: 0, colour: "#c7e9b4" }, { value: 0, colour: "#7fcdbb" }, { value: 8.1, colour: "#1d91c0" },
    { value: 28.97, colour: "#253494" }, { value: 199.5, colour: "#081d58" },
  ];
  assert.deepEqual(ascendingStops(legend).map((stop) => stop.value), [0, 8.1, 28.97, 199.5]);
  const ramp = (morphColourExpression(legend, "linear", "#cccccc") as unknown[])[3] as unknown[];
  const inputs = ramp.slice(3).filter((_, index) => index % 2 === 0) as number[];
  assert.deepEqual(inputs, [0, 8.1, 28.97, 199.5]);
  assert.ok(inputs.every((value, index) => index === 0 || value > inputs[index - 1]), "strictly ascending");
  // A zero area takes the first colour; the rest of the legend keeps its colours.
  assert.equal(ramp[4], "#c7e9b4");
  assert.equal(ramp[6], "#1d91c0");
  assert.deepEqual(ascendingStops([{ value: 5 }, { value: 5 }, { value: 5 }]), [{ value: 5 }]);
});

test("the fill opacity blends each side's evidence quality with the same weight", () => {
  const opacity = morphOpacityExpression(selectionFillOpacity);
  assert.equal(evaluate(opacity, { qa: "observed", qb: "observed", t: 0.3 }), 0.88);
  const middle = evaluate(opacity, { qa: "observed", qb: "fallback", t: 0.5 }) as number;
  assert.ok(Math.abs(middle - 0.84) < 1e-9, String(middle));
  assert.equal(evaluate(opacity, { qa: "observed", qb: "suppressed", t: 1 }), 0.35);
  assert.equal(evaluate(opacity, { qa: null, qb: "fallback", t: 0 }), 0.8, "a missing side takes the other");
  assert.equal(evaluate(opacity, { qa: "observed", qb: "observed", t: 0, selected: true }), 0.95);
});

// Feature-state mirror

function fakeFeatureState() {
  const states = new Map<string, Record<string, unknown>>();
  const writes: { id: string; state: Record<string, unknown> }[] = [];
  return {
    states,
    writes,
    write(id: string, state: Record<string, unknown>) {
      writes.push({ id, state });
      states.set(id, { ...(states.get(id) ?? {}), ...state });
    },
    /** What an area shows, from its feature-state, as MapLibre would evaluate it. */
    shown(id: string) {
      const state = states.get(id) ?? {};
      return evaluate(morphUnknownExpression(), state) ? null : evaluate(morphValueExpression(), state) as number;
    },
  };
}

const entries = (values: Record<string, number | null>, quality = "observed"): MorphEntry[] =>
  Object.entries(values).map(([geographyId, value]) => ({ geographyId, value, quality }));

test("a load writes only areas whose value or quality changed, and a frame only moving areas", () => {
  const map = fakeFeatureState();
  const store = createMorphStore(map.write);
  store.load("a", entries({ x: 1, y: 2, z: 3 }), 0);
  assert.equal(map.writes.length, 3);
  map.writes.length = 0;
  store.load("a", entries({ x: 1, y: 2, z: 3 }), 0);
  assert.equal(map.writes.length, 0, "the same values again write nothing");
  store.load("a", entries({ x: 1, y: 5, z: 3 }), 0);
  assert.deepEqual(map.writes.map((write) => write.id), ["y"]);
  map.writes.length = 0;
  store.load("b", entries({ x: 1, y: 6, z: 4 }), 0);
  assert.equal(store.moving, 2, "x holds the same value on both sides");
  map.writes.length = 0;
  store.weigh(0.5);
  assert.deepEqual(map.writes.map((write) => write.id).sort(), ["y", "z"]);
  assert.equal(map.shown("z"), 3.5);
  // Quality alone also moves (opacity blends).
  store.load("a", [{ geographyId: "x", value: 1, quality: "fallback" }], 0.5);
  assert.equal(store.moving, 1);
});

test("an area known on one side keeps its colour through a morph and reads unknown once it lands", () => {
  const map = fakeFeatureState();
  const store = createMorphStore(map.write);
  store.load("a", entries({ x: 10, gone: 20 }), 0);
  store.load("b", entries({ x: 30, gone: null, fresh: 40 }), 0);
  store.weigh(0.5);
  assert.equal(map.shown("gone"), 20);
  assert.equal(map.shown("fresh"), 40);
  store.weigh(1);
  store.settle("b");
  assert.equal(map.shown("gone"), null);
  assert.equal(map.shown("fresh"), 40);
  assert.equal(map.shown("x"), 30);
});

// Morph timing and a/b rotation

function fakeDriver() {
  let clock = 0;
  const frames = new Map<number, () => void>();
  let nextHandle = 1;
  const map = fakeFeatureState();
  const store = createMorphStore(map.write);
  const loads: string[] = [];
  const begun: string[] = [];
  const weights: number[] = [];
  const views: Record<string, Record<string, number>> = {};
  return {
    map,
    loads,
    begun,
    weights,
    view(name: string, values: Record<string, number>) {
      views[name] = values;
      return name;
    },
    pendingFrames: () => frames.size,
    advance(ms: number) {
      clock += ms;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback();
    },
    driver: {
      load: (key: "a" | "b", view: string, t: number) => {
        loads.push(`${view}→${key}`);
        store.load(key, entries(views[view]), t);
      },
      weigh: (t: number) => {
        weights.push(Math.round(t * 1000) / 1000);
        store.weigh(t);
      },
      settle: (key: "a" | "b") => store.settle(key),
      begin: (view: string) => begun.push(view),
      now: () => clock,
      frame: (callback: () => void) => {
        const handle = nextHandle++;
        frames.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle: number) => frames.delete(handle),
    },
  };
}

test("weights alternate between the keys: each period goes into the key that just reached weight 0", () => {
  const fake = fakeDriver();
  const morph = createMorph(fake.driver);
  morph.show(fake.view("2006", { x: 100 }), 400);
  assert.deepEqual(fake.loads, ["2006→a"], "the first view lands at once");
  morph.show(fake.view("2007", { x: 200 }), 400);
  assert.deepEqual(fake.loads, ["2006→a", "2007→b"]);
  assert.equal(fake.map.shown("x"), 100, "loading the free key shows nothing new");
  fake.advance(100);
  assert.equal(fake.map.shown("x"), 125);
  assert.equal(morph.weight, 0.25);
  fake.advance(300); // lands
  assert.equal(morph.morphing, false);
  assert.equal(fake.map.shown("x"), 200);
  morph.show(fake.view("2008", { x: 400 }), 400);
  assert.deepEqual(fake.loads.at(-1), "2008→a", "the key that reached weight 0 takes the next period");
  fake.advance(100);
  fake.advance(200);
  assert.equal(fake.map.shown("x"), 350);
  assert.ok(morph.weight > 0 && morph.weight < 1);
  fake.advance(200);
  assert.equal(fake.map.shown("x"), 400);
  assert.equal(morph.landed, 2);
  // Weights run up, then down: each morph is monotonic towards its key.
  const [up, down] = [fake.weights.slice(0, 2), fake.weights.slice(2)];
  assert.deepEqual(up, [0.25, 1]);
  assert.deepEqual(down, [0.75, 0.25, 0]);
  assert.equal(keyWeight("a"), 0);
  assert.equal(morphWeight("a", 0.25), 0.75);
});

test("a step that arrives mid-morph starts exactly where the morph lands, so motion never pauses", () => {
  const fake = fakeDriver();
  const morph = createMorph(fake.driver);
  morph.show(fake.view("A", { x: 0 }), 0);
  morph.show(fake.view("B", { x: 100 }), 400);
  fake.advance(300);
  morph.show(fake.view("C", { x: 200 }), 400);
  morph.show(fake.view("D", { x: 300 }), 400); // replaces C while it waits
  assert.equal(morph.latest, "D");
  assert.equal(morph.current, "B");
  fake.advance(200); // B landed at 400; D runs from 400, so at 500 it is a quarter in
  assert.equal(morph.current, "D");
  assert.equal(fake.map.shown("x"), 150);
  assert.deepEqual(fake.loads, ["A→a", "B→b", "D→a"]);
  fake.advance(300);
  assert.equal(fake.map.shown("x"), 300);
  assert.equal(fake.pendingFrames(), 0);
});

test("a playback step waits for its beat; an instant show lands the morph in flight", () => {
  const fake = fakeDriver();
  const morph = createMorph(fake.driver);
  morph.show(fake.view("A", { x: 0 }), 0);
  morph.show(fake.view("B", { x: 100 }), 400, 200); // due at 200
  fake.advance(100);
  assert.equal(fake.map.shown("x"), 0);
  assert.deepEqual(fake.begun, ["A"], "the legend moves when the morph does");
  fake.advance(200); // 300: a quarter in
  assert.equal(fake.map.shown("x"), 25);
  assert.deepEqual(fake.begun, ["A", "B"]);
  morph.show(fake.view("C", { x: 500 }), 0); // reduced motion, another layer
  assert.equal(morph.morphing, false);
  assert.equal(fake.map.shown("x"), 500);
  assert.deepEqual(fake.loads.at(-1), "C→b", "lands B, then rewrites the shown key in place");
  assert.equal(fake.pendingFrames(), 0);
  morph.show(fake.view("D", { x: 0 }), 400);
  morph.dispose();
  assert.equal(fake.pendingFrames(), 0);
});

test("a morph keeps every area's shown value continuous across rotations", () => {
  const fake = fakeDriver();
  const morph = createMorph(fake.driver);
  const years = [100, 180, 150, 400, 400, 90];
  morph.show(fake.view("y0", { x: years[0], y: years[0] * 2 }), 0);
  let previous = fake.map.shown("x")!;
  for (let index = 1; index < years.length; index += 1) {
    morph.show(fake.view(`y${index}`, { x: years[index], y: years[index] * 2 }), 400);
    for (let frame = 0; frame < 30; frame += 1) {
      fake.advance(16);
      const shown = fake.map.shown("x")!;
      const span = Math.abs(years[index] - years[index - 1]);
      assert.ok(Math.abs(shown - previous) <= span * (16 / 400) + 1e-9, `jump ${previous} → ${shown}`);
      previous = shown;
    }
    assert.equal(fake.map.shown("y"), years[index] * 2);
  }
});
