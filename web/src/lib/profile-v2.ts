/**
 * preference-profile.v2 links and the bridge to the current panel.
 *
 * `#profile=v3.` carries a v2 profile (the ordered criteria) as a compact object, byte for byte as
 * api/area_api/share_links.py (_pack_v2) writes it; contracts/fixtures/agent-share-links.json pins both:
 *   {"m": 0 buy | 1 rent, "t": targetBudget, "x": maximumBudget, "b": bedrooms?, "c": [criterion…],
 *    "k": propertyType?, "h": houseTypes?, "l": liked?, "e": excluded?, "n": [[id, note]]?}
 *   criterion: ["b", must] | ["r", layer, 0 value | 1 percentile, min, max, softMin, softMax, must]
 *   | ["p", id, label, target, mode index, targetMinutes, softMinutes, must, when index]
 *   | ["w", [zone…], softMetres, must] | ["c", criterion, 0 higher | 1 lower, must]
 *
 * `toPanelProfile` is the thin adapter that keeps the current (v1) panel working on a v2 search until the panel
 * rewrite: the order becomes importance dots (5, 4, 3 … then 1), a Must stays Must. What v1 cannot hold is
 * counted as skipped (a percentile range on a layer that is not a wizard factor).
 */
import {
  assertMatchCriterion, canonicalAreaIds, assertPreferenceProfileV2, PLACE_MODES, PLACE_WHENS, type GeographyId, type MatchCriterion,
  type MatchZone, type PlaceTarget, type PreferenceProfile, type PreferenceProfileV2,
} from "./contracts";
import { CUSTOM_SET_IDS, MAX_CUSTOM, type CustomCriterion, type CustomTagValue } from "./custom-criteria";
import { DEFAULT_PROFILE } from "./fixtures";
import { withCriteria } from "./match-search";

export const V3_PREFIX = "#profile=v3.";

type Packed = Record<string, unknown>;

/** `#profile=v3.` + the compact v2 object (encode_profile_v2 in share_links.py). */
export function encodeProfileLinkV3(profile: PreferenceProfileV2): string {
  const bytes = new TextEncoder().encode(JSON.stringify(packV2(assertPreferenceProfileV2(profile))));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${V3_PREFIX}${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

/** The compact value behind any `#profile=` fragment (anything after "&" is not the profile); throws when unreadable. */
export function fragmentValue(fragment: string, prefix: string): unknown {
  const body = fragment.slice(prefix.length).split("&")[0];
  const standard = body.replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Uint8Array.from(atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
  // A link from before step R2 names LADs uk:borough:<code>: read as the current ids.
  return canonicalAreaIds(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
}

function packV2(profile: PreferenceProfileV2): Packed {
  const packed: Packed = { m: profile.market === "buy" ? 0 : 1, t: profile.targetBudget, x: profile.maximumBudget };
  if (profile.bedrooms !== undefined) packed.b = profile.bedrooms;
  packed.c = profile.criteria.map(packCriterion);
  if (profile.propertyType === "house" || profile.propertyType === "flat") packed.k = profile.propertyType;
  if (profile.houseTypes?.length) packed.h = [...profile.houseTypes];
  const marks = profile.marks;
  if (marks?.liked.length) packed.l = [...marks.liked];
  if (marks?.excluded.length) packed.e = [...marks.excluded];
  const notes = Object.entries(marks?.notes ?? {});
  if (notes.length) packed.n = notes;
  return packed;
}

function packCriterion(item: MatchCriterion): unknown[] {
  const must = item.must ? 1 : 0;
  if (item.kind === "budget") return ["b", must];
  if (item.kind === "range") {
    return ["r", item.layer, item.scale === "percentile" ? 1 : 0, item.min ?? null, item.max ?? null, item.softMin ?? null, item.softMax ?? null, must];
  }
  if (item.kind === "place") {
    return ["p", item.id, item.label, packTarget(item.target), PLACE_MODES.indexOf(item.mode), item.targetMinutes, item.softMinutes ?? null, must,
      item.when !== undefined ? PLACE_WHENS.indexOf(item.when) : null];
  }
  if (item.kind === "where") return ["w", item.zones.map(packZone), item.softMetres ?? null, must];
  return ["c", packCustomCriterion(item.criterion), item.direction === "higher" ? 0 : 1, must];
}

function packTarget(target: PlaceTarget): unknown[] {
  if (target.kind === "point") return [0, target.latitude, target.longitude];
  if (target.kind === "category") return [1, target.category, target.brand ?? null, target.sport ?? null];
  if (target.kind === "school") return [2, target.phase, target.top, target.rankBy ?? null];
  if (target.kind === "school-filter") return [4, target.filter, target.within ?? null];
  return [3, target.points];
}

function packZone(zone: MatchZone): unknown[] {
  const label = zone.label === undefined ? [] : [zone.label];
  if (zone.kind === "station") return [0, zone.stationId, zone.maxWalkMinutes, ...label];
  if (zone.kind === "borough") return [1, zone.id, ...label];
  if (zone.kind === "polygon") return [3, zone.points, ...label];
  return [2, zone.ids, ...label];
}

function packCustomCriterion(criterion: CustomCriterion): unknown[] {
  const sets = CUSTOM_SET_IDS.flatMap((id) => {
    const set = criterion.sets[id];
    return set ? [[id, set.label, set.any.map((matcher) => Object.entries(matcher))]] : [];
  });
  return [criterion.id, criterion.label, criterion.formula, criterion.radiusMetres, sets];
}

/** A v3 link's profile, criterion by criterion: unreadable or invalid criteria are dropped and counted. */
export function unpackV2Lenient(value: unknown): { profile: PreferenceProfileV2 | null; skipped: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { profile: null, skipped: 0 };
  const packed = value as Record<string, unknown>;
  const base: PreferenceProfileV2 = {
    schemaVersion: "preference-profile.v2", market: packed.m === 1 ? "rent" : "buy",
    targetBudget: packed.t as number, maximumBudget: packed.x as number, criteria: [],
  };
  try {
    assertPreferenceProfileV2(base);
  } catch {
    return { profile: null, skipped: Array.isArray(packed.c) ? packed.c.length : 0 };
  }
  let skipped = 0;
  const keep = <T>(read: () => T, check: (value: T) => void): T | undefined => {
    try {
      const out = read();
      check(out);
      return out;
    } catch {
      skipped += 1;
      return undefined;
    }
  };
  if (packed.b !== undefined) {
    const bedrooms = keep(() => packed.b as number, (count) => { if (!Number.isInteger(count) || count < 0 || count > 8) throw new Error("bedrooms"); });
    if (bedrooms !== undefined) base.bedrooms = bedrooms;
  }
  const ids = new Set<string>();
  for (const raw of Array.isArray(packed.c) ? packed.c : []) {
    const item = keep(() => unpackCriterion(raw as unknown[]), (criterion) => {
      assertMatchCriterion(criterion);
      const id = criterionKey(criterion);
      if (ids.has(id)) throw new Error("duplicate");
      ids.add(id);
    });
    if (item) base.criteria.push(item);
  }
  if (packed.k === "house" || packed.k === "flat") base.propertyType = packed.k;
  const houseTypes = keep(() => packed.h as PreferenceProfileV2["houseTypes"], (types) => assertPreferenceProfileV2({ ...base, houseTypes: types }));
  if (houseTypes?.length) base.houseTypes = houseTypes;
  if (packed.l || packed.e || packed.n) {
    const marks = keep(() => ({ liked: (packed.l ?? []) as GeographyId[], excluded: (packed.e ?? []) as GeographyId[],
      notes: Object.fromEntries((packed.n ?? []) as [string, string][]) }), (value) => assertPreferenceProfileV2({ ...base, marks: value }));
    if (marks) base.marks = marks;
  }
  try {
    return { profile: assertPreferenceProfileV2(base), skipped };
  } catch {
    // Too many of one kind (two budgets, nine places): keep the first of each.
    base.criteria = base.criteria.filter((item, index, all) => (item.kind !== "budget" && item.kind !== "where")
      || all.findIndex((other) => other.kind === item.kind) === index);
    return { profile: assertPreferenceProfileV2(base), skipped: skipped + 1 };
  }
}

function criterionKey(item: MatchCriterion): string {
  if (item.kind === "budget") return "affordability";
  if (item.kind === "range") return `range:${item.layer}`;
  if (item.kind === "place") return `place:${item.id}`;
  if (item.kind === "where") return "zone";
  return `custom:${item.criterion.id}`;
}

function unpackCriterion(item: unknown[]): MatchCriterion {
  const must = item[item[0] === "b" ? 1 : item[0] === "r" ? 7 : item[0] === "p" ? 7 : 3] === 1;
  if (item[0] === "b") return { kind: "budget", must };
  if (item[0] === "r") {
    return { kind: "range", layer: item[1] as string, scale: item[2] === 1 ? "percentile" : "value", min: item[3] as number | null,
      max: item[4] as number | null, softMin: item[5] as number | null, softMax: item[6] as number | null, must };
  }
  if (item[0] === "p") {
    const when = item[8];
    return {
      kind: "place", id: item[1] as string, label: item[2] as string, target: unpackTarget(item[3] as unknown[]),
      mode: PLACE_MODES[item[4] as number], targetMinutes: item[5] as number,
      ...(item[6] !== null && item[6] !== undefined ? { softMinutes: item[6] as number } : {}), must,
      ...(when !== null && when !== undefined ? { when: PLACE_WHENS[when as number] } : {}),
    } as MatchCriterion;
  }
  if (item[0] === "w") {
    return { kind: "where", zones: (item[1] as unknown[][]).map(unpackZone), ...(item[2] !== null ? { softMetres: item[2] as number } : {}), must };
  }
  if (item[0] === "c") {
    const [id, label, formula, radiusMetres, sets] = item[1] as [string, string, CustomCriterion["formula"], number, [string, string, [string, CustomTagValue][][]][]];
    const unpacked = Object.fromEntries(sets.map(([setId, setLabel, matchers]) => [setId, {
      label: setLabel, any: matchers.map((matcher) => Object.fromEntries(matcher)),
    }])) as CustomCriterion["sets"];
    return { kind: "custom", criterion: { id, label, sets: unpacked, formula, radiusMetres }, direction: item[2] === 0 ? "higher" : "lower", must };
  }
  throw new Error("unknown criterion kind");
}

function unpackTarget(value: unknown[]): PlaceTarget {
  if (value[0] === 0) return { kind: "point", latitude: value[1] as number, longitude: value[2] as number };
  if (value[0] === 1) {
    return { kind: "category", category: value[1] as never, ...(value[2] ? { brand: value[2] as string } : {}), ...(value[3] ? { sport: value[3] as string } : {}) };
  }
  if (value[0] === 2) return { kind: "school", phase: value[1] as never, top: value[2] as number, ...(value[3] ? { rankBy: value[3] as never } : {}) };
  if (value[0] === 3) return { kind: "any-of", points: value[1] as [number, number][] };
  if (value[0] === 4) return { kind: "school-filter", filter: value[1] as string, ...(value[2] !== null && value[2] !== undefined ? { within: value[2] as number } : {}) };
  throw new Error("unknown place target");
}

function unpackZone(value: unknown[]): MatchZone {
  const label = (text: unknown) => (text === undefined ? {} : { label: text as string });
  if (value[0] === 0) return { kind: "station", stationId: value[1] as string, maxWalkMinutes: value[2] as number, ...label(value[3]) };
  if (value[0] === 1) return { kind: "borough", id: value[1] as GeographyId, ...label(value[2]) };
  if (value[0] === 3) return { kind: "polygon", points: value[1] as [number, number][], ...label(value[2]) };
  if (value[0] === 2) return { kind: "lsoas", ids: value[1] as GeographyId[], ...label(value[2]) };
  throw new Error("unknown zone");
}

// ---- v2 → the panel's saved profile ------------------------------------------------------------------

/**
 * A v2 search as the household's saved profile (v1 with the ordered list kept in it, lib/match-search.ts): the order,
 * Musts, soft edges, places' own soft edges and the Where card come through as they are. What a saved profile cannot
 * hold (more own criteria than MAX_CUSTOM) is skipped and counted.
 */
export function toPanelProfile(v2: PreferenceProfileV2): { profile: PreferenceProfile; skipped: number } {
  const base: PreferenceProfile = structuredClone({
    ...DEFAULT_PROFILE,
    market: v2.market, targetBudget: v2.targetBudget, maximumBudget: v2.maximumBudget, bedrooms: v2.bedrooms ?? DEFAULT_PROFILE.bedrooms,
  });
  if (v2.propertyType) base.propertyType = v2.propertyType;
  if (v2.houseTypes?.length) base.houseTypes = [...v2.houseTypes];
  if (v2.marks) base.marks = structuredClone(v2.marks);
  let custom = 0;
  const kept = v2.criteria.filter((item) => item.kind !== "custom" || (custom += 1) <= MAX_CUSTOM);
  return { profile: withCriteria(base, structuredClone(kept)), skipped: v2.criteria.length - kept.length };
}
