import { connection } from "next/server";

import { friendlyTitle } from "@/lib/area-labels";
import { loadAreaTrail } from "@/lib/area-pages-data";
import type { GeographyId } from "@/lib/contracts";
import { regionScope, scopeName } from "@/lib/scope-name";

/**
 * The title and description of a borough or wider neighbourhood (MSOA) page. Both pages are the area
 * page's frame now (borough-page.tsx; area-full-page.tsx for an MSOA); the old guide
 * layout (a Topic/Here/London table and tabs) is gone. Read from the area's trail (a few rows), never its
 * region's data: an MSOA page needs nothing else of it, and loading it cost a page seconds.
 */
export async function areaGuideMetadata(geography: GeographyId): Promise<{ title: string; description: string } | null> {
  await connection();
  const trail = await loadAreaTrail(geography);
  const area = trail.at(-1);
  if (!area || area.geographyId !== geography) return null;
  const region = scopeName(regionScope(area.regionCode ?? trail[0]?.regionCode));
  return {
    title: `${friendlyTitle(area) ?? area.name}: prices, crime, schools and deprivation`,
    description: `${friendlyTitle(area) ?? area.name}, ${region}: typical price per square metre, recorded crime, schools, deprivation and income${area.carrier === "lad" ? ", with every area inside it" : ""}.`,
  };
}
