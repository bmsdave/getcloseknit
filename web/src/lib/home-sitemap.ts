/**
 * The per-address sitemap shards (app/postcode/sitemap.ts), one per postcode sector: London has about 144,000
 * postcodes and over a million homes, far past one sitemap's 50,000 URLs, while a sector holds a few thousand.
 * Demo mode serves the fixture's postcode and homes; real mode asks /api/v1/homes/index, which leaves hidden homes out.
 */
import { fetchApi, serverSectorsWithHomes, SITEMAP_FETCH_TIMEOUT_MS } from "./deployment";
import { evidenceServiceUrl } from "./evidence-service";
import { DEMO_HOME_INDEX } from "./property-profile-fixture";
import { sectorOfPostcode, sectorSlug } from "./sector";

export interface HomeIndex { postcodes: string[]; uprns: string[] }

interface HomeIndexResponse extends HomeIndex { schemaVersion: "home-index.v1"; sector: string }

/**
 * How long this process keeps the sector list. The index and each of its ~1,100 shards ask for it (generateSitemaps
 * runs per shard request), and a crawler reads them back to back: one read per sitemap would spend the crawler's own
 * API allowance and turn the rest of its shards into 404s.
 */
export const HOME_SECTORS_TTL_MS = 10 * 60_000;
let heldSectors: { at: number; codes: string[] } | null = null;

/**
 * Every sector with recorded homes, as codes ("W5 1"): one shard each, none for a sector without homes. An API that
 * does not answer throws (a 500 the crawler retries), never an empty list that 404s every shard.
 */
export async function homeSitemapSectors(now: () => number = Date.now): Promise<string[]> {
  if (!evidenceServiceUrl()) {
    return [...new Set(DEMO_HOME_INDEX.postcodes.flatMap((postcode) => sectorOfPostcode(postcode) ?? []))];
  }
  if (heldSectors && now() - heldSectors.at < HOME_SECTORS_TTL_MS) return heldSectors.codes;
  const codes = (await serverSectorsWithHomes()).map((sector) => sector.code);
  if (codes.length === 0) throw new Error("sitemap: the sectors with homes did not load");
  heldSectors = { at: now(), codes };
  return codes;
}

/** One sector's postcodes and homes (`slug`: "W5-1"); empty only in demo for a sector it lacks. A failed read throws (a 500). */
export async function homeSitemapIndex(slug: string): Promise<HomeIndex> {
  if (!evidenceServiceUrl()) {
    const inSector = (postcode: string) => sectorSlug(sectorOfPostcode(postcode) ?? "") === slug;
    return DEMO_HOME_INDEX.postcodes.some(inSector) ? DEMO_HOME_INDEX : { postcodes: [], uprns: [] };
  }
  const { status, body } = await fetchApi<HomeIndexResponse>(`/api/v1/homes/index?sector=${encodeURIComponent(slug)}`, SITEMAP_FETCH_TIMEOUT_MS);
  if (body?.schemaVersion !== "home-index.v1") throw new Error(`sitemap: the homes index of ${slug} answered ${status}`);
  return { postcodes: body.postcodes, uprns: body.uprns };
}
