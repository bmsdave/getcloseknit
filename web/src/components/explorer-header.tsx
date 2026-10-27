"use client";

import Link from "next/link";

import type { SearchResult } from "@/lib/fixtures";
import { SHORT_QUERY } from "@/lib/viewport";

import { BrandLockup } from "./brand-lockup";
import { SiteSearch, useMedia } from "./site-search";
import { TopBarMenu } from "./top-bar-menu";
import { SavedAreasLink } from "./site-header-client";

/**
 * The map's top bar: one compact floating pill top-left, "≡ · close knit · Search" (the ≡ menu opens
 * under it), and ♡ N as its own chip at the right; the map shows across the rest of the top. The bar
 * itself is clear and lets the map take clicks between them. My match is the first of the map's round
 * buttons (map-layers.tsx). On phones the pill takes the width beside ♡ N, and the search opens as a
 * full-width overlay over the bar. A phone on its side keeps this one row: with nothing
 * chosen the search says "Choose an area", the desktop's hint row under it.
 */
export function ExplorerHeader({ onSelect, onSearch, menu, saved, empty = false }: {
  onSelect: (result: SearchResult) => void;
  /** ♡ N opens the Saved panel on the map. */
  saved?: { open: boolean; onOpen: () => void };
  /** The visitor started typing a search. */
  onSearch?: () => void;
  menu: React.ComponentProps<typeof TopBarMenu>;
  /** Nothing chosen yet (the short layout's search placeholder). */
  empty?: boolean;
}) {
  const short = useMedia(SHORT_QUERY);
  return (
    <header className="explorer-header" data-block="top-bar">
      <div className="explorer-pill" data-testid="top-bar-pill">
        <TopBarMenu {...menu} />
        {/* No prefetch: this is the map's own page, and prefetching it re-renders it on the server as the map boots. */}
        <Link href="/" prefetch={false} className="brand" aria-label="Close Knit home"><BrandLockup /></Link>
        <SiteSearch id="area-search" onSelect={onSelect} onSearch={onSearch} placeholder={short && empty ? "Choose an area" : "Search"} />
      </div>
      <SavedAreasLink onOpen={saved?.onOpen} open={saved?.open} />
    </header>
  );
}
