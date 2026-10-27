import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { clientHeaders, evidenceServiceUrl, passthroughHeaders } from "@/lib/evidence-service";

const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

/**
 * The browser extension's card beside a portal listing (api/area_api/listing_card.py). The body
 * carries the listing's public facts and maybe the saved profile, so nothing is cached. Without
 * the API (demo mode) there is no card: the extension shows nothing.
 */
export async function POST(request: NextRequest) {
  const base = evidenceServiceUrl();
  if (!base) return NextResponse.json({ error: "listing-card-unavailable" }, { status: 503, headers: PRIVATE_HEADERS });
  const body = await request.text().catch(() => "");
  if (body.length === 0 || body.length > 64_000) {
    return NextResponse.json({ error: "invalid-listing" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const upstream = await fetch(`${base}/api/v1/listing-card`, {
    method: "POST",
    headers: {
      accept: "application/json", "content-type": "application/json",
      "user-agent": request.headers.get("user-agent") ?? "", ...clientHeaders(request.headers),
      // The extension's usage opt-out (first-run screen): the API then records no event.
      ...(request.headers.get("x-close-knit-analytics") === "off" ? { "x-close-knit-analytics": "off" } : {}),
    },
    body,
    signal: request.signal,
  });
  const payload = await upstream.json().catch(() => ({ error: "listing-card-unavailable" }));
  return NextResponse.json(payload, { status: upstream.status, headers: { ...passthroughHeaders(upstream.headers), ...PRIVATE_HEADERS } });
}
