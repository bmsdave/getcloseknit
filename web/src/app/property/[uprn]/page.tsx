import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import { AreaSectionsForHome } from "@/components/area-full-page";
import { HomePage, homeFloodContext, type HomeData } from "@/components/home-page";
import { unavailablePage } from "@/components/unavailable-page";
import { BreadcrumbData } from "@/components/breadcrumb-data";
import { SectionSeedProvider } from "@/components/section-seed";
import { readAreaPageSeed } from "@/lib/area-page-seed";
import { loadAreaTrail } from "@/lib/area-pages-data";
import type { GeographyId } from "@/lib/contracts";
import { serverArea, serverDefaults, serverStandouts } from "@/lib/deployment";
import { areaCrumbs, type Crumb } from "@/lib/entity-nav";
import { DEFAULT_MAP_STATE } from "@/lib/map-state";
import { cleanAddress } from "@/lib/postcode-groups";
import { postcodeSlug } from "@/lib/postcode-page";
import { isUprn } from "@/lib/property-profile";
import { loadPropertyProfile } from "@/lib/property-profile-server";
import { beginRender } from "@/lib/server-render";
import { addressJsonLd, areaCard, NOT_FOUND_METADATA, pageMetadata, siteOrigin } from "@/lib/seo";
import { areaPath } from "@/lib/area-pages";

interface PropertyPageProps {
  params: Promise<{ uprn: string }>;
}

// One fetch per request: the metadata and the page share it.
const loadProfile = cache(loadPropertyProfile);

export async function generateMetadata({ params }: PropertyPageProps): Promise<Metadata> {
  beginRender();
  const { uprn } = await params;
  const loaded = isUprn(uprn) ? await loadProfile(uprn) : null;
  const profile = loaded?.body?.profile;
  // An unknown or hidden home is a 404 with its own title; a refused read keeps a plain one.
  if (!profile) return !loaded || loaded.status === 404 || loaded.status === 400 ? NOT_FOUND_METADATA : { title: "Home" };
  const address = cleanAddress(profile.displayAddress);
  return pageMetadata({
    title: address,
    description: `Recorded sales, prices in the area today and energy certificate facts for ${address}. About the area, not a valuation of this home.`,
    path: `/property/${uprn}`,
    image: areaCard(profile.areas.lsoa.id),
  });
}

// Permanent, shareable property page: server-rendered so the link opens with
// the numbers in place, for people and agents alike.
export default async function PropertyPage({ params }: PropertyPageProps) {
  // One render, one page view for the API's rate limit, and one profile read shared with the
  // metadata (loadPropertyProfile is cached per request). A refused or failed read is a page that says so
  // with Try again, never a thrown render (HTTP 500, React #441 when opened from /homes).
  beginRender();
  const { uprn } = await params;
  if (!isUprn(uprn)) notFound();
  const loaded = await loadProfile(uprn);
  if (loaded.status === 404 || loaded.status === 400) notFound();
  if (!loaded.body) return unavailablePage(loaded.status, "home");
  const { profile } = loaded.body;
  const lsoa = profile.areas.lsoa.id as GeographyId;
  const [trail, area, defaults, standouts] = await Promise.all([
    loadAreaTrail(lsoa), serverArea(lsoa), serverDefaults(), serverStandouts(lsoa, loaded.mode),
  ]);
  // The area's sections render on the server, from the same reads as the area page (the page is indexed).
  const release = defaults.release ?? DEFAULT_MAP_STATE.release;
  const period = area.summary?.period ?? "2026-06";
  const seed = await readAreaPageSeed({
    geographyId: lsoa, areaId: area.summary?.geographyId ?? lsoa, mode: loaded.mode, release, period, uprn: profile.uprn, layers: true,
  }, await headers());
  // London › borough › area › postcode › this home.
  const crumbs: Crumb[] = [
    ...areaCrumbs(trail, area.friendly.friendlyName?.trim() || profile.areas.lsoa.name),
    ...(profile.postcode ? [{ label: profile.postcode, href: `/postcode/${postcodeSlug(profile.postcode)}` }] : []),
    { label: cleanAddress(profile.displayAddress), href: null },
  ];
  const origin = await siteOrigin();
  const [longitude, latitude] = profile.location ?? [null, null];
  const ld = origin ? addressJsonLd(origin, {
    type: "Residence", name: cleanAddress(profile.displayAddress), path: `/property/${profile.uprn}`, postcode: profile.postcode,
    latitude: Number.isFinite(latitude) ? latitude : null, longitude: Number.isFinite(longitude) ? longitude : null,
    area: { name: area.friendly.friendlyName?.trim() || profile.areas.lsoa.name || "London neighbourhood", path: areaPath({ geographyId: lsoa }) },
  }) : null;
  const home: HomeData = { kind: "uprn", profile, productReleaseId: loaded.body.productReleaseId };
  return (
    <SectionSeedProvider seed={seed}>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />}
      <BreadcrumbData crumbs={crumbs} path={`/property/${profile.uprn}`} />
      <HomePage home={home} mode={loaded.mode}
        release={defaults.release} crumbs={crumbs}
        areaSections={(
          <AreaSectionsForHome geographyId={lsoa} mode={loaded.mode} release={release} period={period}
            addressId={profile.addressId} origin={{ uprn: profile.uprn }} standouts={standouts}
            // Its own EA bands lead; else its postcode's homes' worst; only then its area's land.
            flood={homeFloodContext(home)} />
        )} />
    </SectionSeedProvider>
  );
}
