import type { Metadata } from "next";

import { StampDutyCalculator } from "@/components/stamp-duty-calculator";
import { ToolsShell } from "@/components/tools-shell";
import { readPrefill } from "@/lib/tools";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Stamp duty calculator",
  description: "Stamp Duty Land Tax on a home in England, band by band, with first-time buyer relief and surcharges.",
  path: "/tools/stamp-duty",
});

export default async function StampDutyPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = readPrefill(await searchParams);
  return (
    <ToolsShell current="stamp-duty" title="Stamp duty calculator">
      <StampDutyCalculator initialPrice={prefill.price} from={prefill.from} sold={prefill.sold} />
    </ToolsShell>
  );
}
