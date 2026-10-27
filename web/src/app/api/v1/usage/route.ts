import type { NextRequest } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

// No Cache-Control: a 204 to a POST is never cached, and a no-store answer to a page's fetch keeps the
// page out of the back/forward cache.
const NO_CONTENT = { status: 204 };

/**
 * A page's batch of usage events (lib/usage.ts), passed to the API with the browser's user agent so it
 * can leave out crawlers; the API stores neither. Demo mode keeps nothing. Always 204: usage is never
 * an error a page shows.
 */
export async function POST(request: NextRequest) {
  const body = await request.text().catch(() => "");
  if (evidenceServiceUrl() && body.length > 0 && body.length < 32_000) {
    await fetchEvidence<unknown>("/api/v1/usage", request, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "user-agent": request.headers.get("user-agent") ?? "" },
    });
  }
  return new Response(null, NO_CONTENT);
}
