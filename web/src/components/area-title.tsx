import type { Ref } from "react";

import { areaTitle, type FriendlyAreaFields } from "@/lib/area-labels";

/**
 * An area's heading: its friendly name and postcode district only
 * ("Alperton East · HA0"), for sight and screen readers alike. The official
 * name and code live in the page's Sources. Without a friendly name the
 * official name is the heading on its own.
 */
export function AreaTitle({ officialName, fields, fallback, headingRef, testId }: {
  officialName: string | null | undefined;
  fields: FriendlyAreaFields | null | undefined;
  fallback: string;
  headingRef?: Ref<HTMLHeadingElement>;
  testId?: string;
}) {
  const { title } = areaTitle(officialName, fields);
  return (
    <div className="area-title">
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} data-testid={testId}>
        {title ?? fallback}
      </h1>
    </div>
  );
}
