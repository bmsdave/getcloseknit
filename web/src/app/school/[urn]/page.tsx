import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";

import { Breadcrumbs, WhatsNext } from "@/components/entity-nav";
import { BreadcrumbData } from "@/components/breadcrumb-data";
import { DemoNotice } from "@/components/property-profile";
import { SchoolCardView } from "@/components/school/school-card";
import { SiteHeader } from "@/components/site-header";
import { areaPath } from "@/lib/area-pages";
import { loadAreaTrail } from "@/lib/area-pages-data";
import { unavailablePage } from "@/components/unavailable-page";
import { isTransientStatus, serverArea } from "@/lib/deployment";
import { beginRender } from "@/lib/server-render";
import { areaCrumbs, upLinks, type Crumb } from "@/lib/entity-nav";
import { HomesNearStreamed } from "@/components/school/homes-near";
import type { GeographyId } from "@/lib/contracts";
import {
  hasEvidence, loadAreaCentre, loadSchoolCard, schoolDescription, schoolPath, schoolSchemaType, schoolTitle, straightLineKm, URN_PATTERN,
} from "@/lib/school-card";
import { areaCard, NOT_FOUND_METADATA, pageMetadata, schoolJsonLd, siteOrigin } from "@/lib/seo";

interface SchoolPageProps {
  params: Promise<{ urn: string }>;
  /** ?from={areaId} when an area's school list opened the card: a way back to that area. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** One fetch per request, shared by the metadata and the page. */
const load = cache(loadSchoolCard);

const AREA_ID = /^uk:(lsoa|msoa|lad):E\d{8}$/;

export async function generateMetadata({ params }: SchoolPageProps): Promise<Metadata> {
  beginRender();
  const { urn } = await params;
  if (!URN_PATTERN.test(urn)) return NOT_FOUND_METADATA;
  const { card, status } = await load(urn);
  if (!card) return isTransientStatus(status) ? { title: "School" } : NOT_FOUND_METADATA;
  // The preview is the school's neighbourhood card, not the site's.
  const metadata = pageMetadata({ title: schoolTitle(card), description: schoolDescription(card), path: schoolPath(urn), image: areaCard(card.areaId) });
  // Only a school with a result or an inspection is worth indexing (and is in the sitemap).
  return hasEvidence(card) ? metadata : { ...metadata, robots: { index: false, follow: true } };
}

// The school card: server-rendered, so people, search engines and agents get the numbers without
// the map. A closed school with a successor moves permanently to the successor's card.
export default async function SchoolPage({ params, searchParams }: SchoolPageProps) {
  // One render is one page view for the API's rate limit, however many reads it makes.
  beginRender();
  const { urn } = await params;
  if (!URN_PATTERN.test(urn)) notFound();
  const { mode, card, status } = await load(urn);
  if (!card) {
    // A refused (429) or failed read is a page with Try again, never a 404 for a real school
    // nor a thrown render (HTTP 500, React #441 when opened in the app).
    if (isTransientStatus(status)) return unavailablePage(status, "school");
    notFound();
  }
  if (card.details.successorUrn && card.details.successorUrn !== urn) permanentRedirect(schoolPath(card.details.successorUrn));
  const from = (await searchParams).from;
  const fromArea = typeof from === "string" && AREA_ID.test(from) ? from : null;
  const back = fromArea ? areaPath({ geographyId: fromArea as GeographyId }) : null;
  // Spec §2.1: the straight line from that area's centre to the school; left out when either point is unknown.
  const centre = fromArea ? await loadAreaCentre(fromArea, mode) : null;
  const { latitude, longitude } = card.school;
  const distance = centre && Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { name: centre.name, km: straightLineKm(centre.center, [longitude, latitude]) } : null;
  const origin = (await siteOrigin()) ?? "";
  // London › borough › its area › this school.
  const areaId = card.areaId && AREA_ID.test(card.areaId) ? card.areaId as GeographyId : null;
  const [trail, area] = areaId
    ? await Promise.all([loadAreaTrail(areaId), areaId.startsWith("uk:lsoa:") ? serverArea(areaId) : null])
    : [[], null];
  const crumbs: Crumb[] = [
    ...(trail.length > 0 ? areaCrumbs(trail, area?.friendly.friendlyName?.trim() || null) : [{ label: "London", href: "/area/london" }]),
    { label: card.school.name, href: null },
  ];
  // The postcodes with homes nearest the school, near the top (not the school's own postcode).
  const point = Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  const ld = schoolJsonLd(origin, {
    type: schoolSchemaType(card.school.phase), name: card.school.name, path: schoolPath(urn),
    postcode: card.details.postcode, locality: card.details.localAuthority,
    latitude: Number.isFinite(card.school.latitude) ? card.school.latitude : null,
    longitude: Number.isFinite(card.school.longitude) ? card.school.longitude : null,
  });
  return (
    <main className="school-page" data-testid="school-page">
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <Breadcrumbs crumbs={crumbs} />
      <BreadcrumbData crumbs={crumbs} path={schoolPath(urn)} />
      {back && <Link className="school-page__back" href={back} data-testid="school-back">← Back to the area</Link>}
      <DemoNotice mode={mode} />
      <SchoolCardView card={card} distance={distance}
        homesNear={<HomesNearStreamed point={point} mode={mode} areaHref={areaId ? areaPath({ geographyId: areaId }) : null} />} />
      <WhatsNext columns={{
        up: upLinks(crumbs),
        nearby: [
          { label: "Homes near", href: "#homes-near", testId: "next-homes-near" },
          areaId && { label: "On map", href: `/?${new URLSearchParams({ selected: areaId }).toString()}`, reload: true },
          { label: "Rankings", href: "/rankings" },
        ],
      }} />
    </main>
  );
}
