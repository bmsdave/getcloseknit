"use client";

import { useMemo } from "react";

import type { GeographyId } from "@/lib/contracts";
import { kidsPath, type AreaKidsResponse } from "@/lib/kids";
import { CYCLE_KEY } from "@/lib/map-cycle-lanes";
import { useSectionJson } from "./section-seed";

import "../styles/kids.css";

/** The Kids method and sources, for the Schools section's ⓘ (nurseries, road casualties and cycle lanes are rows of their sections). */
export const KIDS_METHOD = "Kids, each ranked against London areas: nurseries and pre-schools within 1 km rated well by Ofsted "
  + "(Good or Outstanding, or a report card with no area below Expected standard; childminders are not included), "
  + "Ofsted Early Years management information, Open Government Licence v3.0. Road safety: pedestrians and cyclists hurt "
  + "within 500 m in police-reported collisions over five years, DfT road safety data (STATS19), Open Government Licence v3.0. "
  + "Cycle lanes: km of protected track and TfL Cycleway within 1 km, TfL Cycling Infrastructure Database (surveyed 2017–19) "
  + "and Cycleways, Powered by TfL Open Data.";

/** The area's Kids figures through the section cache; "unavailable" when not served or not loaded (boroughs). */
export function useAreaKids(geographyId: GeographyId): AreaKidsResponse | null | "unavailable" {
  const payload = useSectionJson<AreaKidsResponse>(kidsPath(geographyId));
  return useMemo(() => payload === undefined ? null : payload?.available ? payload : "unavailable", [payload]);
}

/** What each cycle line means, for the map overlay and the Kids details. */
export function CycleLaneKey() {
  return (
    <ul className="cycle-key" data-testid="cycle-key" aria-label="Cycle lanes key">
      {CYCLE_KEY.map((item) => (
        <li key={item.kind}><span className="cycle-key__line" data-kind={item.kind} aria-hidden="true" />{item.label}</li>
      ))}
    </ul>
  );
}
