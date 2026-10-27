"use client";

import { useState } from "react";

/** Share this page: the system share sheet where there is one, otherwise copy the link. */
export function PropertyShare({ title, className = "property-button" }: {
  title: string;
  /** The button's look: a pill, or a row of the ⋯ menu. */
  className?: string;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      setCopied("failed");
    }
  }

  return (
    <span className="property-share">
      <button type="button" className={className} onClick={share} data-testid="property-share">
        Share
      </button>
      <span role="status" className="property-share__status">
        {copied === "copied" ? "Link copied" : copied === "failed" ? "Copy the address bar to share" : ""}
      </span>
    </span>
  );
}
