/**
 * The per-address sitemap shards (app/postcode/sitemap.ts), one per postcode sector: London has about 144,000
 * postcodes and over a million homes, far past one sitemap's 50,000 URLs, while a sector holds a few thousand.
 * Demo mode serves the fixture's postcode and homes; real mode asks /api/v1/homes/index, which leaves hidden homes out.
 */
import { fetchApi, serverSectorsWithHomes } from "./deployment";
import { evidenceServiceUrl } from "./evidence-service";
import { DEMO_HOME_INDEX } from "./property-profile-fixture";
import { sectorOfPostcode, sectorSlug } from "./sector";

export interface HomeIndex { postcodes: string[]; uprns: string[] }

interface HomeIndexResponse extends HomeIndex { schemaVersion: "home-index.v1"; sector: string }

/** Every sector with recorded homes, as codes ("W5 1"): one shard each, none for a sector without homes. */
export async function homeSitemapSectors(): Promise<string[]> {
  if (!evidenceServiceUrl()) {
    return [...new Set(DEMO_HOME_INDEX.postcodes.flatMap((postcode) => sectorOfPostcode(postcode) ?? []))];
  }
  return (await serverSectorsWithHomes()).map((sector) => sector.code);
}

/** One sector's postcodes and homes (`slug`: "W5-1"); empty when the API has none or is down. */
export async function homeSitemapIndex(slug: string): Promise<HomeIndex> {
  if (!evidenceServiceUrl()) {
    const inSector = (postcode: string) => sectorSlug(sectorOfPostcode(postcode) ?? "") === slug;
    return DEMO_HOME_INDEX.postcodes.some(inSector) ? DEMO_HOME_INDEX : { postcodes: [], uprns: [] };
  }
  const { body } = await fetchApi<HomeIndexResponse>(`/api/v1/homes/index?sector=${encodeURIComponent(slug)}`);
  if (body?.schemaVersion !== "home-index.v1") return { postcodes: [], uprns: [] };
  return { postcodes: body.postcodes, uprns: body.uprns };
}
