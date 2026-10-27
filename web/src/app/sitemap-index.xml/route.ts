import { connection } from "next/server";

import { loadRegionsServed } from "@/lib/area-pages-data";
import { homeSitemapSectors } from "@/lib/home-sitemap";
import { areaSitemapIds, areaSitemapPath, homeSitemapPath, siteOrigin, sitemapIndexXml } from "@/lib/seo";

// The sitemap index robots.txt names (lib/seo.ts › robotsRules): the main sitemap, the area shards (postcode
// sectors, each English region outside London: app/area/sitemap.ts), then each postcode sector's per-address
// shard (app/postcode/sitemap.ts). Next writes no index for generateSitemaps itself.
export async function GET() {
  await connection();
  const origin = (await siteOrigin()) ?? "";
  const [regions, sectors] = await Promise.all([loadRegionsServed(), homeSitemapSectors()]);
  const body = sitemapIndexXml([
    `${origin}/sitemap.xml`,
    ...areaSitemapIds(regions).map((id) => `${origin}${areaSitemapPath(id)}`),
    ...sectors.map((code) => `${origin}${homeSitemapPath(code)}`),
  ]);
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
