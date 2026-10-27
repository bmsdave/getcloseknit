"use client";

import { useEffect, useState, type Ref } from "react";

import { Yarn } from "@/components/knit";
import { KnitIcon } from "@/components/knit/knit-icon";

// A strand that changes colour as it runs: three plied yarns end to end under the heading.
const STRANDS = [
  { d: "M3 7c8-5 14-5 22 0s14 5 22 0", colour: "var(--yarn-cherry)" },
  { d: "M47 7c8-5 14-5 22 0s14 5 22 0", colour: "var(--yarn-sun)" },
  { d: "M91 7c8-5 14-5 22 0s14 5 22 0", colour: "var(--yarn-cobalt)" },
];

/**
 * The brief's header on /brief and in Make my brief: an eyebrow, the heading, a multicolour yarn
 * accent (plied Yarn from components/knit, never a texture) and "Your brief is ready" once it is.
 * The status region is there from the start and fills in when the brief is ready, so it is read out.
 */
export function BriefHeader({ eyebrow, title, level, headingId, headingRef, testId, ready, announce = true }: {
  eyebrow: string;
  title: string;
  level: 1 | 2;
  headingId?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  testId?: string;
  ready: boolean;
  /** False for a brief someone shared: it is theirs, so no "Your brief is ready". */
  announce?: boolean;
}) {
  const [announced, setAnnounced] = useState(false);
  useEffect(() => setAnnounced(ready), [ready]);
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className="brief-header" data-testid="brief-header">
      <p className="brief-header__eyebrow">{eyebrow}</p>
      <Heading ref={headingRef} id={headingId} tabIndex={headingRef ? -1 : undefined} data-testid={testId}>{title}</Heading>
      <svg className="brief-header__yarn" viewBox="0 0 138 14" aria-hidden="true" focusable="false">
        {STRANDS.map((strand) => <Yarn key={strand.colour} d={strand.d} colour={strand.colour} width={3.2} />)}
      </svg>
      <p className="brief-header__status" role="status" data-testid="brief-ready">
        {announced && announce && <><KnitIcon name="check" colour="currentColor" className="knit-inline" style={{ width: 14, height: 14 }} />Your brief is ready</>}
      </p>
    </header>
  );
}
