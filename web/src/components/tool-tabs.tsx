"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { TOOLS, toolHref, readPrefill, type ToolSlug } from "@/lib/tools";

function Tabs({ current, price }: { current: ToolSlug | null; price: number | null }) {
  return (
    <>
      <Link href="/tools" className="tools-nav__home" aria-current={current === null ? "page" : undefined}>Tools</Link>
      {TOOLS.map((tool) => (
        <Link key={tool.slug} href={toolHref(tool.slug, { price })} aria-current={current === tool.slug ? "page" : undefined}
          data-testid={`tool-tab-${tool.slug}`}>
          {tool.label}
        </Link>
      ))}
    </>
  );
}

/** The tabs with the page's ?price (kept up to date as it is typed, lib/tools carryPrice). */
function CarriedTabs({ current }: { current: ToolSlug | null }) {
  const params = useSearchParams();
  const price = readPrefill(Object.fromEntries(params.entries())).price;
  return <Tabs current={current} price={price} />;
}

/**
 * "Tools" and the four tabs; each tab carries the price being worked with (?price everywhere). On a phone the row
 * scrolls sideways: it opens scrolled to the current tab, so "Check a home" is never past the edge.
 */
export function ToolTabs({ current }: { current: ToolSlug | null }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = nav.current;
    const tab = bar?.querySelector<HTMLElement>("a[aria-current='page']");
    if (!bar || !tab) return;
    const [row, at] = [bar.getBoundingClientRect(), tab.getBoundingClientRect()];
    if (at.right > row.right) bar.scrollLeft += at.right - row.right + 16;
    else if (at.left < row.left) bar.scrollLeft -= row.left - at.left + 16;
  }, [current]);
  return (
    <nav ref={nav} className="tools-nav" aria-label="Tools">
      <Suspense fallback={<Tabs current={current} price={null} />}>
        <CarriedTabs current={current} />
      </Suspense>
    </nav>
  );
}
