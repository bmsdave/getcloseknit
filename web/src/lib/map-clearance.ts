/**
 * What may cover what on the My match map (overlay clashes). Numbered pins and your
 * places come first: a secondary label (a route line's name, a station, a school, a neighbour's price)
 * that would sit on a pin, a place card, a map control or the legend is hidden rather than drawn on top.
 * And the camera that fits the top 10 keeps them clear of the controls column and the legend, not only
 * of the top bar and the dock. Pure on rectangles, so the rules are unit-testable.
 */

import { MIN_VISIBLE_PX, type Padding } from "./map-padding";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Two boxes overlap (touching edges do not count). */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Which secondary labels to hide, in their drawing order: one that overlaps a pin, a place card, a control
 * or an earlier label still shown. An empty box (not laid out) is never hidden.
 */
export function coveredLabels(labels: readonly Box[], keep: readonly Box[], obstacles: readonly Box[]): boolean[] {
  const shown: Box[] = [];
  return labels.map((box) => {
    if (box.right <= box.left || box.bottom <= box.top) return false;
    const covered = keep.some((other) => overlaps(box, other)) || obstacles.some((other) => overlaps(box, other))
      || shown.some((other) => overlaps(box, other));
    if (!covered) shown.push(box);
    return covered;
  });
}

/**
 * Padding for a fit that also clears the map's own controls: the right edge clears the controls column
 * (My match, Layers, Show, my location), the bottom clears the legend and my location when they float
 * above the bottom edge or the phone sheet. A control outside the map frame, or below the covered bottom
 * already, adds nothing.
 */
export function clearOfControls(frame: Box, base: Padding, column: readonly Box[], floor: readonly Box[], gap = 12): Padding {
  const width = frame.right - frame.left;
  const height = frame.bottom - frame.top;
  // The part of the map left in view by the top bar and the dock: a control pads the edge nearer to it.
  const visibleLeft = frame.left + base.left, visibleRight = frame.right - base.right;
  const visibleTop = frame.top + base.top, visibleBottom = frame.bottom - base.bottom;
  let right = base.right;
  let bottom = base.bottom;
  for (const box of column) {
    if (box.right <= visibleLeft || box.left >= visibleRight || box.bottom <= visibleTop || box.top >= visibleBottom) continue;
    // Only a column on the right half of what is in view pads the right.
    if (box.left > (visibleLeft + visibleRight) / 2) right = Math.max(right, frame.right - box.left + gap);
  }
  for (const box of floor) {
    if (box.right <= visibleLeft || box.left >= visibleRight || box.bottom <= visibleTop || box.top >= visibleBottom) continue;
    if (box.top > (visibleTop + visibleBottom) / 2) bottom = Math.max(bottom, frame.bottom - box.top + gap);
  }
  // Never pad the map away: at least MIN_VISIBLE_PX of it stays each way (as paddingFor keeps).
  return {
    ...base,
    right: Math.min(right, Math.max(base.right, width - base.left - MIN_VISIBLE_PX)),
    bottom: Math.min(bottom, Math.max(base.bottom, height - base.top - MIN_VISIBLE_PX)),
  };
}

export interface PinBox { x: number; y: number; width: number; height: number }

/**
 * Screen offsets that keep pins (centred boxes, in rank order) from overlapping: pins whose boxes touch
 * form a group, laid out in a compact grid in rank order, centred where the group was. A group laid out
 * wider than it sat may then touch a pin beside it (pin 3 under pin 8's price): they join and the
 * layout runs again, until no two pins touch.
 */
export function pinOffsets(boxes: PinBox[], gap: number): [number, number][] {
  const parent = boxes.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])));
  const touch = (a: PinBox, b: PinBox) =>
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap;
  for (let one = 0; one < boxes.length; one += 1) {
    for (let other = one + 1; other < boxes.length; other += 1) {
      if (touch(boxes[one], boxes[other])) parent[root(other)] = root(one);
    }
  }
  for (let round = 0; ; round += 1) {
    const offsets = layoutGroups(boxes, gap, root);
    const placed = boxes.map((box, index) => ({ ...box, x: box.x + offsets[index][0], y: box.y + offsets[index][1] }));
    let joined = false;
    for (let one = 0; one < boxes.length; one += 1) {
      for (let other = one + 1; other < boxes.length; other += 1) {
        if (root(one) !== root(other) && touch(placed[one], placed[other])) {
          parent[root(other)] = root(one);
          joined = true;
        }
      }
    }
    if (!joined || round >= boxes.length) return offsets;
  }
}

function layoutGroups(boxes: PinBox[], gap: number, root: (index: number) => number): [number, number][] {
  const offsets: [number, number][] = boxes.map(() => [0, 0]);
  const groups = new Map<number, number[]>();
  boxes.forEach((_, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), index]));
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // A compact grid (about 3 wide for 6 pins) centred where the group was, in rank order.
    const columns = Math.min(members.length, Math.ceil(Math.sqrt(members.length * 1.5)));
    const rows: number[][] = [];
    members.forEach((index, position) => { (rows[Math.floor(position / columns)] ??= []).push(index); });
    const rowHeight = rows.map((row) => Math.max(...row.map((index) => boxes[index].height)));
    const centreX = members.reduce((sum, index) => sum + boxes[index].x, 0) / members.length;
    const centreY = members.reduce((sum, index) => sum + boxes[index].y, 0) / members.length;
    let top = centreY - (rowHeight.reduce((sum, height) => sum + height, 0) + gap * (rows.length - 1)) / 2;
    rows.forEach((row, rowIndex) => {
      const width = row.reduce((sum, index) => sum + boxes[index].width, 0) + gap * (row.length - 1);
      let left = centreX - width / 2;
      for (const index of row) {
        offsets[index] = [left + boxes[index].width / 2 - boxes[index].x, top + rowHeight[rowIndex] / 2 - boxes[index].y];
        left += boxes[index].width + gap;
      }
      top += rowHeight[rowIndex] + gap;
    });
  }
  return offsets;
}
