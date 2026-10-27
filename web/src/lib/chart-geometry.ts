/**
 * Pure geometry for the chart kit (components/charts). Every function is
 * deterministic and DOM-free so the shapes can be unit-tested.
 */

/** A colour slot: --chart-1..6, or the worse / better / neutral tokens. */
export type ChartTone = "c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "bad" | "good" | "neutral";

/** Which end of a 1–10 score is the worrying one. */
export type ScoreDirection = "worse-high" | "better-high" | "neutral";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Where value sits between min and max, clamped to 0..1 (0.5 on a flat range). */
export function scalePosition(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max === min) return 0.5;
  return clamp((value - min) / (max - min), 0, 1);
}

/**
 * Percent widths for a 100% bar. Zero parts stay zero; every other part is
 * at least minVisible wide, taken from the bigger parts in proportion to how
 * far they sit above the minimum. The result always sums to 100.
 */
export function stackWidths(values: number[], minVisible = 1.5): number[] {
  const clean = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = clean.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return clean.map(() => 0);
  const raw = clean.map((value) => (value / total) * 100);
  const visible = raw.filter((width) => width > 0).length;
  if (visible * minVisible >= 100) return raw.map((width) => (width > 0 ? 100 / visible : 0));
  const deficit = raw.reduce((sum, width) => sum + (width > 0 && width < minVisible ? minVisible - width : 0), 0);
  if (deficit === 0) return raw;
  const excess = raw.reduce((sum, width) => sum + Math.max(0, width - minVisible), 0);
  return raw.map((width) => {
    if (width === 0) return 0;
    if (width < minVisible) return minVisible;
    return width - (deficit * (width - minVisible)) / excess;
  });
}

/** Filled cells (0..100) in a 10×10 waffle: any share above 0 shows, any share below 1 leaves a gap. */
export function waffleCells(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return 0;
  if (share >= 1) return 100;
  return clamp(Math.round(share * 100), 1, 99);
}

/** Filled segments (0..10) for a 1–10 score; unknown fills none. */
export function segmentFill(score: number | null): number {
  if (score === null || !Number.isFinite(score)) return 0;
  return clamp(Math.round(score), 0, 10);
}

/** Fill colour for a 1–10 score: only a score with a direction gets bad / good. */
export function segmentTone(score: number, direction: ScoreDirection): ChartTone {
  if (direction === "neutral") return "c1";
  const high = direction === "worse-high" ? "bad" : "good";
  const low = direction === "worse-high" ? "good" : "bad";
  if (score >= 7) return high;
  if (score <= 3) return low;
  return "neutral";
}

/**
 * A point at distance and bearing (degrees clockwise from north) on rings
 * whose outer radius stands for maxDistance. Further points sit on the rim.
 * SVG coordinates: x to the right, y down, origin at the centre.
 */
export function ringPoint(distance: number, bearingDeg: number, maxDistance: number, radius: number): { x: number; y: number } {
  if (maxDistance <= 0) return { x: 0, y: 0 };
  const r = (clamp(distance, 0, maxDistance) / maxDistance) * radius;
  const angle = (bearingDeg * Math.PI) / 180;
  return { x: r * Math.sin(angle), y: -r * Math.cos(angle) };
}

/**
 * Nudges markers (centred coordinates) apart until no two are closer than
 * gap, keeping each within radius. Small, fixed number of passes: enough for
 * the handful of points a panel shows, and stable between renders.
 */
export function spreadMarkers(points: { x: number; y: number }[], gap: number, radius: number): { x: number; y: number }[] {
  const out = points.map((point) => ({ ...point }));
  for (let pass = 0; pass < 60; pass += 1) {
    let moved = false;
    for (let a = 0; a < out.length; a += 1) {
      for (let b = a + 1; b < out.length; b += 1) {
        let dx = out[b].x - out[a].x;
        let dy = out[b].y - out[a].y;
        let distance = Math.hypot(dx, dy);
        if (distance >= gap) continue;
        if (distance < 1e-6) { dx = Math.cos(a + b); dy = Math.sin(a + b); distance = 1; }
        const push = (gap - distance) / 2 + 0.01;
        out[a].x -= (dx / distance) * push; out[a].y -= (dy / distance) * push;
        out[b].x += (dx / distance) * push; out[b].y += (dy / distance) * push;
        moved = true;
      }
    }
    for (const point of out) {
      const distance = Math.hypot(point.x, point.y);
      if (distance > radius) { point.x *= radius / distance; point.y *= radius / distance; }
    }
    if (!moved) break;
  }
  return out;
}

/** A share (0..1) as a whole percent; tiny and near-total shares are named, never rounded away. */
export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  if (share < 0.01) return "under 1%";
  if (share < 1 && share > 0.99) return "over 99%";
  return `${Math.round(share * 100)}%`;
}

/** "500 m", "1 km", "1.5 km": ring captions. */
export function ringLabel(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${Number((metres / 1000).toFixed(1))} km`;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Eight-point compass name for a bearing in degrees. */
export function compassPoint(bearingDeg: number): string {
  const index = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[index];
}

/** Position of the band with this id, or -1. */
export function bandIndex(bands: readonly { id: string }[], id: string | null | undefined): number {
  if (id === null || id === undefined) return -1;
  return bands.findIndex((band) => band.id === id);
}
