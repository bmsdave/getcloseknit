"use client";

import { useEffect, useRef, useState } from "react";

import { useSeed } from "@/components/section-seed";
import { areaProfilePath } from "./area-profile-path";
import type { AreaLondonRanks, AreaProfileResponse, GeographyId, LondonRank } from "./contracts";
import { isFixtureSourceVersion } from "./fixtures";
import type { DataMode } from "./map-state";
import { sectionFetch } from "./section-fetch";

export { areaProfilePath };

export type AreaProfileState =
  | { status: "loading" }
  | { status: "available"; profile: AreaProfileResponse }
  | { status: "unavailable"; reason: string };

const RANK_KEYS = ["gettingAround", "quiet", "greenSpace", "bestPrimary", "bestSecondary"] as const;

function readRank(value: unknown): LondonRank | null {
  const rank = value as Partial<LondonRank> | null;
  const percentile = rank?.percentile;
  if (typeof percentile !== "number" || !Number.isFinite(percentile) || percentile < 0 || percentile > 100) return null;
  if (typeof rank?.higherIsBetter !== "boolean" || typeof rank.value !== "number") return null;
  return rank as LondonRank;
}

/** London ranks with every rank 0-100 or null: a malformed one becomes "No rating", never a score. */
export function readLondonRanks(value: unknown): AreaLondonRanks | null {
  const ranks = value as Partial<AreaLondonRanks> | null;
  if (!ranks || ranks.scope !== "london-lsoa") return null;
  const read = Object.fromEntries(RANK_KEYS.map((key) => [key, readRank(ranks[key])])) as Pick<AreaLondonRanks, (typeof RANK_KEYS)[number]>;
  if (read.bestPrimary && typeof read.bestPrimary.school?.urn !== "string") read.bestPrimary = null;
  if (read.bestSecondary && typeof read.bestSecondary.school?.urn !== "string") read.bestSecondary = null;
  return { scope: "london-lsoa", ...read, sources: Array.isArray(ranks.sources) ? ranks.sources.filter(isRankSource) : [] };
}

type RankSource = AreaLondonRanks["sources"][number];

function isRankSource(value: unknown): value is RankSource {
  const source = value as Partial<RankSource> | null;
  return typeof source?.id === "string" && typeof source.licence === "string" && typeof source.attribution === "string";
}

/** Parse a profile payload; real mode never accepts fixture numbers. */
export function readAreaProfile(payload: unknown, mode: DataMode): AreaProfileState {
  const profile = payload as Partial<AreaProfileResponse> | null;
  if (!profile || profile.schemaVersion !== "area-profile.v1" || !Array.isArray(profile.metrics)) {
    return { status: "unavailable", reason: "invalid-profile-response" };
  }
  if (mode === "real" && profile.metrics.some((metric) => isFixtureSourceVersion(metric.sourceVersion))) {
    return { status: "unavailable", reason: "fixture-profile-in-real-mode" };
  }
  return { status: "available", profile: { ...profile, regionRanks: readLondonRanks(profile.regionRanks) } as AreaProfileResponse };
}

/** Every topic for one area (Overview scorecard); refetches only when an input changes. */
export function useAreaProfile(selected: GeographyId | null, period: string, mode: DataMode, release: string): AreaProfileState | null {
  // The area page's server read it (components/section-seed.tsx): start there and skip the fetch.
  const path = selected ? areaProfilePath({ selected, period, mode, release }) : null;
  const seeded = useSeed(path);
  const [state, setState] = useState<AreaProfileState | null>(() => seededProfile(seeded, mode));
  const seededPath = useRef(seeded === undefined ? null : path);
  useEffect(() => {
    if (path !== null && path === seededPath.current) return;
    seededPath.current = null;
    if (!path) { setState(null); return; }
    const controller = new AbortController();
    setState({ status: "loading" });
    // Batched with the area's other sections; a stale answer is dropped, not aborted.
    sectionFetch(path)
      .then(async (response) => {
        if (!response.ok) return { status: "unavailable", reason: `http-${response.status}` } as const;
        return readAreaProfile(await response.json(), mode);
      })
      .then((next) => { if (!controller.signal.aborted) setState(next); })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "unavailable", reason: "profile-unreachable" });
      });
    return () => controller.abort();
  }, [path, mode]);
  return state;
}

/** The server's profile for the page, or null to start loading; a seeded null was a 404. */
function seededProfile(seeded: unknown, mode: DataMode): AreaProfileState | null {
  if (seeded === undefined) return null;
  return seeded === null ? { status: "unavailable", reason: "http-404" } : readAreaProfile(seeded, mode);
}
