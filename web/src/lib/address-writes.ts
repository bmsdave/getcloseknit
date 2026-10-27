/**
 * The map writes its state into the address (history.replaceState) and the saved view. Monthly
 * playback moves the month five times a second: Safari refuses more than 100 history writes in
 * 30 seconds, and Next's router re-renders on each one. So a write that only moves the month waits
 * until ADDRESS_WRITE_GAP_MS after the last one, and the latest month wins; any other change (a
 * layer, an area, the camera) is written at once (components/use-explorer-controller.ts).
 */
export const ADDRESS_WRITE_GAP_MS = 400;

/** How long to wait before writing: 0 when there was no write yet or the last is long enough ago. */
export function addressWriteDelay(now: number, last: number | null, gap = ADDRESS_WRITE_GAP_MS): number {
  return last === null ? 0 : Math.max(0, last + gap - now);
}

/** Whether two address queries differ in the month (?period=) alone. */
export function onlyPeriodChanged(previous: string | null, next: string): boolean {
  if (previous === null || previous === next) return false;
  const strip = (query: string) => {
    const parameters = new URLSearchParams(query);
    parameters.delete("period");
    return parameters.toString();
  };
  return strip(previous) === strip(next);
}
