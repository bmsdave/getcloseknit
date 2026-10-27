/**
 * fetch that waits out a rate limit: on 429 it sleeps for the server's Retry-After (capped) and tries again, so a
 * burst of panel requests reads as a short delay instead of "evidence unavailable". With `restarts` (the map's
 * colours, shapes and coverage: mapFetch) it also rides over an API restart: on 502/503/504 or a network error it
 * backs off (0.5 s, 1.5 s, 4.5 s) and tries again, so a layer never stays unpainted after one failed request
 * (perf/layer-load); the panels keep failing fast, so "offline" shows at once. Aborts still abort.
 */
export const RETRY_LIMIT = 2;
export const RESTART_RETRY_LIMIT = 3;
const MAX_WAIT_MS = 8000;
const RESTART_STATUSES = new Set([502, 503, 504]);

/** Milliseconds to wait from a Retry-After header (seconds or an HTTP date). */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) return 1000;
  const seconds = Number(header);
  const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Math.min(MAX_WAIT_MS, Math.max(250, Number.isFinite(wait) ? wait : 1000));
}

/** The back-off before retry `attempt` (0-based) after a 5xx or a network error. */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_WAIT_MS, 500 * 3 ** attempt);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function isAbort(error: unknown, signal?: AbortSignal | null): boolean {
  return !!signal?.aborted || (error instanceof Error && error.name === "AbortError");
}

export async function politeFetch(
  input: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
  options: { restarts?: boolean } = {},
): Promise<Response> {
  const limit = options.restarts ? RESTART_RETRY_LIMIT : RETRY_LIMIT;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch (error) {
      if (!options.restarts || isAbort(error, init?.signal) || attempt >= limit) throw error;
      await sleep(backoffMs(attempt), init?.signal);
      continue;
    }
    if (attempt >= limit) return response;
    if (response.status === 429) {
      await sleep(retryAfterMs(response.headers.get("retry-after")), init?.signal);
    } else if (options.restarts && RESTART_STATUSES.has(response.status)) {
      await sleep(backoffMs(attempt), init?.signal);
    } else {
      return response;
    }
  }
}

/** The map's colours, shapes and coverage: politeFetch that also rides over an API restart. */
export function mapFetch(input: string, init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return politeFetch(input, init, fetchImpl, { restarts: true });
}
