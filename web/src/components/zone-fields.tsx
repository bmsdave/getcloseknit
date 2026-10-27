"use client";

import { useEffect, useState } from "react";

import type { GeographyId, MatchZone, StationSearchResponse } from "@/lib/contracts";

interface ZoneOption {
  key: string;
  text: string;
  zone: MatchZone;
}

interface AreaSearchResult {
  geographyId: GeographyId;
  label: string;
  addressId?: string | null;
}

/** Stations, boroughs and neighbourhoods for a typed name (My match › Where › + Add), debounced. */
export function useZoneOptions(query: string): ZoneOption[] {
  const [options, setOptions] = useState<ZoneOption[]>([]);
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const encoded = encodeURIComponent(needle);
      void Promise.all([
        fetchJson<StationSearchResponse>(`/api/v1/stations?q=${encoded}`, controller.signal),
        fetchJson<{ results: AreaSearchResult[] }>(`/api/v1/search?q=${encoded}`, controller.signal),
      ]).then(([stations, areas]) => {
        if (!controller.signal.aborted) setOptions([...stationOptions(stations), ...areaOptions(areas)]);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return options;
}

function stationOptions(payload: StationSearchResponse | null): ZoneOption[] {
  return (payload?.results ?? []).map((station) => ({
    key: `station:${station.stationId}`,
    text: `Station: ${station.name}`,
    zone: { kind: "station", stationId: station.stationId, maxWalkMinutes: 10, label: station.name },
  }));
}

function areaOptions(payload: { results: AreaSearchResult[] } | null): ZoneOption[] {
  return (payload?.results ?? []).flatMap((area): ZoneOption[] => {
    if (area.addressId) return [];
    if (area.geographyId.startsWith("uk:lad:")) {
      return [{ key: area.geographyId, text: `Borough: ${area.label}`, zone: { kind: "borough", id: area.geographyId, label: area.label } }];
    }
    if (area.geographyId.startsWith("uk:lsoa:")) {
      return [{ key: area.geographyId, text: `Neighbourhood: ${area.label}`, zone: { kind: "lsoas", ids: [area.geographyId] } }];
    }
    return [];
  });
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { signal });
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
}
