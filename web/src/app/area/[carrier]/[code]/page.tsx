import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AreaFullPage } from "@/components/area-full-page";
import { SectionSeedProvider } from "@/components/section-seed";
import { readAreaPageSeed } from "@/lib/area-page-seed";
import { beginRender } from "@/lib/server-render";
import { areaGuideMetadata } from "@/components/area-pages-guide";
import { BoroughPage } from "@/components/borough-page";
import { legacyMapRedirect } from "@/lib/area-brief";
import { areaPath } from "@/lib/area-pages";
import { areaTitle } from "@/lib/area-labels";
import { loadAreaTrail } from "@/lib/area-pages-data";
import { areaCrumbs } from "@/lib/entity-nav";
import { formatPricePerSquareMetre } from "@/lib/overview-scorecard";
import type { AddressId, GeographyId, Carrier } from "@/lib/contracts";
import { isTransientStatus, serverArea, serverStandouts } from "@/lib/deployment";
import { unavailablePage } from "@/components/unavailable-page";
import { applyEnvDefaults, parseMapState } from "@/lib/map-state";
import { isUprn } from "@/lib/property-profile";
import { loadPropertyProfile } from "@/lib/property-profile-server";
import { regionScope, scopeName } from "@/lib/scope-name";
import { areaSearchDescription, areaSearchTitle, NOT_FOUND_METADATA, pageMetadata, placeJsonLd, siteOrigin } from "@/lib/seo";
import { BreadcrumbData } from "@/components/breadcrumb-data";

interface AreaPageProps {
  params: Promise<{ carrier: string; code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The page's name and one-line description (title, previews, JSON-LD); null for an unknown area. */
async function areaHeadline(geography: GeographyId): Promise<{ title: string; name: string; description: string } | null> {
  if (!geography.startsWith("uk:lsoa:")) {
    const guide = await areaGuideMetadata(geography);
    return guide;
  }
  const area = await serverArea(geography);
  if (!area.known) return null;
  // The friendly name only: the official name and code stay in the page's Sources.
  const { title } = areaTitle(area.summary?.name, area.friendly);
  const name = title ?? "Neighbourhood";
  const value = area.summary?.value;
  return {
    title: areaSearchTitle(name, "lsoa", ""),
    name,
    description: areaSearchDescription(name, "lsoa", "", value != null ? formatPricePerSquareMetre(value) : null),
  };
}

export async function generateMetadata({ params }: Pick<AreaPageProps, "params">): Promise<Metadata> {
  beginRender();
  const geography = await resolveGeography(params);
  const headline = await areaHeadline(geography);
  if (!headline) return NOT_FOUND_METADATA;
  // This segment's opengraph-image.tsx is the card: no image here.
  return pageMetadata({ title: headline.title, description: headline.description, path: areaPath({ geographyId: geography }), image: null });
}

/** schema.org Place for the area, beside the page. */
async function PlaceData({ geography }: { geography: GeographyId }) {
  const [headline, origin, trail] = await Promise.all([areaHeadline(geography), siteOrigin(), loadAreaTrail(geography)]);
  if (!headline || !origin) return null;
  const data = placeJsonLd(origin, {
    name: headline.name, path: areaPath({ geographyId: geography }), description: headline.description,
    region: scopeName(regionScope(trail[0]?.regionCode)), administrative: geography.startsWith("uk:lad:"),
  });
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: data }} />;
}

// A borough gets the area page's frame at borough level (verdict, tags, the 12 tiles,
// its areas as a sortable list, FAQ); a neighbourhood (LSOA) and a wider neighbourhood (MSOA) the full
// area page, as the map sheet shows them: everything the map's brief leaves out, card by card. An old link carrying map settings (?layer=,
// ?zoom=…) still opens the map on the area.
// Permanent area links resolve against the same data the explorer serves:
// fixtures in demo, the evidence API in real mode. Only an area unknown to
// that source is a 404; an API that refuses or is unreachable gets a page
// saying so with Try again.
export default async function AreaPage({ params, searchParams }: AreaPageProps) {
  // Every API read of this render, the sections' included, is one page view (lib/server-render.ts).
  beginRender();
  const geography = await resolveGeography(params);
  const search = toSearchParams(await searchParams);
  if (geography.startsWith("uk:lad:")) {
    return <><BoroughPage geography={geography} sort={search.get("sort") ?? undefined} /><PlaceData geography={geography} /></>;
  }
  // A neighbourhood (LSOA) and a wider neighbourhood (MSOA) share the one area page.
  const legacy = legacyMapRedirect(geography, search);
  if (legacy) redirect(legacy);
  const area = await serverArea(geography);
  // An API that refuses or fails (429, 503) gets a page saying so with Try again, never an
  // empty "London neighbourhood" shell with only its Sources.
  if (isTransientStatus(area.status)) return unavailablePage(area.status, "area");
  if (!area.known) notFound();
  // The map's mode and release, when the link carries them, win over the deployment's defaults
  // (demo on a real deployment only with ?dev=1).
  const parameters = new URLSearchParams({ selected: geography });
  for (const key of ["mode", "release", "dev"]) {
    const value = search.get(key);
    if (value) parameters.set(key, value);
  }
  applyEnvDefaults(parameters, { mode: area.mode, release: area.release });
  const { mode, release } = parseMapState(parameters);
  const uprn = search.get("uprn");
  const address = search.get("address");
  const period = area.summary?.period ?? "2026-06";
  // SEO rule: every section is read here and rendered whole; the household's tailoring only reorders and highlights.
  const seedQuery = { geographyId: geography, areaId: area.summary?.geographyId ?? geography, mode, release, period, uprn: uprn && isUprn(uprn) ? uprn : null };
  const [home, trail, standouts, seed] = await Promise.all([
    uprn && isUprn(uprn) ? loadPropertyProfile(uprn) : null, loadAreaTrail(geography), serverStandouts(geography, mode),
    readAreaPageSeed(seedQuery, await headers()),
  ]);
  const crumbs = areaCrumbs(trail, area.friendly?.friendlyName?.trim() || area.summary?.name || null);
  return (
    <SectionSeedProvider seed={seed}>
    <AreaFullPage
      geographyId={geography}
      mode={mode}
      release={release}
      period={period}
      officialName={area.summary?.name ?? null}
      friendly={area.friendly}
      uprn={uprn && isUprn(uprn) ? uprn : null}
      addressId={address && /^uk:addr:[0-9a-f]+$/.test(address) ? address as AddressId : null}
      tenure={home?.body?.profile.facts.tenure ?? null}
      crumbs={crumbs}
      standouts={standouts}
    />
    <PlaceData geography={geography} />
    <BreadcrumbData crumbs={crumbs} path={areaPath({ geographyId: geography })} />
    </SectionSeedProvider>
  );
}

function toSearchParams(values: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, entry);
  }
  return search;
}

async function resolveGeography(
  params: AreaPageProps["params"],
): Promise<GeographyId> {
  const { carrier, code } = await params;
  if (!/^(lsoa|msoa|lad)$/.test(carrier) || !/^E\d{8}$/.test(code)) notFound();
  return `uk:${carrier as Carrier}:${code}`;
}
