import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { availableRankings } from "@/lib/area-pages";
import { loadChangelog } from "@/lib/changelog-files";
import { loadAreaPages } from "@/lib/area-pages-data";
import { fetchApi, serverDefaults, SITEMAP_FETCH_TIMEOUT_MS } from "@/lib/deployment";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { DEMO_SCHOOL_CARD_URNS } from "@/lib/school-card-fixture";
import { hubBoroughs } from "@/lib/schools-hub";
import { siteOrigin, SITEMAP_LIMIT, sitemapEntries, sitemapPaths } from "@/lib/seo";

type SchoolIndex = {
  schemaVersion: "school-index.v1";
  schools: { urn: string; borough: string | null; successorUrn: string | null; hasEvidence: boolean }[];
};

/**
 * /school/{urn} for every school with a result or an inspection (a closed school that redirects is left out), and
 * each council's schools list. The index is ~3 MB: it gets the sitemap's long timeout, and a failed read throws
 * (a 500 the crawler retries) rather than a sitemap that silently drops twenty thousand schools.
 */
async function schoolIndex(): Promise<{ urns: string[]; boroughs: string[] }> {
  if (!evidenceServiceUrl()) return { urns: [...DEMO_SCHOOL_CARD_URNS], boroughs: [] };
  const { status, body } = await fetchApi<SchoolIndex>("/api/v1/schools/index", SITEMAP_FETCH_TIMEOUT_MS);
  if (body?.schemaVersion !== "school-index.v1") throw new Error(`sitemap: the school index answered ${status}`);
  const listed = body.schools.filter((school) => school.hasEvidence && !school.successorUrn);
  return { urns: listed.map((school) => school.urn), boroughs: hubBoroughs(listed).map((borough) => borough.slug) };
}

/**
 * Every permanent page (lib/seo.ts › sitemapPaths), with London's areas and every school with evidence. Postcode
 * sectors and the other English regions' areas are their own shards (app/area/sitemap.ts), so no file passes
 * Google's 50,000.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = (await siteOrigin()) ?? "";
  const [loaded, schools, defaults] = await Promise.all([loadAreaPages(), schoolIndex(), serverDefaults()]);
  if (!loaded && evidenceServiceUrl()) throw new Error("sitemap: London's areas did not load");
  const areas = loaded?.index.data.areas ?? [];
  const paths = sitemapPaths(areas, availableRankings(loaded?.index ?? null), schools.urns, [],
    loadChangelog().map((entry) => entry.slug), schools.boroughs);
  return sitemapEntries(origin, paths.slice(0, SITEMAP_LIMIT), defaults.served?.productReleaseId);
}
