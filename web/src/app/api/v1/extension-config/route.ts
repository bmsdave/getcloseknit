import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { clientHeaders, evidenceServiceUrl, passthroughHeaders } from "@/lib/evidence-service";

const CACHED = { "Cache-Control": "public, max-age=300" };
const UNCACHED = { "Cache-Control": "no-store" };

/**
 * The browser extension's per-portal kill switch (api/area_api/extension_config.py): inline,
 * side-panel or off per portal, changed by CLOSE_KNIT_EXTENSION_MODES without a release, and the
 * resultsLine / mapPopup feature flags (CLOSE_KNIT_EXTENSION_FEATURES), passed through as they are. Without
 * the API (demo mode) there is no config: the extension keeps its built-in defaults.
 */
export async function GET(request: NextRequest) {
  const base = evidenceServiceUrl();
  if (!base) return NextResponse.json({ error: "extension-config-unavailable" }, { status: 503, headers: UNCACHED });
  const upstream = await fetch(`${base}/api/v1/extension-config`, {
    headers: {
      accept: "application/json",
      "user-agent": request.headers.get("user-agent") ?? "", ...clientHeaders(request.headers),
    },
    signal: request.signal,
  });
  const payload = await upstream.json().catch(() => ({ error: "extension-config-unavailable" }));
  const cache = upstream.ok ? CACHED : UNCACHED;
  return NextResponse.json(payload, { status: upstream.status, headers: { ...passthroughHeaders(upstream.headers), ...cache } });
}
