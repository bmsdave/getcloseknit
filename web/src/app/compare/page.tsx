import type { Metadata } from "next";
import { connection } from "next/server";

import { AreaPageShell, DemoNote } from "@/components/area-pages";
import { CompareFromSaved, CompareView } from "@/components/compare-view";
import { areaDisplayName } from "@/lib/area-labels";
import { demoFriendlyFields } from "@/lib/area-labels-fixture";
import { loadAreaPages, loadAreaProfile } from "@/lib/area-pages-data";
import { serverDefaults, serverStandouts } from "@/lib/deployment";
import { homesTable, parseCompareQuery, placesTable, schoolsTable, type CompareKind, type CompareTable } from "@/lib/compare-table";
import type { GeographyId } from "@/lib/contracts";
import { REAL_PILOT_RELEASE, type DataMode } from "@/lib/map-state";
import { loadPropertyProfile } from "@/lib/property-profile-server";
import { loadSchoolCard } from "@/lib/school-card";
import { pageMetadata } from "@/lib/seo";

// A comparison is the visitor's own pick (the ids ride in the link): never indexed.
export const metadata: Metadata = {
  ...pageMetadata({ title: "Compare", description: "Areas, schools or homes side by side.", path: "/compare" }),
  robots: { index: false, follow: true },
};

async function loadTable(kind: CompareKind, ids: string[]): Promise<{ table: CompareTable; mode: DataMode }> {
  if (kind === "schools") {
    const loaded = await Promise.all(ids.map(async (urn) => ({ urn, ...(await loadSchoolCard(urn)) })));
    return { table: schoolsTable(loaded), mode: loaded[0]?.mode ?? "demo" };
  }
  if (kind === "homes") {
    const loaded = await Promise.all(ids.map(async (uprn) => ({ uprn, ...(await loadPropertyProfile(uprn)) })));
    return { table: homesTable(loaded.map(({ uprn, body }) => ({ uprn, profile: body?.profile ?? null }))), mode: loaded[0]?.mode ?? "demo" };
  }
  const pages = await loadAreaPages(ids[0]);
  const inputs = await Promise.all(ids.map(async (id) => {
    const geographyId = id as GeographyId;
    return {
      id: geographyId,
      // The name people use ("Highbury East · N5"), never the official code.
      name: areaDisplayName(pages?.index.byId.get(geographyId)),
      // The district its homes-for-sale links search (real names carry it: "Highbury East · N5").
      outcode: pages?.index.byId.get(geographyId)?.postcodeDistrict
        ?? (pages?.mode === "demo" ? demoFriendlyFields(geographyId).postcodeDistrict : null),
      profile: pages ? await loadAreaProfile(pages, geographyId) : null,
      // The area page's tiles, so both say "Safer than 91%", "6 within 1.5 km", "37% over 55 dB".
      standouts: await serverStandouts(geographyId, pages?.mode ?? "demo"),
    };
  }));
  return { table: placesTable(inputs), mode: pages?.mode ?? "demo" };
}

/** /compare?kind=places|schools|homes&ids=…: one kind side by side (Compare v2). No ids: the saved ones. */
export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { kind, ids } = parseCompareQuery(await searchParams);
  if (ids.length === 0) {
    return (
      <AreaPageShell testId="compare-page">
        <CompareFromSaved kind={kind} />
      </AreaPageShell>
    );
  }
  const { table, mode } = await loadTable(kind, ids);
  return (
    <AreaPageShell testId="compare-page">
      <CompareView table={table} source={kind === "places" ? { mode, release: (await serverDefaults()).release ?? (mode === "real" ? REAL_PILOT_RELEASE : "demo") } : undefined} />
      <DemoNote mode={mode} />
    </AreaPageShell>
  );
}
