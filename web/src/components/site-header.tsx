import { BrandLockup } from "./brand-lockup";
import { StemDivider } from "./knit/satin";
import { BackToMapLink, BrandHomeLink, SavedAreasLink, SkipToContent } from "./site-header-client";
import { SiteMenuButton } from "./site-menu";
import { SiteSearch } from "./site-search";

/**
 * The header of every page off the map (guide, tools, Claude, privacy, terms, area
 * pages), subpage header v2: the ≡ site menu, the knitted house and the lowercase
 * wordmark, the small Search (a round button on phones), then ♡ N for a returning
 * reader and "Map →". The house and "Map →" go back to the map's last view. Skip to
 * content comes first; a stem stitch closes it.
 */
export function SiteHeader() {
  return (
    <header className="site-header" data-testid="site-header">
      <SkipToContent />
      <div className="site-header__row">
        <SiteMenuButton />
        <BrandHomeLink><BrandLockup /></BrandHomeLink>
        <SiteSearch id="site-search" collapsible />
        <div className="site-header__end">
          <SavedAreasLink />
          <BackToMapLink />
        </div>
      </div>
      <StemDivider className="site-header__seam" />
    </header>
  );
}
