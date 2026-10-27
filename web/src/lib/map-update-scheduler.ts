export interface FrameDriver {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface CoalescingScheduler {
  request(work: () => void): void;
  cancel(): void;
}

export interface UpdateScope {
  issue(): number;
  isCurrent(candidate: number): boolean;
  invalidate(): void;
}

export function createCoalescingScheduler(driver: FrameDriver): CoalescingScheduler {
  let pending: number | null = null;
  let work: (() => void) | null = null;
  return { request, cancel };

  function request(next: () => void): void {
    work = next;
    if (pending !== null) return;
    pending = driver.request(flush);
  }

  function cancel(): void {
    if (pending !== null) driver.cancel(pending);
    pending = null;
    work = null;
  }

  function flush(): void {
    pending = null;
    const run = work;
    work = null;
    run?.();
  }
}

export function createUpdateScope(): UpdateScope {
  let sequence = 0;
  let live = 0;
  return { issue, isCurrent, invalidate };

  function issue(): number {
    sequence += 1;
    live = sequence;
    return sequence;
  }

  function isCurrent(candidate: number): boolean {
    return candidate === live;
  }

  function invalidate(): void {
    live = -1;
  }
}
