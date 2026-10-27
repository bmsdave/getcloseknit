import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageUnavailable } from "@/components/page-unavailable";
import { loadAreaTrail } from "@/lib/area-pages-data";
import type { GeographyId } from "@/lib/contracts";
import { areaCrumbs, type Crumb } from "@/lib/entity-nav";
import { loadAreaFriendly } from "../area-context";
import { PostcodeHomesView } from "@/components/property-profile";
import { postcodeFromParam, postcodeSlug } from "@/lib/postcode-page";
import { NOT_FOUND_METADATA, pageMetadata } from "@/lib/seo";
import { loadPostcodeHomes } from "@/lib/property-profile-server";
import { beginRender } from "@/lib/server-render";

interface PostcodeHomesPageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PostcodeHomesPageProps): Promise<Metadata> {
  const postcode = postcodeFromParam((await params).code);
  if (!postcode) return NOT_FOUND_METADATA;
  return pageMetadata({
    title: `Homes in ${postcode}`,
    description: `Every recorded home in ${postcode}: type, tenure, floor area, energy rating and last sale.`,
    path: `/postcode/${postcodeSlug(postcode)}/homes`,
  });
}

export default async function PostcodeHomesPage({ params }: PostcodeHomesPageProps) {
  // One render is one page view for the API's rate limit; a refused or failed read says so with
  // Try again instead of a thrown render (HTTP 500).
  beginRender();
  const postcode = postcodeFromParam((await params).code);
  if (!postcode) notFound();
  const loaded = await loadPostcodeHomes(postcode);
  if (loaded.status === 404 || loaded.status === 400) notFound();
  if (!loaded.body) return <PageUnavailable status={loaded.status} what="list of homes" />;
  const { body } = loaded;
  return (
    <PostcodeHomesView postcode={body.postcode} homes={body.homes} disclaimer={body.disclaimer} mode={loaded.mode} withheld={body.withheld}
      crumbs={await homesCrumbs(body.postcode, body.geographyId)} geographyId={body.geographyId} />
  );
}

/**
 * CUJ04 step 4: London › borough › area › postcode › Homes, as on the postcode page. Without the
 * postcode's area (or its hierarchy) the trail is London › postcode › Homes.
 */
async function homesCrumbs(postcode: string, geography: GeographyId | null): Promise<Crumb[]> {
  const [friendly, trail] = geography ? await Promise.all([loadAreaFriendly(geography), loadAreaTrail(geography)]) : [null, []];
  const up = geography && trail.length ? areaCrumbs(trail, friendly?.name) : [{ label: "London", href: "/area/london" }];
  return [...up, { label: postcode, href: `/postcode/${postcodeSlug(postcode)}` }, { label: "Homes", href: null }];
}
