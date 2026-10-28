import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { availableRankings } from "@/lib/area-pages";
import { loadChangelog } from "@/lib/changelog-files";
import { loadAreaPages } from "@/lib/area-pages-data";
import { fetchApi } from "@/lib/deployment";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { DEMO_SCHOOL_CARD_URNS } from "@/lib/school-card-fixture";
import { siteOrigin, SITEMAP_LIMIT, sitemapPaths } from "@/lib/seo";

type SchoolIndex = { schemaVersion: "school-index.v1"; schools: { urn: string; successorUrn: string | null; hasEvidence: boolean }[] };

/** /school/{urn} for every school with a result or an inspection; a closed school that redirects is left out. */
async function schoolUrns(): Promise<string[]> {
  if (!evidenceServiceUrl()) return [...DEMO_SCHOOL_CARD_URNS];
  const { body } = await fetchApi<SchoolIndex>("/api/v1/schools/index");
  if (body?.schemaVersion !== "school-index.v1") return [];
  return body.schools.filter((school) => school.hasEvidence && !school.successorUrn).map((school) => school.urn);
}

/**
 * Every permanent page (lib/seo.ts › sitemapPaths), with London's areas and every school with evidence. Postcode
 * sectors and the other English regions' areas are their own shards (app/area/sitemap.ts), so no file passes
 * Google's 50,000.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = (await siteOrigin()) ?? "";
  const [loaded, schools] = await Promise.all([loadAreaPages(), schoolUrns()]);
  const areas = loaded?.index.data.areas ?? [];
  return sitemapPaths(areas, availableRankings(loaded?.index ?? null), schools, [], loadChangelog().map((entry) => entry.slug)).slice(0, SITEMAP_LIMIT)
    .map((path) => ({ url: `${origin}${path}` }));
}
