import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { loadRegionAreas, loadRegionsServed } from "@/lib/area-pages-data";
import { serverDefaults, serverSectorList } from "@/lib/deployment";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { REGIONS, regionSlug } from "@/lib/scope-name";
import { sectorPath } from "@/lib/sector";
import { areaSitemapIds, areaSitemapPaths, siteOrigin, SITEMAP_LIMIT, sitemapEntries } from "@/lib/seo";

/** /area/sitemap/sectors.xml, then one shard per English region outside London (/sitemap.xml holds London's). */
export async function generateSitemaps(): Promise<{ id: string }[]> {
  return areaSitemapIds(await loadRegionsServed()).map((id) => ({ id }));
}

/**
 * A shard: every postcode sector page, or every area page of one region. An empty answer from the API is an
 * outage, never an empty region: it throws (a 500 the crawler retries) rather than serve an empty sitemap.
 */
export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = (await siteOrigin()) ?? "";
  const shard = await id;
  const region = REGIONS.find((candidate) => regionSlug(candidate) === shard);
  const [paths, defaults] = await Promise.all([
    shard === "sectors"
      ? serverSectorList().then((sectors) => sectors.map((sector) => sectorPath(sector.code)))
      : region ? loadRegionAreas(region.code).then(areaSitemapPaths) : Promise.resolve([]),
    serverDefaults(),
  ]);
  if (paths.length === 0 && evidenceServiceUrl()) throw new Error(`sitemap: shard ${shard} has no pages`);
  return sitemapEntries(origin, paths.slice(0, SITEMAP_LIMIT), defaults.served?.productReleaseId);
}
