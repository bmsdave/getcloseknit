"use client";

import { useMemo } from "react";

import { type AreaHomeResponse, homePath, readAreaHome } from "@/lib/area-home";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { useSectionJson } from "./section-seed";
import { SourceNote } from "@/components/source-note";

/**
 * The area's Home payload: null while loading, "unknown" when it is not served (demo mode has no
 * Home layers, so it is never fetched there).
 */
export function useAreaHome(geographyId: GeographyId, mode: DataMode): AreaHomeResponse | null | "unknown" {
  const payload = useSectionJson(mode === "real" ? homePath(geographyId) : null);
  return useMemo(() => mode !== "real" ? "unknown" : payload === undefined ? null : readAreaHome(payload) ?? "unknown", [mode, payload]);
}

const loaded = (home: AreaHomeResponse | null | "unknown") => home && home !== "unknown" && home.available ? home : null;

/** For the section's ⓘ: every release behind the ratings, then the caveats. */
export function HomeSources({ home }: { home: AreaHomeResponse | null | "unknown" }) {
  const value = loaded(home);
  if (!value) return null;
  return (
    <>
      {value.sources.map((source) => <p key={source.release}>{source.attribution}</p>)}
      {value.caveats.map((caveat) => <SourceNote key={caveat} text={caveat} />)}
    </>
  );
}
