import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { clientHeaders, evidenceServiceUrl } from "@/lib/evidence-service";
import { previewGoTarget } from "@/lib/portal-zones";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * /go/<portal>: a counted click-out to a portal search. In production the reverse proxy sends /go to the
 * API (deploy/Caddyfile), so this route only answers in development: through the API when one is
 * configured, else from the same builder in lib/portal-zones.ts. Either way the target is rebuilt from
 * the parameters, so /go can only ever open a portal.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ portal: string }> }) {
  const { portal } = await params;
  const base = evidenceServiceUrl();
  if (base) {
    const upstream = await fetch(`${base}/go/${encodeURIComponent(portal)}${request.nextUrl.search}`, {
      redirect: "manual",
      headers: { "user-agent": request.headers.get("user-agent") ?? "", ...clientHeaders(request.headers) },
      signal: request.signal,
    }).catch(() => null);
    const location = upstream?.headers.get("location");
    if (upstream && upstream.status >= 300 && upstream.status < 400 && location) {
      return NextResponse.redirect(location, { status: 302, headers: HEADERS });
    }
    return NextResponse.json({ error: "unknown-link" }, { status: 404, headers: HEADERS });
  }
  const target = previewGoTarget(portal, request.nextUrl.searchParams);
  return target ? NextResponse.redirect(target, { status: 302, headers: HEADERS })
    : NextResponse.json({ error: "unknown-link" }, { status: 404, headers: HEADERS });
}
