"use client";

import { useState } from "react";

import { isSavedItem, toggleSavedItem, useSaved, type SavedItemInput } from "@/lib/saved-items";

import { SaveHeart } from "./area-save-actions";

/** ♡ for a home, school or place: saves it to Saved on this device; a second press unsaves it. */
export function SaveItemButton({ item, testId = "save-item", className = "save-heart" }: {
  item: SavedItemInput;
  testId?: string;
  className?: string;
}) {
  const saved = isSavedItem(useSaved().items, item.kind, item.id);
  const [notice, setNotice] = useState<string | null>(null);
  function toggle() {
    const result = toggleSavedItem(item);
    setNotice(!result.ok ? "This browser is blocking storage, so nothing was saved here."
      : result.saved ? `${item.name} saved.` : `${item.name} removed from Saved.`);
  }
  return (
    <>
      <button type="button" className={className} data-testid={testId} aria-pressed={saved} aria-label={`Save ${item.name}`}
        title={saved ? "Saved" : "Save"} onClick={toggle}>
        <SaveHeart filled={saved} />
      </button>
      <span className="sr-only" role="status">{notice}</span>
    </>
  );
}
