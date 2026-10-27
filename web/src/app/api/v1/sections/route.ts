import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { streamSections } from "@/lib/area-page-seed";
import { batchArea, MAX_BATCH } from "@/lib/section-batch";

/**
 * POST {urls: [...]} → NDJSON lines {url, body | null} as each is read: one area view's section
 * reads in one request, read in process as one render so the API charges the viewer one page view
 * (lib/section-batch.ts); streamed, so a slow section never holds back the rest.
 * Only one area's sections per request, at most MAX_BATCH, and only the parts in BATCH_PARTS: a batch can
 * never be a cheaper way to read many areas than opening their pages. A URL with no line failed
 * and is read by the browser on its own.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { urls?: unknown } | null;
  const urls = body?.urls;
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_BATCH || !urls.every((url) => typeof url === "string")) {
    return NextResponse.json({ error: "invalid-query", message: `urls: 1 to ${MAX_BATCH} section URLs` }, { status: 400 });
  }
  const areas = new Set(urls.map((url: string) => batchArea(url)));
  if (areas.size !== 1 || areas.has(null)) {
    return NextResponse.json({ error: "invalid-query", message: "one area's section URLs only" }, { status: 400 });
  }
  // No buffering on the way (Caddy flushes a body of unknown length as it is written; nginx would need the header).
  return new Response(streamSections([...new Set(urls as string[])], request.headers), {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
