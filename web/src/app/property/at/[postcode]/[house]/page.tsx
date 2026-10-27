import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { loadAreaMarket } from "@/app/postcode/[code]/area-context";
import { HomeAreaSections } from "@/components/home-area-sections";
import { HomePage, homeFloodContext, type HomeData } from "@/components/home-page";
import { PageUnavailable } from "@/components/page-unavailable";
import { loadAreaTrail } from "@/lib/area-pages-data";
import type { GeographyId } from "@/lib/contracts";
import { serverDefaults } from "@/lib/deployment";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { areaCrumbs, type Crumb } from "@/lib/entity-nav";
import { DEFAULT_MAP_STATE } from "@/lib/map-state";
import { postcodeFromParam, postcodeSlug } from "@/lib/postcode-page";
import { loadPostcodeHomes } from "@/lib/property-profile-server";
import { loadStreetHome } from "@/lib/street-home-server";

interface StreetHomePageProps {
  params: Promise<{ postcode: string; house: string }>;
}

const load = cache(async (postcodeParam: string, house: string) => {
  const postcode = postcodeFromParam(postcodeParam);
  if (!postcode) return null;
  const mode = evidenceServiceUrl() ? "real" : "demo";
  const home = await loadStreetHome(mode, postcode, house);
  return home ? { home, mode, postcode } as const : null;
});

// A street-level home is reached by search or a shared link, never listed: noindex, and not in any sitemap.
// An unknown one is a 404, which Next marks noindex itself (a second robots tag would double it).
export async function generateMetadata({ params }: StreetHomePageProps): Promise<Metadata> {
  const { postcode, house } = await params;
  const loaded = await load(postcode, house);
  if (!loaded || "uprn" in loaded.home || "postcodePage" in loaded.home || "unavailable" in loaded.home) return { title: "Home" };
  const { label } = loaded.home;
  return {
    title: label,
    description: `${label}: no recorded sale. About the area, not a valuation of this home.`,
    robots: { index: false, follow: true },
  };
}

// The home has no recorded sale, so there is no UPRN: it is found through its street and the numbered
// homes either side. A number that is a recorded home goes to its property page instead, or to its
// postcode's page when its records have no UPRN (never a "No recorded sale" page for a recorded home).
export default async function StreetHomePage({ params }: StreetHomePageProps) {
  const { postcode: postcodeParam, house } = await params;
  const loaded = await load(postcodeParam, house);
  if (!loaded) notFound();
  const { home, mode } = loaded;
  // A busy or unreachable API gets a page saying so with Try again, never a 500.
  if ("unavailable" in home) return <PageUnavailable status={home.unavailable} what="home" />;
  if ("uprn" in home) redirect(`/property/${home.uprn}`);
  if ("postcodePage" in home) redirect(`/postcode/${postcodeSlug(loaded.postcode)}`);
  const areaId = home.areaId as GeographyId | null;
  const [trail, areaMarket, homes, defaults] = await Promise.all([
    areaId ? loadAreaTrail(areaId) : [],
    areaId ? loadAreaMarket(mode, areaId) : null,
    loadPostcodeHomes(home.postcode),
    serverDefaults(),
  ]);
  // London › borough › area › postcode › this home.
  const crumbs: Crumb[] = [
    ...areaCrumbs(trail),
    { label: home.postcode, href: `/postcode/${postcodeSlug(home.postcode)}` },
    { label: home.label, href: null },
  ];
  // 404: the postcode has no recorded homes; any other failure reads "List unavailable", never "no homes".
  const otherHomes = homes.status === 200 ? homes.body?.homes ?? null : homes.status === 404 ? [] : null;
  const data: HomeData = { kind: "street", street: home, areaMarket, otherHomes };
  return (
    <HomePage home={data} mode={mode}
      release={defaults.release} crumbs={crumbs}
      // Noindex: the area's sections load in the browser, as the reader nears them, to spare the API.
      areaSections={areaId && (
        <HomeAreaSections geographyId={areaId} mode={mode} release={defaults.release ?? DEFAULT_MAP_STATE.release} period={null}
          addressId={null} origin={{ postcode: home.postcode }}
          // No record of its own: its postcode's homes' worst band, else its area's land.
          flood={homeFloodContext(data)} />
      )} />
  );
}
