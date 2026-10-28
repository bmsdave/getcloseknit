import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackToArea, Breadcrumbs } from "@/components/entity-nav";
import { PlacesSection } from "@/components/places-section";
import { areaTitle } from "@/lib/area-labels";
import { loadAreaTrail } from "@/lib/area-pages-data";
import { areaCrumbs } from "@/lib/entity-nav";
import type { GeographyId, Carrier } from "@/lib/contracts";
import { areaPath } from "@/lib/area-pages";
import { fetchApi, isTransientStatus, serverArea } from "@/lib/deployment";
import { placesPath, readAreaPlaces, type AreaPlacesState } from "@/lib/places";
import { fixtureAreaPlaces } from "@/lib/places-fixture";
import type { DataMode } from "@/lib/map-state";
import { unavailablePage } from "@/components/unavailable-page";
import { BreadcrumbData } from "@/components/breadcrumb-data";
import { REAL_PILOT_RELEASE } from "@/lib/map-state";
import { SiteHeader } from "@/components/site-header";
import { NOT_FOUND_METADATA, pageMetadata } from "@/lib/seo";

interface PlacesPageProps {
  params: Promise<{ carrier: string; code: string }>;
  searchParams: Promise<{ uprn?: string }>;
}

export async function generateMetadata({ params }: PlacesPageProps): Promise<Metadata> {
  const geography = await resolveGeography(params);
  const area = await serverArea(geography);
  if (!area.known && !isTransientStatus(area.status)) return NOT_FOUND_METADATA;
  // The name people use ("Peckham East · SE15"), never the official code.
  const name = areaTitle(area.summary?.name, area.friendly).title ?? "this area";
  const path = areaPath({ geographyId: geography });
  return pageMetadata({
    title: `Places near ${name}`,
    description: `${name}: places to eat, cafés, pubs and bars, shops, pharmacies, GPs, gyms, pools and parks, nearest first.`,
    path: `${path}/places`,
    image: `${path}/opengraph-image`,
  });
}

/** The places on the server (demo fixtures, else the API); null when the read failed: the browser tries again. */
async function serverPlaces(geography: GeographyId, uprn: string | null, mode: DataMode, release: string): Promise<AreaPlacesState | null> {
  if (mode === "demo") {
    const places = fixtureAreaPlaces(geography, uprn);
    return places ? readAreaPlaces(places, mode) : null;
  }
  const { status, body } = await fetchApi<unknown>(placesPath({ selected: geography, uprn, mode, release }));
  return status === 200 ? readAreaPlaces(body, mode) : null;
}

// The full list behind the area page's "All places →": one area's places in the area
// page's section frame and width, under its breadcrumbs, with the way back to the area page.
export default async function AreaPlacesPage({ params, searchParams }: PlacesPageProps) {
  const geography = await resolveGeography(params);
  const area = await serverArea(geography);
  if (isTransientStatus(area.status)) return unavailablePage(area.status, "area");
  if (!area.known) notFound();
  const { uprn } = await searchParams;
  const home = uprn && /^[0-9]{1,12}$/.test(uprn) ? uprn : null;
  const official = area.summary?.name ?? null;
  const title = areaTitle(official, area.friendly).title ?? geography;
  const release = area.release ?? (area.mode === "real" ? REAL_PILOT_RELEASE : "demo");
  const [trail, places] = await Promise.all([loadAreaTrail(geography), serverPlaces(geography, home, area.mode, release)]);
  const crumbs = areaCrumbs(trail, area.friendly.friendlyName?.trim() || official);
  return (
    <main className="places-page area-page" data-testid="places-page">
      <SiteHeader />
      <Breadcrumbs crumbs={crumbs} label="Where this area sits" />
      <BreadcrumbData crumbs={[...crumbs, { label: "Places", href: null }]} path={`${areaPath({ geographyId: geography })}/places`} />
      {geography.startsWith("uk:lsoa:") && <BackToArea geographyId={geography} name={title.split(" · ")[0]} />}
      <h1 className="places-page__title">{title}</h1>
      <PlacesSection geographyId={geography} uprn={home} mode={area.mode} release={release} initial={places} />
    </main>
  );
}

async function resolveGeography(params: PlacesPageProps["params"]): Promise<GeographyId> {
  const { carrier, code } = await params;
  if (!/^(lsoa|msoa|lad)$/.test(carrier) || !/^E\d{8}$/.test(code)) notFound();
  return `uk:${carrier as Carrier}:${code}`;
}
