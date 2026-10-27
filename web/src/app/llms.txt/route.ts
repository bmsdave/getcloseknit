import type { NextRequest } from "next/server";

import { GUIDE_ARTICLES } from "@/components/guide/articles";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { GUIDE_SLUGS, guidePath } from "@/lib/guide-slugs";
import { llmsTxt } from "@/lib/llms-txt";
import { publicOrigin } from "@/lib/seo";

// llmstxt.org guide for agents and crawlers (lib/llms-txt.ts): what the pages are, with links.
export function GET(request: NextRequest) {
  const origin = publicOrigin(process.env.CLOSE_KNIT_PUBLIC_URL, request.headers) ?? request.nextUrl.origin;
  const guides = GUIDE_SLUGS.map((slug) => ({ path: guidePath(slug), title: GUIDE_ARTICLES[slug].title }));
  const body = llmsTxt({ origin, guides, hasApi: evidenceServiceUrl() !== null });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
