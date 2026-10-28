import { connection } from "next/server";

import { friendlyTitle, plainPlaceName } from "@/lib/area-labels";
import { loadAreaTrail } from "@/lib/area-pages-data";
import type { GeographyId } from "@/lib/contracts";
import { regionScope, scopeName } from "@/lib/scope-name";
import { areaSearchDescription, areaSearchTitle } from "@/lib/seo";

/**
 * The title and description of a borough or wider neighbourhood (MSOA) page. Both pages are the area
 * page's frame now (borough-page.tsx; area-full-page.tsx for an MSOA); the old guide
 * layout (a Topic/Here/London table and tabs) is gone. Read from the area's trail (a few rows), never its
 * region's data: an MSOA page needs nothing else of it, and loading it cost a page seconds.
 */
export async function areaGuideMetadata(geography: GeographyId): Promise<{ title: string; name: string; description: string } | null> {
  await connection();
  const trail = await loadAreaTrail(geography);
  const area = trail.at(-1);
  if (!area || area.geographyId !== geography) return null;
  const region = scopeName(regionScope(area.regionCode ?? trail[0]?.regionCode));
  const name = friendlyTitle(area) ?? plainPlaceName(area.name) ?? area.name;
  // A local authority's title names its region ("Bristol, South West"): several share a name with a town elsewhere.
  const carrier = area.carrier === "lad" ? "lad" : "msoa";
  return { title: areaSearchTitle(name, carrier, region), name, description: areaSearchDescription(name, carrier, region) };
}
