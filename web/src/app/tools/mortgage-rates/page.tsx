import type { Metadata } from "next";

import { MortgageRatesChart } from "@/components/mortgage-rates-chart";
import { ToolHandoff, ToolsShell } from "@/components/tools-shell";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Mortgage rates tracker",
  description: "Bank Rate against average 2-, 3- and 5-year fixed mortgage rates at 75% loan-to-value since 1996, from the Bank of England.",
  path: "/tools/mortgage-rates",
});

export default function MortgageRatesPage() {
  return (
    <ToolsShell current="mortgage-rates" title="Mortgage rates tracker" rates>
      <MortgageRatesChart />
      <ToolHandoff price={null} from={null} />
    </ToolsShell>
  );
}
