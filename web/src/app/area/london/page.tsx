import type { Metadata } from "next";
import { connection } from "next/server";

import {
  AreaFaq,
  AreaPageShell,
  AreaProfile,
  AreaUnavailable,
  DemoNote,
  RankingLinks,
} from "@/components/area-pages";
import { areaFacts, availableRankings, BOROUGH_COLUMNS, boroughSortParam, boroughTable, LONDON } from "@/lib/area-pages";
import { loadAreaPages } from "@/lib/area-pages-data";
import { datasetJsonLd, pageMetadata, siteOrigin } from "@/lib/seo";

import { BoroughTable } from "./borough-table";

const DESCRIPTION = "London as a whole and all 33 boroughs side by side: typical price per square metre, recorded crime, household income, schools, places for families and going out, from official public data.";

export const metadata: Metadata = pageMetadata({
  // The Dataset keeps the long description; a search result shows 155 characters.
  title: "London boroughs compared: house prices, crime, schools", path: "/area/london",
  description: "All 33 London boroughs side by side: house prices per m², crime rate, income, schools, and places for families and going out, from official data.",
});

// Top of the area hierarchy: London → borough → MSOA → neighbourhood.
// The boroughs are one sortable table (it replaces the "Boroughs by …" rankings,
// whose old links open it sorted by their figure: ?sort=price, crime, families, going-out).
export default async function LondonPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const loaded = await loadAreaPages();
  if (!loaded) return <AreaUnavailable />;
  const { index, mode } = loaded;
  const facts = areaFacts(index, LONDON);
  if (!facts) return <AreaUnavailable />;
  const query = await searchParams;
  const sort = boroughSortParam(query.sort, query.dir);
  const rows = boroughTable(index, sort).map(({ name, href, cells }) => ({ name, href, cells }));
  const columns = BOROUGH_COLUMNS.map(({ id, label, title, sortable }) => ({ id, label, title, sortable }));
  const origin = await siteOrigin();
  return (
    <AreaPageShell testId="area-london-page" className="area-london">
      <p className="eyebrow">Region</p>
      <h1>London</h1>
      <p className="methodology-intro">
        {rows.length} boroughs and {facts.neighbourhoods.toLocaleString("en-GB")} neighbourhoods, with figures from official public data.
      </p>
      <DemoNote mode={mode} />
      <section className="area-london__boroughs" aria-labelledby="boroughs-title" data-testid="area-children">
        <h2 id="boroughs-title">All {rows.length} London boroughs</h2>
        <BoroughTable columns={columns} rows={rows} initial={sort} />
      </section>
      <AreaProfile facts={facts} london={null} />
      <RankingLinks available={availableRankings(index)} />
      <AreaFaq facts={facts} london={null} />
      {origin && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{
          __html: datasetJsonLd(origin, { description: DESCRIPTION, period: index.data.periods["price-per-square-metre"] ?? null }),
        }} />
      )}
    </AreaPageShell>
  );
}
