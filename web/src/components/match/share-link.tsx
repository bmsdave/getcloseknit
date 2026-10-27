"use client";

import { useState } from "react";

import { showMapToast } from "@/lib/map-toast";
import { track } from "@/lib/usage";

/** What a share click ended in: the system share sheet, the clipboard, or neither (the link to copy). */
export type ShareOutcome = { kind: "shared" } | { kind: "copied" } | { kind: "cancelled" } | { kind: "failed"; url: string };

/**
 * Shares a link the way property-share.tsx does: the system share sheet where there is one, then the
 * clipboard. Never throws; a refused clipboard hands back the link so the page can show it to copy.
 */
export async function shareLink(url: string, title: string): Promise<ShareOutcome> {
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title, url });
      return { kind: "shared" };
    }
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") return { kind: "cancelled" };
    // The share sheet is not allowed here: fall through to the clipboard.
  }
  try {
    if (!navigator.clipboard) throw new Error("no clipboard");
    await navigator.clipboard.writeText(url);
    return { kind: "copied" };
  } catch {
    return { kind: "failed", url };
  }
}

/** "Link copied." on the map (board V4-10): 3 s. */
export const LINK_COPIED_MS = 3000;

/**
 * The share click and its visible answer: a role=status line that says what happened and who sees what. On the map
 * (`toast`, My match › Share) a copied link is the map toast "Link copied." instead of the line: the review
 * before sharing has already said who sees what.
 */
export function useShareLink(audience: string, options: { toast?: boolean } = {}) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  async function share(url: string, title: string) {
    const result = await shareLink(url, title);
    track("brief_share", { audience: shareAudience(url), outcome: result.kind });
    if (options.toast && result.kind === "copied") showMapToast("Link copied.", { ms: LINK_COPIED_MS, kind: "link-copied" });
    setOutcome(result);
  }
  const status = (
    <div className="share-status" role="status" data-testid="share-status">
      {outcome?.kind === "copied" && !options.toast && <p>Link copied — {audience}</p>}
      {outcome?.kind === "shared" && <p>Link shared — {audience}</p>}
      {outcome?.kind === "cancelled" && <p>Not shared. The link stays in the address bar if you want it later.</p>}
      {outcome?.kind === "failed" && (
        <>
          <p>Couldn&apos;t copy the link. Copy it from here — {audience}</p>
          <input className="share-status__url" readOnly aria-label="Link to share" value={outcome.url}
            onFocus={(event) => event.currentTarget.select()} />
        </>
      )}
    </div>
  );
  return { share, status };
}

/** What was shared, by the link's own page (never the link: a profile link carries the search). */
function shareAudience(url: string): string {
  try {
    const { pathname, hash } = new URL(url, "https://example.invalid");
    if (hash.includes("profile=")) return "search";
    return pathname.split("/")[1] || "map";
  } catch {
    return "unknown";
  }
}
