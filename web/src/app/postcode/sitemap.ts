import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { homeSitemapIndex, homeSitemapSectors } from "@/lib/home-sitemap";
import { sectorSlug } from "@/lib/sector";
import { homeSitemapPaths, siteOrigin } from "@/lib/seo";

/** One shard per postcode sector: /postcode/sitemap/W5-1.xml (listed by /sitemap-index.xml). */
export async function generateSitemaps(): Promise<{ id: string }[]> {
  return (await homeSitemapSectors()).map((code) => ({ id: sectorSlug(code) }));
}

/** The sector's postcode pages, their homes lists and every home with a page (lib/seo.ts › homeSitemapPaths). */
export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = (await siteOrigin()) ?? "";
  const { postcodes, uprns } = await homeSitemapIndex(await id);
  return homeSitemapPaths(postcodes, uprns).map((path) => ({ url: `${origin}${path}` }));
}
