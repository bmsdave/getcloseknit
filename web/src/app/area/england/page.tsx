import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AreaPageShell, AreaUnavailable, DemoNote } from "@/components/area-pages";
import { plainPlaceName } from "@/lib/area-labels";
import { areaPath, englandRegions } from "@/lib/area-pages";
import { loadBoroughs } from "@/lib/area-pages-data";
import { pageMetadata } from "@/lib/seo";

const DESCRIPTION = "England by region and local authority: prices, crime, schools and deprivation from official public data.";

export const metadata: Metadata = pageMetadata({ title: "England: regions and local authorities", description: DESCRIPTION, path: "/area/england" });

// Top of the area tree: England → region → local authority (borough) → MSOA → neighbourhood. Only the regions
// the data serves are listed (London alone while CLOSE_KNIT_ENGLAND is off); London keeps its own page.
export default async function EnglandPage() {
  await connection();
  const loaded = await loadBoroughs();
  if (!loaded) return <AreaUnavailable />;
  const regions = englandRegions(loaded.boroughs);
  const count = regions.reduce((sum, region) => sum + region.boroughs.length, 0);
  return (
    <AreaPageShell testId="area-england-page" className="area-london">
      <p className="eyebrow">Country</p>
      <h1>England</h1>
      <p className="methodology-intro">{count} local authorities in {regions.length} {regions.length === 1 ? "region" : "regions"}.</p>
      <DemoNote mode={loaded.mode} />
      {regions.map(({ region, slug, boroughs }) => (
        <section key={region.code} id={slug} className="methodology-card area-page__nav" aria-labelledby={`${slug}-title`} data-testid="england-region">
          <h2 id={`${slug}-title`}>{region.name}</h2>
          {region.name === "London" && <p><Link href="/area/london">Boroughs side by side</Link></p>}
          <ul className="area-page__list">
            {boroughs.map((borough) => (
              <li key={borough.geographyId}><Link href={areaPath(borough)}>{plainPlaceName(borough.name) ?? borough.name}</Link></li>
            ))}
          </ul>
        </section>
      ))}
    </AreaPageShell>
  );
}
