/**
 * My match when the API is busy: a 429 or 5xx answer is tried again a few times with a growing wait (the
 * answer's Retry-After when it gives one, never more than MAX_WAIT_MS), and the panel says so meanwhile; after
 * MATCH_RETRIES it offers Try again rather than a stale or blank ranking.
 */
export const MATCH_RETRIES = 3;
const FIRST_WAIT_MS = 2_000;
const MAX_WAIT_MS = 30_000;

export type MatchBusy = "retrying" | "failed" | null;

export const MATCH_BUSY_WORDS: Record<Exclude<MatchBusy, null>, string> = {
  retrying: "Busy, retrying… Counts are from your last search.",
  failed: "Busy right now. Counts are from your last search.",
};

/** A refused answer worth retrying: rate limited or the server's trouble, never a bad request. */
export function isBusyStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** The wait before try `attempt` (0 = the first retry): Retry-After seconds, else 2 s, 4 s, 8 s. */
export function matchRetryDelay(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : FIRST_WAIT_MS * 2 ** attempt;
  return Math.min(MAX_WAIT_MS, Math.max(FIRST_WAIT_MS, wait));
}
