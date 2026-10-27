"use client";

import { useEffect, useState } from "react";

import { addressLabel } from "@/lib/place-kinds";

export interface PlaceOption { key: string; text: string; label: string; latitude: number; longitude: number }

/** Stations and addresses for a typed place ("King's Cross", "N5 1AA"): four of each, debounced. */
export function usePlaceOptions(query: string): PlaceOption[] {
  const [options, setOptions] = useState<PlaceOption[]>([]);
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
        fetchJson<{ results: { stationId: string; name: string; center: [number, number] }[] }>(`/api/v1/stations?q=${encoded}`, controller.signal),
        fetchJson<{ results: { geographyId: string; addressId?: string | null; label: string; center?: [number, number] | null }[] }>(`/api/v1/search?q=${encoded}`, controller.signal),
      ]).then(([stations, found]) => {
        if (controller.signal.aborted) return;
        const fromStations = (stations?.results ?? []).slice(0, 4).map((station) => ({
          key: station.stationId, text: `Station: ${station.name}`, label: station.name,
          longitude: station.center[0], latitude: station.center[1] }));
        const fromSearch = (found?.results ?? []).filter((row) => row.center).slice(0, 4).map((row) => ({
          key: row.addressId ?? row.geographyId, text: row.label, label: addressLabel(row.label),
          longitude: row.center![0], latitude: row.center![1] }));
        setOptions([...fromStations, ...fromSearch]);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return options;
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { signal });
    return response.ok ? (await response.json()) as T : null;
  } catch {
    return null;
  }
}
