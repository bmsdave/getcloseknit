import type { ReactNode } from "react";

import { Yarn } from "./knit";
import { KnitOrnament } from "./knit/ornament";
import type { OrnamentKind } from "@/lib/ornaments";

/**
 * The hero of a page off the map (DESIGN.md › Pages): an eyebrow led by a short
 * yarn flourish, a display heading, a lead, then a knitted colour-work band.
 * Text never sits on the knitting: the band comes after the words. Phones get
 * fewer, bigger stitches (64 columns) so the band still reads as knitting.
 */
export function SubpageHero({ eyebrow, title, lead, ornament, yarn = "var(--yarn-cherry)", leadTestId }: {
  eyebrow: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  ornament: OrnamentKind;
  /** The flourish's yarn colour: a token. */
  yarn?: string;
  leadTestId?: string;
}) {
  return (
    <header className="subpage-hero">
      <p className="subpage-hero__eyebrow">
        <svg className="subpage-hero__flourish" viewBox="0 0 40 14" aria-hidden="true" focusable="false">
          <Yarn d="M3 9C8 3 12 3 16 7s8 4 11 0 6-4 10 1" colour={yarn} width={2.8} />
        </svg>
        <span>{eyebrow}</span>
      </p>
      <h1>{title}</h1>
      {lead && <p className="subpage-hero__lead" data-testid={leadTestId}>{lead}</p>}
      <KnitOrnament kind={ornament} cols={104} className="subpage-hero__ornament subpage-hero__ornament--wide" />
      <KnitOrnament kind={ornament} cols={64} className="subpage-hero__ornament subpage-hero__ornament--narrow" />
    </header>
  );
}
