"use client";

import { useEffect, useState } from "react";

import type { AreaCommute } from "@/lib/commute";
import type { GeographyId, PreferenceProfile } from "@/lib/contracts";

// One request per area and set of places, shared by the panel and the map (both ask at once).
const pending = new Map<string, Promise<AreaCommute | null>>();

/** Door-to-door minutes and route lines to the pinned places from this area (POST: places are exact). */
export function useAreaCommute(areaId: GeographyId | null, profile: PreferenceProfile): AreaCommute | null {
  const [commute, setCommute] = useState<AreaCommute | null>(null);
  const places = profile.places ?? [];
  const body = areaId && places.length ? JSON.stringify({ areaId, places }) : null;
  useEffect(() => {
    setCommute(null);
    if (!body) return;
    let live = true;
    if (!pending.has(body)) {
      pending.set(body, fetch("/api/v1/commute", { method: "POST", body,
        headers: { accept: "application/json", "content-type": "application/json" } })
        .then(async (response) => (response.ok ? (await response.json()) as AreaCommute : null))
        .catch(() => null));
      if (pending.size > 20) pending.delete(pending.keys().next().value!);
    }
    void pending.get(body)!.then((value) => { if (live) setCommute(value); });
    return () => { live = false; };
  }, [body]);
  return commute;
}
