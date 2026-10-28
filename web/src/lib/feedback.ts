/**
 * Feedback people choose to send: a review from the /feedback form
 * (docs/superpowers/specs/2026-10-14-user-feedback-design.md; stored by api/area_api/site_feedback.py).
 * The quick 👍/👎 votes and the "How's Close Knit so far?" prompt are gone from the UI;
 * the API still accepts the vote kind and keeps the rows already sent (migration 053).
 *
 * It is not product analytics: it carries no visitor or session id, and "Analytics off" doesn't stop
 * it, because the person chose to send it.
 */
import { deviceClass, pagePath, teamBrowser } from "./usage";

export type FeedbackSurface = "area_card" | "shortlist" | "site";
export type Vote = 1 | -1;
export interface FeedbackPayload {
  client_id: string; kind: "vote" | "review"; surface: FeedbackSurface;
  target?: string; area?: string; vote?: Vote; rating?: number; tags?: string[]; message?: string;
}

const ENDPOINT = "/api/v1/feedback";

/** Send one review with the kind of page and device; true when it was kept. */
export async function sendFeedback(payload: FeedbackPayload): Promise<boolean> {
  try {
    const body = JSON.stringify({ ...payload, path: pagePath(window.location.pathname), device: deviceClass(window.innerWidth),
      ...(teamBrowser() ? { team: true } : {}) });
    const response = await fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } });
    return response.ok;
  } catch {
    return false;
  }
}

/** A random UUID v4: the row's id. */
export function newFeedbackId(): string {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
