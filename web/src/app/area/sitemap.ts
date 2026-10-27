import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { loadRegionAreas, loadRegionsServed } from "@/lib/area-pages-data";
import { serverSectorList } from "@/lib/deployment";
import { REGIONS, regionSlug } from "@/lib/scope-name";
import { sectorPath } from "@/lib/sector";
import { areaSitemapIds, areaSitemapPaths, siteOrigin, SITEMAP_LIMIT } from "@/lib/seo";

/** /area/sitemap/sectors.xml, then one shard per English region outside London (/sitemap.xml holds London's). */
export async function generateSitemaps(): Promise<{ id: string }[]> {
  return areaSitemapIds(await loadRegionsServed()).map((id) => ({ id }));
}

/** A shard: every postcode sector page, or every area page of one region. */
export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = (await siteOrigin()) ?? "";
  const shard = await id;
  const region = REGIONS.find((candidate) => regionSlug(candidate) === shard);
  const paths = shard === "sectors"
    ? (await serverSectorList()).map((sector) => sectorPath(sector.code))
    : region ? areaSitemapPaths(await loadRegionAreas(region.code)) : [];
  return paths.slice(0, SITEMAP_LIMIT).map((path) => ({ url: `${origin}${path}` }));
}
