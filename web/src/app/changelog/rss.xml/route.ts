import type { NextRequest } from "next/server";

import { rssXml } from "@/lib/changelog";
import { loadChangelog } from "@/lib/changelog-files";
import { publicOrigin } from "@/lib/seo";

// /changelog/rss.xml: RSS 2.0, the newest 20 entries (lib/changelog.ts › rssXml).
export function GET(request: NextRequest) {
  const origin = publicOrigin(process.env.CLOSE_KNIT_PUBLIC_URL, request.headers) ?? request.nextUrl.origin;
  return new Response(rssXml(loadChangelog(), origin), {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
