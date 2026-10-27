import type { PlacePreference, PreferenceProfile } from "@/lib/contracts";
import { searchItems } from "@/lib/match-search";

/** area-commute.v1: door-to-door minutes from one area to the household's pinned places. */
export type CommuteMode = "transit" | "cycle" | "walk" | "car";

export interface PlaceCommute {
  placeId: string;
  label: string;
  hub: { id: string; name: string; walkFromHubMinutes: number; location?: [number, number] } | null;
  /** minutes null: over the routing matrix's cap (capped, capMinutes) or the place is outside London (reason). */
  modes: Partial<Record<CommuteMode, { minutes: number | null; range: [number, number] | null; capped?: boolean; capMinutes?: number }>>;
  /** No commute hub near the place: the straight-line minutes My match scores it with, not a route. */
  estimate?: boolean;
  /** The pin is outside Greater London, which the routing covers: no minutes. */
  reason?: "outside-london";
  /** A kind of place with nothing found: how far around the area was searched. */
  searchedRadiusM?: number;
  /** Typical transit routes from the area's neighbourhood (MSOA centre), fastest first. */
  routes?: CommuteRoute[];
  /** Kinds of place (a brand, a sport, a top-school rule): the nearest match and what is close instead. */
  nearest?: { name: string | null; metres: number; rank?: number | null } | null;
  alternatives?: { label: string; name?: string | null; metres: number }[];
  /** Street lines from the area's neighbourhood (MSOA centre) to the hub, by bike and by car. */
  paths?: Partial<Record<"cycle" | "car", { km: number; coordinates: [number, number][] }>>;
}

export interface CommuteRoute {
  totalMinutes: number;
  transfers: number;
  walkingMinutes: number;
  legs: {
    mode: string; line: string | null; from: string | null; to: string | null; minutes: number; waitMinutes: number;
    /** The leg's shape for the map ([lon, lat]), when the release has drawn routes. */
    coordinates?: [number, number][];
  }[];
}

export interface AreaCommute {
  schemaVersion: "area-commute.v1";
  geographyId: string;
  network: { id: string } | null;
  places: PlaceCommute[];
  caveats: string[];
}

const MODE_WORDS: Record<CommuteMode, string> = {
  transit: "by public transport", cycle: "by bike", walk: "walking", car: "by car in morning traffic",
};

/** Only pinned places are routed; categories ("nearest park") stay local estimates. */
export function routablePlaces(places: readonly PlacePreference[] | undefined): PlacePreference[] {
  return (places ?? []).filter((place) => place.target.kind === "point");
}

/**
 * The household's places in their search order: My match's priority, so the #1 place leads every list. A place
 * the list does not know yet (an old profile) follows in its saved order.
 */
export function placesByPriority(profile: PreferenceProfile): PlacePreference[] {
  const order = searchItems(profile).flatMap((item) => (item.criterion.kind === "place" ? [item.criterion.id] : []));
  const at = (place: PlacePreference) => { const index = order.indexOf(place.id); return index < 0 ? order.length : index; };
  return [...(profile.places ?? [])].sort((a, b) => at(a) - at(b));
}

/** "M&S Simply Food · 27 min walk" / "Woodford County High · #10 in London · 31 min walk" for a kind of place. */
export function nearestLine(entry: PlaceCommute | undefined, mode: string): string | null {
  if (!entry?.nearest) return null;
  const local = mode === "cycle" || mode === "car" ? mode : "walk";
  const minutes = entry.modes[local]?.minutes;
  const rank = entry.nearest.rank ? `#${entry.nearest.rank} in London` : null;
  return [entry.nearest.name ?? "Nearest", rank, minutes != null ? `${minutes} min ${LOCAL_WORDS[local]}` : null]
    .filter(Boolean).join(" · ");
}

const LOCAL_WORDS = { walk: "walk", cycle: "by bike", car: "by car" } as const;
const SHORT_WORDS: Record<CommuteMode, string> = { transit: "transit", cycle: "bike", car: "car", walk: "walk" };

/** Every mode the commute response has, the chosen one first: "21 min transit · 26 bike · 30 car · 64 walk". */
export function modeMinutes(entry: PlaceCommute | undefined, preferred: string): string | null {
  // The nearest of a kind is walked unless cycled or driven (as scored), so walk leads for transit.
  const first = entry?.nearest && preferred !== "cycle" && preferred !== "car" ? "walk" : preferred;
  const order: CommuteMode[] = ["transit", "cycle", "car", "walk"];
  const parts = order.sort((a, b) => Number(b === first) - Number(a === first))
    .flatMap((mode) => entry?.modes[mode]?.minutes != null ? [{ mode, minutes: entry.modes[mode]!.minutes! }] : []);
  if (!parts.length) return null;
  return parts.map((part, index) => `${part.minutes}${index === 0 ? " min" : ""} ${SHORT_WORDS[part.mode]}`).join(" · ");
}

/** "Any supermarket 6 min · Tesco 12 min" — what is close instead, walking at the estimate's pace. */
export function alternativesLine(entry: PlaceCommute | undefined): string | null {
  const items = entry?.alternatives ?? [];
  if (!items.length) return null;
  return items.map((item) => `${item.label} ${Math.max(1, Math.round(item.metres / 1000 * 1.3 / 4.8 * 60))} min`).join(" · ");
}

/** "21 min by public transport (17–26) · 24 min by bike (22–27)", the chosen mode first; null when not routed. */
export function commuteLine(routed: PlaceCommute | undefined, preferred: string): string | null {
  if (!routed?.hub) return null;
  const order = (Object.keys(MODE_WORDS) as CommuteMode[]).sort((a, b) => Number(b === preferred) - Number(a === preferred));
  const parts = order.flatMap((mode) => {
    const value = routed.modes[mode];
    if (!value) return [];
    if (value.minutes === null || value.range === null) {
      return value.capped ? [`over ${value.capMinutes ?? 120} min ${MODE_WORDS[mode]}`] : [];
    }
    const [low, high] = value.range;
    const range = mode === "car" && high > low ? ` (${low} with no traffic)`
      : mode !== "walk" && high > low ? ` (${low}–${high})` : "";
    return [`${value.minutes} min ${MODE_WORDS[mode]}${range}`];
  });
  return parts.length ? parts.join(" · ") : null;
}

export function viaHub(routed: PlaceCommute | undefined): string | null {
  if (!routed?.hub) return null;
  const walk = routed.hub.walkFromHubMinutes;
  return `via ${routed.hub.name}${walk > 0 ? ` + ${walk} min walk` : ""}`;
}

/** "Victoria from Walthamstow Central, no changes" — the fastest typical route, or null. */
export function routeLine(routed: PlaceCommute | undefined): string | null {
  const route = routed?.routes?.[0];
  const rides = route?.legs.filter((leg) => leg.mode !== "walk") ?? [];
  if (!route || !rides.length) return null;
  const lines = rides.map((leg) => leg.line ?? leg.mode).join(" → ");
  const changes = route.transfers === 0 ? "no changes" : `${route.transfers} change${route.transfers > 1 ? "s" : ""}`;
  return `${lines}${rides[0].from ? ` from ${rides[0].from}` : ""}, ${changes}`;
}

export type RouteShape = { kind: "route" | "walk"; mode: CommuteMode; coordinates: [number, number][] };

/**
 * The street or rail shapes to draw for a place in one mode: the fastest transit route's legs
 * (walks dashed), or the bike / car line from the area's neighbourhood to the hub. Empty when the
 * release has no shape for that mode (never a straight line instead).
 */
export function routeShapes(routed: PlaceCommute | undefined, mode: CommuteMode): RouteShape[] {
  if (mode === "transit") {
    return (routed?.routes?.[0]?.legs ?? []).flatMap((leg) => leg.coordinates && leg.coordinates.length > 1
      ? [{ kind: leg.mode === "walk" ? "walk" as const : "route" as const, mode, coordinates: leg.coordinates }] : []);
  }
  const path = mode === "cycle" || mode === "car" ? routed?.paths?.[mode] : undefined;
  return path && path.coordinates.length > 1 ? [{ kind: "route", mode, coordinates: path.coordinates }] : [];
}

/** Modes a place's route can be redrawn in on the map, the chosen one first. */
export function drawableModes(routed: PlaceCommute | undefined, preferred: string): CommuteMode[] {
  const order: CommuteMode[] = ["transit", "cycle", "car", "walk"];
  return order.sort((a, b) => Number(b === preferred) - Number(a === preferred))
    .filter((mode) => routeShapes(routed, mode).length > 0);
}
