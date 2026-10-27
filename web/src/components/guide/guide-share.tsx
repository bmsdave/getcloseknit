"use client";

import { KnitIcon } from "@/components/knit/knit-icon";
import { useShareLink } from "@/components/match/share-link";

/** Share this guide article: the system share sheet, else the clipboard, with a line saying which. */
export function GuideShare({ title }: { title: string }) {
  const { share, status } = useShareLink("anyone with it can read this article.");
  return (
    <>
      <button type="button" className="guide-article-foot__quiet" data-testid="guide-share"
        onClick={() => void share(window.location.href.split("#")[0], `${title} · Close Knit guide`)}>
        <KnitIcon name="arrow-out" className="guide-article-foot__icon" />Share
      </button>
      {status}
    </>
  );
}
