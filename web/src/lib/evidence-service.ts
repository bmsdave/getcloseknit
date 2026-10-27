/**
 * Single production routing boundary (AE-06): when CLOSE_KNIT_API_URL is
 * set, evidence routes proxy to the FastAPI service reading validated
 * storage; otherwise they serve local fixtures for demo work. The caller
 * request's abort signal is forwarded so cancellation propagates end to end.
 *
 * Server-only in effect (reads process.env) but imports nothing
 * Next-specific so the proxy logic stays unit-testable under plain node.
 */
import { trustedRenderHeaders } from "./server-render";

export function evidenceServiceUrl(): string | null {
  const base = process.env.CLOSE_KNIT_API_URL?.trim();
  if (!base) return null;
  return base.replace(/\/+$/, "");
}

export interface EvidenceUpstream<T> {
  status: number;
  body: T;
  /** Rate-limit headers from the API, passed through so clients see Retry-After. */
  headers: Record<string, string>;
}

// cache-control too: value packs are cacheable per release, matches are no-store.
const PASSTHROUGH_HEADERS = ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "cache-control"];

export function passthroughHeaders(upstream: { get(name: string): string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.get(name);
    if (value) out[name] = value;
  }
  return out;
}

/** The caller of a BFF route: its abort signal and headers (a NextRequest fits). */
export interface Caller {
  signal: AbortSignal;
  headers: { get(name: string): string | null };
}

/**
 * The API rate-limits per client and trusts X-Forwarded-For from this BFF
 * (CLOSE_KNIT_TRUST_PROXY=1), so every proxied call carries the first hop
 * the reverse proxy reported. Without a proxy (local dev) there is no header
 * and the API sees the BFF itself — one bucket, fine for one person.
 * A server render's own reads carry its render headers too (lib/server-render.ts).
 */
export function clientHeaders(headers: Caller["headers"]): Record<string, string> {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim();
  return { ...(first ? { "x-forwarded-for": first } : {}), ...trustedRenderHeaders(headers) };
}

/** How long this process keeps a release-wide answer (fetchSharedEvidence): browsers keep them longer still. */
export const SHARED_EVIDENCE_TTL_MS = 60_000;
const sharedEvidence = new Map<string, { at: number; answer: Promise<EvidenceUpstream<unknown>> }>();

/**
 * A release-wide answer every map open reads (the metric catalogue, the map's coverage, the area labels), the same
 * for everyone: asked of the API at most once a minute per path, not once per visitor and page. Browsers already keep
 * them for 5 to 10 minutes (Cache-Control), and none names a release the API would refuse, so a minute's lag after
 * a release is no new staleness. It spares the API's rate limit and the read on every open (perf/layer-load).
 * Only a 200 is kept; the first caller's address is forwarded, and its cancelling does not cancel the others'.
 */
export function fetchSharedEvidence<T>(path: string, caller: Caller, now: () => number = Date.now): Promise<EvidenceUpstream<T>> {
  const held = sharedEvidence.get(path);
  if (held && now() - held.at < SHARED_EVIDENCE_TTL_MS) return held.answer as Promise<EvidenceUpstream<T>>;
  const answer = fetchEvidence<T>(path, { signal: AbortSignal.timeout(20_000), headers: caller.headers }).then((upstream) => {
    if (upstream.status !== 200) sharedEvidence.delete(path);
    return upstream;
  }, (error: unknown) => {
    sharedEvidence.delete(path);
    throw error;
  });
  sharedEvidence.set(path, { at: now(), answer });
  return answer;
}

export async function fetchEvidence<T>(
  path: string,
  caller: AbortSignal | Caller,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<EvidenceUpstream<T>> {
  const base = evidenceServiceUrl();
  if (!base) throw new Error("evidence-service-unavailable");
  const signal = caller instanceof AbortSignal ? caller : caller.signal;
  const forwarded = caller instanceof AbortSignal ? {} : clientHeaders(caller.headers);
  try {
    const upstream = await fetch(`${base}${path}`, {
      signal,
      method: init?.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...forwarded,
        ...init?.headers,
      },
      body: init?.body,
    });
    const body = (await upstream.json().catch(() => ({ error: "invalid-upstream-response" }))) as T;
    return { status: upstream.status, body, headers: passthroughHeaders(upstream.headers) };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return { status: 503, body: { error: "evidence-service-unreachable" } as T, headers: {} };
  }
}
