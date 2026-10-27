/**
 * FLIP for a list that re-sorts (My match's rows): measure every row before the DOM changes, measure again after,
 * invert each moved row with a transform and let a transition play it to its new place. Elements are a minimal
 * surface so tests run without a DOM.
 */
export interface FlipElement {
  style: { transform: string; transition: string };
  getBoundingClientRect(): { top: number };
  /** Read to force a reflow between the inverted transform and the transition (any layout property). */
  offsetHeight?: number;
}

export interface FlipPlay {
  /** How long the slide takes. */
  ms: number;
  easing?: string;
  /** prefers-reduced-motion: rows jump to their place, no transition. */
  reduced?: boolean;
}

/** Each row's top as it shows now (a transform mid-flight counts: the next slide starts where this one is). */
export function measureTops(rows: ReadonlyMap<string, FlipElement>): Map<string, number> {
  const tops = new Map<string, number>();
  for (const [id, element] of rows) tops.set(id, element.getBoundingClientRect().top);
  return tops;
}

/** Clears every inline transform (and its transition) so the rows measure at their layout place. */
export function settleRows(rows: ReadonlyMap<string, FlipElement>): void {
  for (const element of rows.values()) {
    element.style.transition = "none";
    element.style.transform = "";
  }
}

/** How far each row moved (before − after, px): only rows present in both measurements that did move. */
export function flipDeltas(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const [id, top] of after) {
    const was = before.get(id);
    if (was === undefined) continue;
    const delta = was - top;
    if (Math.abs(delta) >= 0.5) deltas.set(id, delta);
  }
  return deltas;
}

/** Inverts each row by its delta and plays the transition to its layout place (none with reduced motion). */
export function playFlip(rows: ReadonlyMap<string, FlipElement>, deltas: ReadonlyMap<string, number>, play: FlipPlay): void {
  for (const [id, delta] of deltas) {
    const element = rows.get(id);
    if (!element) continue;
    if (play.reduced) {
      element.style.transition = "none";
      element.style.transform = "";
      continue;
    }
    element.style.transition = "none";
    element.style.transform = `translateY(${delta}px)`;
    void element.offsetHeight;
    element.style.transition = `transform ${play.ms}ms ${play.easing ?? "ease"}`;
    element.style.transform = "";
  }
}

/** The lifted row follows the pointer: its visual top is the pointer less where it was grabbed, above its layout top. */
export function liftTransform(pointerY: number, grabOffset: number, layoutTop: number, scale = 1.02): string {
  return `translateY(${Math.round(pointerY - grabOffset - layoutTop)}px) scale(${scale})`;
}
