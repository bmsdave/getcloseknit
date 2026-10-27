// The lazy results line: a result is fetched only once its card scrolls into view. Cards that come into view
// within a short pause go together, at most 30 to a request.

export const LAZY_DELAY_MS = 150;

export interface LazyBatcherOptions<T> {
  /** Called with each batch, one at a time. */
  flush(items: T[]): Promise<void>;
  max: number;
  delayMs?: number;
  /** setTimeout, or a fake in tests. */
  schedule?: (run: () => void, ms: number) => unknown;
}

/** Collects visible items and sends them in batches of at most `max` after a short pause. */
export function lazyBatcher<T>(options: LazyBatcherOptions<T>): { add(item: T): void; idle(): Promise<void> } {
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const pending: T[] = [];
  let timer = false;
  let chain: Promise<void> = Promise.resolve();
  const drain = () => {
    timer = false;
    while (pending.length) {
      const batch = pending.splice(0, options.max);
      chain = chain.then(() => options.flush(batch)).catch(() => undefined);
    }
  };
  return {
    add(item) {
      pending.push(item);
      if (!timer) {
        timer = true;
        schedule(drain, options.delayMs ?? LAZY_DELAY_MS);
      }
    },
    idle: () => chain,
  };
}

type ObserverCtor = new (callback: IntersectionObserverCallback, init?: IntersectionObserverInit) => Pick<IntersectionObserver, "observe" | "unobserve">;

/**
 * Calls `onVisible(element)` once, the first time each watched element comes near the viewport. Without
 * IntersectionObserver (very old browsers), every element counts as visible at once.
 */
export function visibilityWatcher(onVisible: (element: Element) => void, Observer: ObserverCtor | undefined =
  typeof IntersectionObserver === "undefined" ? undefined : IntersectionObserver): { watch(element: Element): void } {
  if (!Observer) return { watch: onVisible };
  const observer = new Observer((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      onVisible(entry.target);
    }
  }, { rootMargin: "200px 0px" });
  return { watch: (element) => observer.observe(element) };
}
