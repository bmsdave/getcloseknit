import { NextResponse, type NextRequest } from "next/server";

import { canonicalApiText, canonicalPath, movedArea } from "@/lib/canonical-path";
import { evidenceServiceUrl } from "@/lib/evidence-service";

/**
 * An area code or postcode in another case moves permanently (308) to its canonical page, query kept; a LAD page
 * under its old segment (/area/borough/…), or any page whose query names an old LAD id (uk:borough:…, before step R2
 * of docs/architecture/global-geography.md: /civic?area=, /compare?ids=, /?selected=), moves with a 301 to the
 * current one, as search engines and old shared links know it. The BFF's own API routes (demo data) read an old id in
 * the path or query as the current one, as the API does (real mode: the API itself).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const query = canonicalApiText(search);
  if (pathname.startsWith("/api/")) {
    // With the API configured the routes pass the id on and the API reads an old one itself (area_alias). A rewrite
    // here would not stay inside Next behind warm-start.mjs (nextUrl names its 127.0.0.1 "localhost", another
    // origin), so Next would fetch it over TLS from its own http port behind Caddy: a 500.
    if (evidenceServiceUrl()) return NextResponse.next();
    const path = canonicalApiText(pathname);
    if (path === pathname && query === search) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = query;
    return NextResponse.rewrite(url);
  }
  const path = canonicalPath(pathname);
  if (!path && query === search) return NextResponse.next();
  const url = request.nextUrl.clone();
  if (path) url.pathname = path;
  url.search = query;
  return NextResponse.redirect(url, movedArea(pathname) || query !== search ? 301 : 308);
}

export const config = {
  // Every page and API route; never Next's own files or static assets (a dot in the last segment).
  matcher: ["/((?!_next/|.*\\.[a-z0-9]+$).*)"],
};
