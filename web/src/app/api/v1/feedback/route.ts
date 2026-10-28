import type { NextRequest } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

const HEADERS = { "Cache-Control": "no-store" };

/**
 * A vote or review someone chose to send (lib/feedback.ts), passed to the API with the browser's user
 * agent so it can leave out crawlers; the API stores neither. The API's status comes back (204 kept,
 * 422 refused, 503 not stored) so the form can say when it didn't send. Demo mode keeps nothing.
 */
export async function POST(request: NextRequest) {
  const body = await request.text().catch(() => "");
  if (body.length === 0 || body.length >= 8_000) return new Response(null, { status: 422, headers: HEADERS });
  if (!evidenceServiceUrl()) return new Response(null, { status: 204, headers: HEADERS });
  const upstream = await fetchEvidence<unknown>("/api/v1/feedback", request, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "user-agent": request.headers.get("user-agent") ?? "",
      ...(request.headers.get("x-close-knit-team") === "1" ? { "x-close-knit-team": "1" } : {}) },
  });
  return new Response(null, { status: upstream.status, headers: HEADERS });
}
