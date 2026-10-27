/**
 * One request for identical GETs in flight at the same moment (faster map loads). The
 * selected area's evidence is asked for by the panel and by the sheet's reopen row as the page opens:
 * 136 KB each for a price area. Each caller gets its own copy of the response; a caller's abort ends
 * only its own wait, never the shared request. Settled requests are forgotten (the browser's cache
 * and the callers' own state keep the answers).
 */
import { politeFetch } from "./polite-fetch";

const inFlight = new Map<string, Promise<Response>>();

export function sharedFetch(url: string, init?: { signal?: AbortSignal | null }, fetchImpl: (url: string) => Promise<Response> = (url) => fetch(url)): Promise<Response> {
  let shared = inFlight.get(url);
  if (!shared) {
    const request = fetchImpl(url);
    shared = request;
    inFlight.set(url, request);
    const forget = () => { if (inFlight.get(url) === request) inFlight.delete(url); };
    request.then(forget, forget);
  }
  // Cloned on arrival, before any caller reads a body: the shared response itself is never read.
  const copy = shared.then((response) => response.clone());
  const signal = init?.signal;
  if (!signal) return copy;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    copy.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** sharedFetch over politeFetch (waits out a 429): the area evidence's fetch. */
export function sharedPoliteFetch(url: string, init?: { signal?: AbortSignal | null }): Promise<Response> {
  return sharedFetch(url, init, (input) => politeFetch(input));
}

/**
 * Runs `work` once the page is idle (or after `timeout` ms at the latest): for requests the first view
 * does not need. Returns a cancel.
 */
export function whenIdle(work: () => void, timeout = 1500): () => void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(work, { timeout });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = setTimeout(work, 200);
  return () => clearTimeout(handle);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}
