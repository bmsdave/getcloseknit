import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CivicSection } from "@/components/civic-section";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import type { CivicTarget } from "@/lib/civic";
import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl } from "@/lib/evidence-service";
import { normalisePostcode } from "@/lib/postcode-page";

export const metadata: Metadata = {
  title: "Local council",
  description: "Council tax bands, ward councillors, MP and official area codes for a London area or postcode.",
  // One page per ?area= or ?postcode=: the area and postcode pages are the listed ones.
  robots: { index: false, follow: true },
};

const AREA = /^uk:(lsoa|msoa|lad):E0[0-9]{7}$/;

interface CivicPageProps { searchParams: Promise<{ area?: string; postcode?: string }> }

// Stand-alone page for the civic section: /civic?area=uk:lsoa:… or /civic?postcode=SW1A1AA.
export default async function CivicPage({ searchParams }: CivicPageProps) {
  const { area, postcode } = await searchParams;
  const normalised = postcode ? normalisePostcode(postcode) : null;
  let target: CivicTarget | null = null;
  if (area && AREA.test(area)) target = { geographyId: area as GeographyId };
  else if (normalised) target = { postcode: normalised };
  if (!target) notFound();
  return (
    <main className="subpage" data-testid="civic-page">
      <SiteHeader />
      <SubpageHero
        eyebrow={normalised ?? "Area"}
        title="Local council"
        ornament="town"
        yarn="var(--yarn-sun)"
      />
      <CivicSection target={target} mode={evidenceServiceUrl() ? "real" : "demo"} />
    </main>
  );
}
