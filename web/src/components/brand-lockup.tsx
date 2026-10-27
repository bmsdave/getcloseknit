import { KnitLogo } from "./knit";

/**
 * The one brand lockup (DESIGN.md › Logo): the knitted house on wool beside the lowercase
 * wordmark, the same size on the map's bar and on every page's header. Only the narrowest phones
 * (360px and under) drop the wordmark, everywhere alike. The link around it gives the accessible name.
 */
export function BrandLockup() {
  return (
    <span className="brand-lockup" aria-hidden="true">
      <span className="brand-lockup__mark"><KnitLogo title="" /></span>
      <span className="brand-lockup__word">close knit</span>
    </span>
  );
}
