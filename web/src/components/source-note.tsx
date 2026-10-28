"use client";

import { createContext, useContext, type ReactNode } from "react";

import { localNote } from "@/lib/coverage-words";

/** Whether the page's area is in London: its source notes say "borough" there and "council" elsewhere. */
export const AreaInLondon = createContext(true);

/** One source note (a caveat, word for word) in the words of the page's area (lib/coverage-words.ts localNote). */
export function SourceNote({ text }: { text: string }) {
  return <p>{localNote(text, useContext(AreaInLondon))}</p>;
}

/** The page's area for its source notes (a server page passes its region's London-ness through this). */
export function AreaWords({ london, children }: { london: boolean; children: ReactNode }) {
  return <AreaInLondon.Provider value={london}>{children}</AreaInLondon.Provider>;
}
