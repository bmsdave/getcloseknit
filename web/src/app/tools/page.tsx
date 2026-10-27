import type { Metadata } from "next";
import Link from "next/link";

import { KnitIcon } from "@/components/knit/knit-icon";
import { ToolsShell } from "@/components/tools-shell";
import { TOOLS, type ToolSlug } from "@/lib/tools";
import { pageMetadata } from "@/lib/seo";

const ICONS: Record<ToolSlug, string> = { "stamp-duty": "income", "mortgage-rates": "trend", investor: "home", "check-a-home": "check" };

export const metadata: Metadata = pageMetadata({
  title: "Tools",
  description: "Stamp duty, mortgage rates and buy-to-let sums for homes in England.",
  path: "/tools",
});

export default function ToolsPage() {
  return (
    <ToolsShell current={null} title="Tools">
      <ul className="tools-index">
        {TOOLS.map((tool) => (
          <li key={tool.slug} className="methodology-card tools-card tools-index__card">
            <span className="tools-index__icon" aria-hidden="true"><KnitIcon name={ICONS[tool.slug]} className="tools-index__glyph" /></span>
            <h2><Link href={`/tools/${tool.slug}`}>{tool.title}</Link></h2>
            <KnitIcon name="arrow-right" className="tools-index__arrow" />
          </li>
        ))}
      </ul>
    </ToolsShell>
  );
}
