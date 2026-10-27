"use client";

import { useMemo } from "react";

import type { GeographyId } from "@/lib/contracts";
import { type AreaFutureTransport, futureTransportPath, readAreaFutureTransport } from "@/lib/future-transport";
import { useSectionJson } from "./section-seed";

/** "New station Old Oak Common ≈ 1.2 km away, under construction" with its official page; nothing beyond 2 km. */
export function FutureTransportNote({ data }: { data: AreaFutureTransport | null }) {
  const nearest = data?.value.nearest;
  if (!data?.value.note || !nearest) return null;
  return (
    <p className="metric-description" data-testid="future-transport" data-status={nearest.status}>
      {data.value.note} · <a href={nearest.sourceUrl} rel="noopener noreferrer" target="_blank">Source</a>
    </p>
  );
}

/** The area's nearest new station, read in real mode (the API serves it; demo has no list). */
export function FutureTransportLine({ geographyId }: { geographyId: GeographyId }) {
  const payload = useSectionJson(futureTransportPath(geographyId));
  const data = useMemo(() => (payload ? readAreaFutureTransport(payload) : null), [payload]);
  return <FutureTransportNote data={data} />;
}
