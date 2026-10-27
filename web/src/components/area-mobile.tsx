"use client";

import { useMemo } from "react";

import { type AreaMobileResponse, mobilePath, mobileRow, readAreaMobile } from "@/lib/area-mobile";
import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { useSectionJson } from "./section-seed";

type Mobile = AreaMobileResponse | null | "unknown";

/** The area's mobile payload: null while loading, "unknown" when it is not served (demo mode has no mobile layer). */
export function useAreaMobile(geographyId: GeographyId, mode: DataMode): Mobile {
  const payload = useSectionJson(mode === "real" ? mobilePath(geographyId) : null);
  return useMemo(() => mode !== "real" ? "unknown" : payload === undefined ? null : readAreaMobile(payload) ?? "unknown", [mode, payload]);
}

const loaded = (mobile: Mobile) => mobile && mobile !== "unknown" && mobile.available ? mobile : null;

/** One plain row under Homes' key numbers, next to broadband: 4G indoors, 5G outdoors, for the borough. */
export function MobileRow({ mobile, scope }: { mobile: Mobile; scope?: string }) {
  const row = mobileRow(loaded(mobile), scope);
  if (!row) return null;
  return (
    <dl className="key-numbers" data-testid="home-mobile">
      <div><dt>{row.term}</dt><dd>{row.value}</dd></div>
    </dl>
  );
}

/** For the section's ⓘ: Ofcom's release, then the caveats. */
export function MobileSourceLines({ mobile }: { mobile: Mobile }) {
  const value = loaded(mobile);
  if (!value) return null;
  return (
    <>
      {value.sources.map((source) => <p key={source.release}>{source.attribution}</p>)}
      {value.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}
    </>
  );
}

export function AreaMobile({ geographyId, mode, scope }: { geographyId: GeographyId; mode: DataMode; scope?: string }) {
  return <MobileRow mobile={useAreaMobile(geographyId, mode)} scope={scope} />;
}

export function MobileSources({ geographyId, mode }: { geographyId: GeographyId; mode: DataMode }) {
  return <MobileSourceLines mobile={useAreaMobile(geographyId, mode)} />;
}
