import type { Metadata } from "next";

import { InvestorCalculator } from "@/components/investor-calculator";
import { ToolsShell } from "@/components/tools-shell";
import { latestRateHint } from "@/lib/rate-hint";
import { readPrefill } from "@/lib/tools";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Buy-to-let calculator",
  description: "Rental yield, monthly cash flow and cash needed for a buy-to-let home in England, with HMO, refinance and flip tabs.",
  path: "/tools/investor",
});

export default async function InvestorPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = readPrefill(await searchParams);
  return (
    <ToolsShell current="investor" title="Buy-to-let calculator">
      <InvestorCalculator initialPrice={prefill.price} from={prefill.from} rateHint={latestRateHint()} />
    </ToolsShell>
  );
}
