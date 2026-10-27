/**
 * Which of a legend's tick labels to show at its drawn width: at most 3 under 320 px,
 * never two labels closer than `gap` px; middle labels give way first (those nearest the ends before
 * the one nearest the middle), and the two ends always stay. Up to 5 when there is room.
 *
 * Positions are 0..1 along the ramp; the first label starts at 0, the last ends at 1 and the others
 * are centred on their place (styles/layout.css .map-legend-stops). Pure: the legend measures.
 */
export interface TickBox {
  position: number;
  /** The label's rendered width in px. */
  width: number;
}

export const NARROW_LEGEND_PX = 320;
export const TICK_GAP_PX = 6;

export function visibleTicks(ticks: readonly TickBox[], width: number, gap = TICK_GAP_PX): boolean[] {
  const shown = ticks.map(() => true);
  if (ticks.length <= 2 || !(width > 0)) return shown;
  const last = ticks.length - 1;
  // Middle ticks, the one nearest the middle last to go.
  const middles = ticks.map((tick, index) => ({ index, distance: Math.abs(tick.position - 0.5) }))
    .slice(1, last)
    .sort((a, b) => b.distance - a.distance || a.index - b.index)
    .map((entry) => entry.index);
  const count = () => shown.filter(Boolean).length;
  const extent = (index: number): [number, number] => {
    const { position, width: own } = ticks[index];
    if (index === 0) return [0, own];
    if (index === last) return [width - own, width];
    const centre = position * width;
    return [centre - own / 2, centre + own / 2];
  };
  const overlaps = () => {
    const open = shown.flatMap((on, index) => (on ? [extent(index)] : []));
    return open.some((box, index) => index > 0 && open[index - 1][1] + gap > box[0]);
  };
  for (const index of middles) {
    const tooMany = width < NARROW_LEGEND_PX ? count() > 3 : count() > 5;
    if (!tooMany && !overlaps()) break;
    shown[index] = false;
  }
  return shown;
}
