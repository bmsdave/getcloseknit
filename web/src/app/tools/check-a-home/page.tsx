import type { Metadata } from "next";

import { PlanAndCheck } from "@/components/plan-and-check";
import { ToolsShell } from "@/components/tools-shell";
import { shortAddress } from "@/components/postcode-homes-here";
import { areaTitle } from "@/lib/area-labels";
import { areaPath } from "@/lib/area-pages";
import { cleanAddress } from "@/lib/postcode-groups";
import { propertyPath } from "@/lib/property-profile";
import type { GeographyId } from "@/lib/contracts";
import { serverArea, serverDefaults } from "@/lib/deployment";
import type { DataMode } from "@/lib/map-state";
import { loadPropertyProfile } from "@/lib/property-profile-server";
import { readCheckHome } from "@/lib/tools";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Check a home",
  description: "Housing costs, referencing, leasehold checks, questions for the agent and the homes you're considering.",
  path: "/tools/check-a-home",
});

/** The linked area's name and the data mode; an unknown or missing area opens the tools without one. */
async function areaContext(id: GeographyId | null): Promise<{ mode: DataMode; area: { id: GeographyId; name: string } | null }> {
  if (id === null) return { mode: (await serverDefaults()).mode ?? "demo", area: null };
  const found = await serverArea(id);
  if (!found.known) return { mode: found.mode, area: null };
  const name = areaTitle(found.summary?.name, found.friendly).title ?? found.summary?.name ?? "This area";
  return { mode: found.mode, area: { id, name } };
}

export default async function CheckAHomePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { area: areaId, uprn, price, from, sold } = readCheckHome(await searchParams);
  const [{ mode, area }, home] = await Promise.all([
    areaContext(areaId),
    uprn ? loadPropertyProfile(uprn) : Promise.resolve(null),
  ]);
  const profile = home?.body?.profile ?? null;
  return (
    <ToolsShell current="check-a-home" title="Check a home">
      <PlanAndCheck
        mode={mode}
        area={area}
        uprn={uprn}
        tenure={profile?.facts.tenure ?? null}
        prefill={{ price, from, sold }}
        back={backToHome(uprn, profile ? cleanAddress(profile.displayAddress) : null, from, area)}
      />
    </ToolsShell>
  );
}

/** "Flat 1", "10 Sample Street": a `from` that names a home, not a basis ("your budget", "the area's typical…"). */
const NAMES_A_HOME = /^(\d|flat\b|apartment\b|unit\b)/i;

/**
 * r3 #15 (CUJ02 step 4, CUJ09): "← 10 Sample Street", the home being checked: its own page with a UPRN; a saved
 * listing (no UPRN) goes back to its area, whose Saved homes lists it. Null when the link names no home.
 */
function backToHome(uprn: string | null, address: string | null, from: string | null,
  area: { id: GeographyId } | null): { label: string; href: string } | null {
  if (uprn && address) return { label: shortAddress(address), href: propertyPath(uprn) };
  if (from && NAMES_A_HOME.test(from.trim()) && area) return { label: shortAddress(from.trim()), href: areaPath({ geographyId: area.id }) };
  return null;
}
