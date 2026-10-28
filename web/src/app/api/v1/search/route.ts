import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { AddressId, GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { SEARCH_RESULTS, searchFixtures, searchSchools, type SearchKind, type SearchResult, type StreetMatch } from "@/lib/fixtures";
import {
  isPostcodeQuery,
  lookupPostcode,
  searchWithPostcodeFallback,
  sectorResults,
} from "@/lib/postcode-search";
import { postcodeSlug } from "@/lib/postcode-page";
import { readSectorList, sectorQuery } from "@/lib/sector";
import { demoSectorList } from "@/lib/sector-fixture";
import { searchPreviewStations } from "@/lib/zones";

interface UpstreamSearchResult {
  kind?: SearchKind;
  geographyId: GeographyId;
  label: string;
  secondaryLabel: string;
  uprn: string | null;
  addressId?: AddressId | null;
  center: [number, number];
  street?: StreetMatch | null;
  /** scope=all: a school's URN, a station's or a named park's id. */
  urn?: string;
  /** An independent school: no school page, so it opens the map at its LSOA. */
  independent?: boolean;
  stationId?: string;
  placeId?: string;
}

interface UpstreamSearch {
  results: UpstreamSearchResult[];
}

/**
 * The search box's rows. ?scope=all (the site's one Search) adds schools, stations and named
 * parks after the areas and homes; without it the rows are the areas and homes callers had before.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const everything = request.nextUrl.searchParams.get("scope") === "all";
  // "W5 1" / "W5-1": the sector's own page leads, when the sector list knows it.
  const sector = sectorQuery(query);
  if (evidenceServiceUrl()) {
    const sectors = sector ? await upstreamSectors(sector, request) : [];
    const upstream = await fetchEvidence<UpstreamSearch>(
      `/api/v1/search${request.nextUrl.search}`,
      request,
    );
    if (upstream.status !== 200) return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
    const results = upstream.body.results.map(toSearchResult);
    if (results.length > 0 || !isPostcodeQuery(query)) {
      return NextResponse.json({ schemaVersion: "area-search.v1", results: [...sectors, ...results] });
    }
    const fallback = await searchWithPostcodeFallback({
      query,
      searchUpstream: async (code) => {
        const retry = await fetchEvidence<UpstreamSearch>(
          `/api/v1/search?q=${encodeURIComponent(code)}`,
          request,
        );
        return retry.status === 200 ? retry.body.results.map(toSearchResult) : [];
      },
      lookupPostcode: (text) => lookupPostcode(text),
    });
    return NextResponse.json({ schemaVersion: "area-search.v1", results: fallback });
  }
  const sectors = sector ? sectorResults(sector, demoSectorList(sector)) : [];
  const extra = everything ? previewEverything(query) : [];
  return NextResponse.json({ schemaVersion: "area-search.v1", results: [...sectors, ...searchFixtures(query), ...extra] });
}

/** The sector rows for a sector-shaped query; [] when the sector API is missing or fails. */
async function upstreamSectors(code: string, request: NextRequest): Promise<SearchResult[]> {
  const upstream = await fetchEvidence<unknown>(`/api/v1/sectors?q=${encodeURIComponent(code)}`, request);
  return upstream.status === 200 ? sectorResults(code, readSectorList(upstream.body)) : [];
}

function toSearchResult(result: UpstreamSearchResult): SearchResult {
  // A state school opens its own page; an independent school, a station or a park opens the map there (its LSOA).
  const own = result.urn ?? result.stationId ?? result.placeId;
  return {
    id: own ? `${result.kind}:${own}` : result.addressId ?? result.geographyId,
    ...(result.kind ? { kind: result.kind } : {}),
    label: result.label,
    secondaryLabel: result.secondaryLabel,
    geographyId: result.geographyId,
    uprn: result.uprn,
    addressId: result.addressId ?? null,
    center: result.center,
    ...(result.kind === "school" && result.urn && !result.independent ? { href: `/school/${result.urn}` } : {}),
    // A full postcode with no recorded home: its own page, not the LSOA it sits in.
    ...(result.kind === "postcode" ? { href: `/postcode/${postcodeSlug(result.label)}` } : {}),
    ...(result.street ? { street: result.street } : {}),
  };
}

const MODE_WORDS: Record<string, string> = {
  tube: "Tube", "elizabeth-line": "Elizabeth line", dlr: "DLR", overground: "Overground", tram: "Tram", "national-rail": "Rail",
};
const PREVIEW_KIND_LIMIT = 3;

/** Preview mode's schools and stations for ?scope=all, as the API's scope=all rows look. */
function previewEverything(query: string): SearchResult[] {
  const schools = query.trim().length < 3 ? [] : searchSchools(query).slice(0, PREVIEW_KIND_LIMIT).map((school): SearchResult => {
    const center: [number, number] = [school.longitude, school.latitude];
    return {
      id: `school:${school.urn}`, kind: "school", label: school.name, secondaryLabel: capitalise(school.phase),
      geographyId: nearestPreviewLsoa(center), uprn: null, addressId: null, center, href: `/school/${school.urn}`,
    };
  });
  const stations = searchPreviewStations(query).slice(0, PREVIEW_KIND_LIMIT).map((station): SearchResult => ({
    id: `station:${station.stationId}`, kind: "station", label: station.name,
    secondaryLabel: (station.lines.length ? station.lines.map((line) => line.name) : station.modes.map((mode) => MODE_WORDS[mode] ?? mode)).join(" · "),
    geographyId: nearestPreviewLsoa(station.center), uprn: null, addressId: null, center: station.center,
  }));
  return [...schools, ...stations];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The preview LSOA whose search point is nearest: preview mode has no boundaries to test a point against. */
function nearestPreviewLsoa([lon, lat]: [number, number]): GeographyId {
  const lsoas = SEARCH_RESULTS.filter((result) => result.geographyId.startsWith("uk:lsoa:"));
  const distance = (result: SearchResult) => (result.center[0] - lon) ** 2 + (result.center[1] - lat) ** 2;
  return lsoas.reduce((best, result) => (distance(result) < distance(best) ? result : best)).geographyId;
}
