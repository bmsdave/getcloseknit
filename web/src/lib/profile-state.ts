import {
  canonicalAreaIds,
  assertPreferenceProfile,
  FACTOR_IDS,
  type CommuteDestination,
  type GeographyId,
  type HouseType,
  type MatchZone,
  type PlaceCategory,
  type PlaceTarget,
  type SchoolPhase,
  type SchoolRanking,
  type PlacePreference,
  PLACE_MODES,
  PLACE_WHENS,
  type PreferenceDirection,
  type PreferenceProfile,
} from "./contracts";
import { CUSTOM_SET_IDS, type CustomCriterion, type CustomFormula, type CustomPreference, type CustomSetId, type CustomTagValue } from "./custom-criteria";
import { DEFAULT_PROFILE, RETIRED_FACTOR_IDS } from "./fixtures";
import { withCurrentLevels } from "./priority-levels";
import { encodeProfileLinkV3, fragmentValue, toPanelProfile, unpackV2Lenient, V3_PREFIX } from "./profile-v2";
import { contractProfile } from "./match-model";
import { MATCH_CHIPS } from "./match-ranges";
import { budgetFromMaximum, withCriteria } from "./match-search";
import { describeZone } from "./zones";
import { DEFAULT_SCHOOL_FILTER, describeSchoolFilter, parseSchoolFilter } from "./school-filter";

const STORAGE_KEY = "close-knit.preference-profile.v1";
export const PROFILE_STORAGE_KEY = STORAGE_KEY;
const WIZARD_STAGE_KEY = "close-knit.preference-wizard-stage.v1";
export const WIZARD_STAGE_STORAGE_KEY = WIZARD_STAGE_KEY;
const FRAGMENT_PREFIX = "#profile=v1.";
// The site's own Share link: the v1 array with defaults left out (zero-weight factors, the default
// school settings, trailing null limits), so a typical link stays short. Readers accept both.
const COMPACT_PREFIX = "#profile=v2.";
// "&compare=E01000002.E01000003" after the profile: the sender's compared areas (London LSOA codes).
const COMPARE_PARAM = "&compare=";
// Display preferences live under their own key, outside PreferenceProfile,
// so the profile contract and shared-link encoding stay unchanged.
const DISPLAY_PREFS_KEY = "close-knit.display-prefs.v1";
export const DISPLAY_PREFS_STORAGE_KEY = DISPLAY_PREFS_KEY;

export type AreaUnit = "sqm" | "sqft";

export interface DisplayPrefs {
  areaUnit: AreaUnit;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = { areaUnit: "sqm" };

// "1" while the saved profile holds only Tailor answers on top of the default search: the search
// itself is still unset (no budget of the household's own), until Find my area saves it.
const TAILOR_ONLY_KEY = "close-knit.tailor-only.v1";
const TAILOR_ONLY = new WeakSet<PreferenceProfile>();

export function loadLocalProfile(fallback: PreferenceProfile): PreferenceProfile {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const profile = withCurrentLevels(withoutRetiredFactors(assertPreferenceProfile(canonicalAreaIds(JSON.parse(stored)) as PreferenceProfile)));
    if (window.localStorage.getItem(TAILOR_ONLY_KEY) === "1") TAILOR_ONLY.add(profile);
    return profile;
  } catch {
    return fallback;
  }
}

/**
 * Saved and shared profiles from before the people criteria were retired (household income, social
 * renting) lose them on load: areas are matched on places, never on who lives there. Deprivation, the
 * official decile, is a criterion again and stays.
 */
export function withoutRetiredFactors(profile: PreferenceProfile): PreferenceProfile {
  const factors = profile.factors.filter((factor) => !RETIRED_FACTOR_IDS.includes(factor.factorId));
  if (factors.length === profile.factors.length) return profile;
  return { ...profile, factors: factors.length ? factors : DEFAULT_PROFILE.factors };
}

/**
 * Nothing saved or submitted yet: the profile is the default itself (a first visit, or just erased),
 * or only Tailor answers were saved on top of it. Identity, not content: a search someone submitted
 * stays theirs even when it happens to match the defaults (a £650,000 budget with every priority Off).
 */
export function isUnsetProfile(profile: PreferenceProfile): boolean {
  return profile === DEFAULT_PROFILE || TAILOR_ONLY.has(profile);
}

export function saveLocalProfile(profile: PreferenceProfile): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    window.localStorage.removeItem(TAILOR_ONLY_KEY);
  } catch {
    return;
  }
}

/** Said on window when the Tailor card saves, so every open view (the map's search too) reads the profile afresh. */
export const PROFILE_SAVED_EVENT = "close-knit:profile-saved";

/**
 * Saves a profile changed outside the map's search (the Tailor card) and tells open views. A profile
 * that is the default again is erased, so tailoring and resetting leaves no saved search behind.
 */
export function saveTailoredProfile(profile: PreferenceProfile, searchUnset: boolean): void {
  const answered = Boolean(profile.household) || Boolean(profile.lifestyle?.length);
  if (!answered && JSON.stringify(matchRequestProfile(profile)) === JSON.stringify(DEFAULT_PROFILE)) eraseLocalProfile();
  else {
    saveLocalProfile(profile);
    // Tailor on an unset search leaves it unset: no default budget is ever shown as the household's own.
    try {
      if (searchUnset) window.localStorage.setItem(TAILOR_ONLY_KEY, "1");
    } catch {
      // Storage refused: the answers above are saved or not, as for every profile write.
    }
  }
  window.dispatchEvent(new Event(PROFILE_SAVED_EVENT));
}

/** What a match request sends: the Tailor answers (household, lifestyle) stay on this device. */
export function matchRequestProfile(profile: PreferenceProfile): PreferenceProfile {
  const { household, lifestyle, ...rest } = profile;
  void household;
  void lifestyle;
  return rest;
}

export function loadWizardStage(fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.sessionStorage.getItem(WIZARD_STAGE_KEY);
    if (stored === null) return fallback;
    const stage = Number(stored);
    return Number.isInteger(stage) && stage >= 1 ? stage : fallback;
  } catch {
    return fallback;
  }
}

export function saveWizardStage(stage: number): void {
  try {
    window.sessionStorage.setItem(WIZARD_STAGE_KEY, String(stage));
  } catch {
    return;
  }
}

export function loadDisplayPrefs(): DisplayPrefs {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_PREFS;
  try {
    const stored = window.localStorage.getItem(DISPLAY_PREFS_KEY);
    if (stored === null) return DEFAULT_DISPLAY_PREFS;
    const parsed = JSON.parse(stored) as Partial<DisplayPrefs>;
    return { areaUnit: parsed.areaUnit === "sqft" ? "sqft" : "sqm" };
  } catch {
    return DEFAULT_DISPLAY_PREFS;
  }
}

export function saveDisplayPrefs(prefs: DisplayPrefs): void {
  try {
    window.localStorage.setItem(DISPLAY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    return;
  }
}

export function eraseLocalProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(TAILOR_ONLY_KEY);
    window.sessionStorage.removeItem(WIZARD_STAGE_KEY);
  } catch {
    return;
  }
}

export function sensitiveFieldPreview(profile: PreferenceProfile): string[] {
  const preview = [
    `Budget up to £${profile.maximumBudget.toLocaleString("en-GB")}`,
    ...profile.commuteDestinations.map((destination) => `Commute destination ${destination.label} (exact location shared)`),
  ];
  if (profile.school.shortlistUrns.length > 0) {
    preview.push(`${profile.school.shortlistUrns.length} named school shortlist entries`);
  }
  for (const zone of profile.zones ?? []) preview.push(`Zone: ${describeZone(zone)}`);
  for (const place of profile.places ?? []) {
    preview.push(place.target.kind === "point" || place.target.kind === "any-of"
      ? `Place ${place.label} (exact location shared)`
      : place.target.kind === "school"
        ? `Place: near a top-${place.target.top} ${place.target.phase} school${place.target.rankBy === "progress8" ? " by Progress 8" : ""}`
        : place.target.kind === "school-filter"
          ? `Place: near a school like this (${describeSchoolFilter(parseSchoolFilter(place.target.filter) ?? DEFAULT_SCHOOL_FILTER)})`
        : `Place: nearest ${place.target.brand ?? place.target.sport ?? ""} ${place.target.category.replaceAll("_", " ")}`.replace("  ", " "));
  }
  const marks = profile.marks;
  if (marks?.liked.length) preview.push(`${marks.liked.length} areas you liked`);
  if (marks?.excluded.length) preview.push(`${marks.excluded.length} areas you ruled out`);
  const notes = Object.keys(marks?.notes ?? {}).length;
  if (notes) preview.push(`${notes} private ${notes === 1 ? "note" : "notes"} (shared with the link)`);
  return preview;
}

export function encodeSharedProfile(profile: PreferenceProfile): string {
  const bytes = new TextEncoder().encode(JSON.stringify(packProfile(assertPreferenceProfile(profile))));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${FRAGMENT_PREFIX}${toBase64Url(btoa(binary))}`;
}

export function decodeSharedProfile(fragment: string): PreferenceProfile | null {
  if (fragment.startsWith(V3_PREFIX)) {
    // A v2 search (ordered criteria) opens in the current panel through the thin adapter.
    try {
      const { profile, skipped } = unpackV2Lenient(fragmentValue(fragment, V3_PREFIX));
      return profile && !skipped ? toPanelProfile(profile).profile : null;
    } catch {
      return null;
    }
  }
  const prefix = [FRAGMENT_PREFIX, COMPACT_PREFIX].find((candidate) => fragment.startsWith(candidate));
  if (!prefix) return null;
  try {
    const body = fragment.slice(prefix.length).split("&")[0];
    const bytes = Uint8Array.from(atob(fromBase64Url(body)), (character) => character.charCodeAt(0));
    return withCurrentLevels(withoutRetiredFactors(assertPreferenceProfile(unpackProfile(canonicalAreaIds(JSON.parse(new TextDecoder().decode(bytes))) as CompactProfile))));
  } catch {
    return null;
  }
}

/**
 * The Share button's fragment: the search, compacted (v2), and the areas being compared. Never a
 * map position or anything else from the address. Decoded by decodeSharedProfile and sharedCompared.
 */
export function encodeShareLink(profile: PreferenceProfile, compared: readonly GeographyId[] = []): string {
  const packed = packProfile(assertPreferenceProfile(profile)) as unknown[];
  packed[5] = (packed[5] as CompactFactor[])
    .filter((factor) => factor[1] > 0 || factor[3] !== null || factor[4] !== null)
    .map((factor) => (factor[3] === null && factor[4] === null ? factor.slice(0, 3) : factor));
  if (isDefaultSchool(profile.school)) packed[7] = 0;
  const bytes = new TextEncoder().encode(JSON.stringify(packed));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const codes = compared.flatMap((id) => (/^uk:lsoa:(E\d{8})$/.exec(id)?.[1] ?? []));
  return `${COMPACT_PREFIX}${toBase64Url(btoa(binary))}${codes.length ? `${COMPARE_PARAM}${codes.join(".")}` : ""}`;
}

/**
 * My match's Share: the ordered list as `#profile=v3.` (Musts, soft edges, places' own edges, Where),
 * and the areas being compared. Tailor answers and the Kids/Drive answers never travel (contractProfile).
 */
export function encodeSearchLink(profile: PreferenceProfile, compared: readonly GeographyId[] = []): string {
  const codes = compared.flatMap((id) => (/^uk:lsoa:(E\d{8})$/.exec(id)?.[1] ?? []));
  return `${encodeProfileLinkV3(contractProfile(profile))}${codes.length ? `${COMPARE_PARAM}${codes.join(".")}` : ""}`;
}

/** The compared areas a shared link carries ("&compare=E01000002.E01000003"); [] when none. */
export function sharedCompared(fragment: string): GeographyId[] {
  const at = fragment.indexOf(COMPARE_PARAM);
  if (at < 0 || !decodeSharedProfile(fragment)) return [];
  const codes = fragment.slice(at + COMPARE_PARAM.length).split("&")[0].split(".");
  return [...new Set(codes.filter((code) => /^E\d{8}$/.test(code)))].slice(0, 4).map((code) => `uk:lsoa:${code}` as GeographyId);
}

function isDefaultSchool(school: PreferenceProfile["school"]): boolean {
  return JSON.stringify(school) === JSON.stringify(DEFAULT_PROFILE.school);
}

type CompactFactor = [number, number, number, number | null, number | null];
type CompactDestination = [string, string, number, number, number, string, number, number];
type CompactSchool = [string[], string[], [string, number][], string[], number];
// Zones: [0, stationId, maxWalkMinutes, label?] | [1, boroughId, label?] | [2, lsoaIds, label?]
// | [3, [[lat, lon], ...], label?] (drawn).
type CompactZone = [0, string, number, string?] | [1, string, string?] | [2, string[], string?] | [3, [number, number][], string?];
// Element 9 (zones) is optional and omitted when empty, so links shared before
// zones existed decode unchanged and zone-free links stay byte-identical.
type CompactProfile = [number, number, number, number, number, CompactFactor[], CompactDestination[], CompactSchool, number, CompactZone[]?, CompactExtras?];

function packProfile(profile: PreferenceProfile): CompactProfile {
  const packed: CompactProfile = [
    profile.market === "buy" ? 0 : 1,
    profile.targetBudget,
    profile.maximumBudget,
    profile.bedrooms,
    profile.forecastHorizon === "1y" ? 1 : 5,
    profile.factors.map((factor) => [
      FACTOR_IDS.indexOf(factor.factorId), factor.weight,
      ["higher", "lower", "target-range"].indexOf(factor.direction),
      factor.minimumUtility, factor.maximumUtility,
    ]),
    profile.commuteDestinations.map(packDestination),
    [profile.school.phases, profile.school.characteristics, Object.entries(profile.school.facetWeights), profile.school.shortlistUrns, profile.school.desiredSchoolCount],
    profile.analyticsConsent ? 1 : 0,
  ];
  const extras = packExtras(profile);
  if (profile.zones?.length || extras) packed.push((profile.zones ?? []).map(packZone));
  if (extras) packed.push(extras);
  return packed;
}

// Element 10 holds everything added after zones, as an object so it can keep growing; empty
// keys are left out, so a profile without places or marks encodes exactly as before.
// Mirrors share_links._pack_place: 0 point [lat, lon]; 1 kind [category, [brand, sport] | null]; 2 school rule [phase, top];
// 3 near any of [[lat, lon], ...]. Tail: element 9 the time band's index in PLACE_WHENS (null when unset),
// element 10 a school rule's ranking when not "results" (older links stop at nine).
type CompactPlace =
  | [string, string, 0, number, number, number, number, number, number, (number | null)?]
  | [string, string, 3, [number, number][], null, number, number, number, number, (number | null)?]
  | [string, string, 1, string, [string | null, string | null] | null, number, number, number, number, (number | null)?]
  | [string, string, 2, string, number, number, number, number, number, (number | null)?, SchoolRanking?]
  /** Schools filter v2: the filter's compact text and its within metres (null = none). */
  | [string, string, 4, string, number | null, number, number, number, number, (number | null)?];
interface CompactExtras {
  t?: "house" | "flat"; p?: CompactPlace[]; c?: CompactCustom[]; l?: GeographyId[]; x?: GeographyId[]; n?: [string, string][];
  /** House subtypes. */
  h?: HouseType[];
  /** Range criteria: [layer, min, max, softMin, softMax, importance], open bounds as null. */
  r?: [string, number | null, number | null, number | null, number | null, number][];
}
// Custom criteria (share_links._pack_custom): [[id, label, formula, radius, [[set id, label, [[[key, value]...] per matcher]]...]], weight, 0 higher | 1 lower].
type CompactCustom = [[string, string, CustomFormula, number, [CustomSetId, string, [string, CustomTagValue][][]][]], number, number];

function packExtras(profile: PreferenceProfile): CompactExtras | null {
  const extras: CompactExtras = {};
  if (profile.propertyType && profile.propertyType !== "any") extras.t = profile.propertyType;
  if (profile.places?.length) extras.p = profile.places.map(packPlace);
  if (profile.custom?.length) extras.c = profile.custom.map(packCustom);
  const marks = profile.marks;
  if (marks?.liked.length) extras.l = marks.liked;
  if (marks?.excluded.length) extras.x = marks.excluded;
  const notes = Object.entries(marks?.notes ?? {});
  if (notes.length) extras.n = notes;
  if (profile.houseTypes?.length) extras.h = [...profile.houseTypes];
  if (profile.ranges?.length) {
    extras.r = profile.ranges.map((range) => [range.layer, range.min, range.max, range.softMin, range.softMax, range.importance]);
  }
  return Object.keys(extras).length ? extras : null;
}

function packPlace(place: PlacePreference): CompactPlace {
  const packed = packPlaceBase(place) as unknown[];
  const ranking = place.target.kind === "school" && place.target.rankBy && place.target.rankBy !== "results" ? place.target.rankBy : null;
  const when = place.when !== undefined ? PLACE_WHENS.indexOf(place.when) : null;
  if (ranking) packed.push(when, ranking);
  else if (when !== null) packed.push(when);
  return packed as CompactPlace;
}

/** A time-band index outside PLACE_WHENS makes the link damaged, as share_links._unpack_profile does. */
function unpackWhen(index: unknown): PlacePreference["when"] {
  if (!Number.isInteger(index) || !PLACE_WHENS[index as number]) throw new Error("invalid place time band");
  return PLACE_WHENS[index as number];
}

function packPlaceBase(place: PlacePreference): CompactPlace {
  const mode = PLACE_MODES.indexOf(place.mode);
  const must = place.must ? 1 : 0;
  const target = place.target;
  if (target.kind === "point") return [place.id, place.label, 0, target.latitude, target.longitude, mode, place.targetMinutes, place.weight, must];
  if (target.kind === "school") return [place.id, place.label, 2, target.phase, target.top, mode, place.targetMinutes, place.weight, must];
  if (target.kind === "any-of") return [place.id, place.label, 3, target.points, null, mode, place.targetMinutes, place.weight, must];
  if (target.kind === "school-filter") return [place.id, place.label, 4, target.filter, target.within ?? null, mode, place.targetMinutes, place.weight, must];
  const narrow: [string | null, string | null] | null = target.brand || target.sport ? [target.brand ?? null, target.sport ?? null] : null;
  return [place.id, place.label, 1, target.category, narrow, mode, place.targetMinutes, place.weight, must];
}

function unpackTarget(value: CompactPlace): PlaceTarget {
  if (value[2] === 0) return { kind: "point", latitude: value[3], longitude: value[4] };
  if (value[2] === 2) return { kind: "school", phase: value[3] as SchoolPhase, top: value[4], ...(value[10] ? { rankBy: value[10] } : {}) };
  if (value[2] === 3) return { kind: "any-of", points: value[3] };
  if (value[2] === 4) return { kind: "school-filter", filter: value[3], ...(value[4] !== null ? { within: value[4] } : {}) };
  const [brand, sport] = Array.isArray(value[4]) ? value[4] : [null, null];
  return { kind: "category", category: value[3] as PlaceCategory, ...(brand ? { brand } : {}), ...(sport ? { sport } : {}) };
}

function unpackExtras(extras: CompactExtras | undefined): Partial<PreferenceProfile> {
  if (!extras) return {};
  const unpacked: Partial<PreferenceProfile> = {};
  if (extras.t) unpacked.propertyType = extras.t;
  if (extras.p?.length) {
    unpacked.places = extras.p.map((value) => ({
      id: value[0], label: value[1],
      target: unpackTarget(value),
      mode: PLACE_MODES[value[5]], targetMinutes: value[6], weight: value[7], must: value[8] === 1,
      ...(value[9] !== undefined && value[9] !== null ? { when: unpackWhen(value[9]) } : {}),
    }));
  }
  if (extras.c?.length) unpacked.custom = extras.c.map(unpackCustom);
  if (extras.l || extras.x || extras.n) {
    unpacked.marks = { liked: extras.l ?? [], excluded: extras.x ?? [], notes: Object.fromEntries(extras.n ?? []) };
  }
  if (extras.h?.length) unpacked.houseTypes = [...extras.h];
  if (extras.r?.length) {
    unpacked.ranges = extras.r.map(([layer, min, max, softMin, softMax, importance]) => ({ layer, min, max, softMin, softMax, importance }));
  }
  return unpacked;
}

function packZone(zone: MatchZone): CompactZone {
  const label = zone.label === undefined ? [] : [zone.label];
  if (zone.kind === "station") return [0, zone.stationId, zone.maxWalkMinutes, ...label] as CompactZone;
  if (zone.kind === "borough") return [1, zone.id, ...label] as CompactZone;
  if (zone.kind === "polygon") return [3, zone.points, ...label] as CompactZone;
  return [2, zone.ids, ...label] as CompactZone;
}

function unpackZone(value: CompactZone): MatchZone {
  const label = (text: string | undefined) => (text === undefined ? {} : { label: text });
  if (value[0] === 0) return { kind: "station", stationId: value[1], maxWalkMinutes: value[2], ...label(value[3]) };
  if (value[0] === 1) return { kind: "borough", id: value[1] as GeographyId, ...label(value[2]) };
  if (value[0] === 3) return { kind: "polygon", points: value[1], ...label(value[2]) };
  return { kind: "lsoas", ids: value[1] as GeographyId[], ...label(value[2]) };
}

function packDestination(destination: CommuteDestination): CompactDestination {
  return [
    destination.id, destination.label, destination.latitude, destination.longitude,
    ["transit", "walk", "cycle"].indexOf(destination.mode), destination.arrivalTime,
    destination.targetMinutes, destination.weight,
  ];
}

function unpackProfile(value: CompactProfile): PreferenceProfile {
  return {
    schemaVersion: "preference-profile.v1",
    market: value[0] === 0 ? "buy" : "rent",
    targetBudget: value[1], maximumBudget: value[2], bedrooms: value[3],
    forecastHorizon: value[4] === 1 ? "1y" : "5y",
    factors: value[5].map((factor) => ({
      factorId: FACTOR_IDS[factor[0]], weight: factor[1],
      direction: ["higher", "lower", "target-range"][factor[2]] as PreferenceDirection,
      // A compact (v2) link leaves out null limits.
      minimumUtility: factor[3] ?? null, maximumUtility: factor[4] ?? null,
    })),
    commuteDestinations: value[6].map(unpackDestination),
    // 0: the default school settings (v2 links).
    school: (value[7] as CompactSchool | 0) === 0 ? structuredClone(DEFAULT_PROFILE.school) : {
      phases: value[7][0] as PreferenceProfile["school"]["phases"],
      characteristics: value[7][1], facetWeights: Object.fromEntries(value[7][2]),
      shortlistUrns: value[7][3], desiredSchoolCount: value[7][4],
    },
    analyticsConsent: value[8] === 1,
    ...(value[9]?.length ? { zones: value[9].map(unpackZone) } : {}),
    ...unpackExtras(value[10]),
  };
}

/**
 * A v1 or v2 link's compact array read part by part: the budget must read; every factor, destination,
 * zone, place, own criterion, range and mark that does not is dropped and counted. Null when nothing usable is left.
 */
export function unpackProfileLenient(value: unknown): { profile: PreferenceProfile | null; skipped: number } {
  if (!Array.isArray(value) || value.length < 9) return { profile: null, skipped: 0 };
  let skipped = 0;
  const each = <T>(items: unknown, read: (item: never) => T, check: (item: T) => void = () => undefined): T[] =>
    (Array.isArray(items) ? items : []).flatMap((item) => {
      try {
        const out = read(item as never);
        check(out);
        return [out];
      } catch {
        skipped += 1;
        return [];
      }
    });
  const base = unpackProfile([value[0], value[1], value[2], value[3], value[4], [], [], 0, value[8]] as unknown as CompactProfile);
  try {
    assertPreferenceProfile(structuredClone(base));
  } catch {
    return { profile: null, skipped: 0 };
  }
  const factors = each(value[5], (factor: CompactFactor) => unpackProfile([0, 1, 1, 0, 1, [factor], [], 0, 0] as unknown as CompactProfile).factors[0],
    (factor) => assertPreferenceProfile({ ...structuredClone(base), factors: [factor] }));
  const unique = factors.filter((factor, index) => factors.findIndex((other) => other.factorId === factor.factorId) === index);
  skipped += factors.length - unique.length;
  base.factors = unique.length ? unique : structuredClone(DEFAULT_PROFILE.factors);
  base.commuteDestinations = each(value[6], (destination: CompactDestination) => unpackDestination(destination), (destination) => {
    if (!destination.id || !(destination.targetMinutes > 0) || ![0, 1, 2, 3, 4, 5].includes(destination.weight)) throw new Error("destination");
  });
  try {
    if (value[7] !== 0) base.school = unpackProfile([0, 1, 1, 0, 1, [], [], value[7], 0] as unknown as CompactProfile).school;
    assertPreferenceProfile(structuredClone(base));
  } catch {
    skipped += 1;
    base.school = structuredClone(DEFAULT_PROFILE.school);
  }
  const zones = each(value[9], (zone: CompactZone) => unpackZone(zone), (zone) => assertPreferenceProfile({ ...structuredClone(base), zones: [zone] }));
  if (zones.length) base.zones = zones.slice(0, 3);
  skipped += Math.max(0, zones.length - 3);
  const extras = value[10] && typeof value[10] === "object" && !Array.isArray(value[10]) ? value[10] as CompactExtras : {};
  const check = (patch: Partial<PreferenceProfile>) => assertPreferenceProfile({ ...structuredClone(base), ...patch });
  const places = each(extras.p, (place: CompactPlace) => unpackExtras({ p: [place] }).places![0], (place) => check({ places: [place] }));
  if (places.length) base.places = places.filter((place, index) => places.findIndex((other) => other.id === place.id) === index).slice(0, 8);
  const custom = each(extras.c, (entry: CompactCustom) => unpackCustom(entry), (entry) => check({ custom: [entry] }));
  if (custom.length) base.custom = custom;
  const ranges = each(extras.r, (range: NonNullable<CompactExtras["r"]>[number]) => unpackExtras({ r: [range] }).ranges![0], (range) => check({ ranges: [range] }));
  if (ranges.length) base.ranges = ranges.filter((range, index) => ranges.findIndex((other) => other.layer === range.layer) === index).slice(0, 8);
  for (const key of ["t", "h"] as const) {
    if (extras[key] === undefined) continue;
    try {
      const patch = unpackExtras({ [key]: extras[key] } as CompactExtras);
      check(patch);
      Object.assign(base, patch);
    } catch {
      skipped += 1;
    }
  }
  if (extras.l || extras.x || extras.n) {
    try {
      const patch = unpackExtras({ l: extras.l, x: extras.x, n: extras.n });
      check(patch);
      Object.assign(base, patch);
    } catch {
      skipped += 1;
    }
  }
  try {
    return { profile: withCurrentLevels(withoutRetiredFactors(assertPreferenceProfile(base))), skipped };
  } catch {
    return { profile: null, skipped };
  }
}

function unpackDestination(value: CompactDestination): CommuteDestination {
  return {
    id: value[0], label: value[1], latitude: value[2], longitude: value[3],
    mode: ["transit", "walk", "cycle"][value[4]] as CommuteDestination["mode"],
    arrivalTime: value[5], targetMinutes: value[6], weight: value[7],
  };
}

function toBase64Url(value: string): string {
  return value.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): string {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  return standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
}

function packCustom(entry: CustomPreference): CompactCustom {
  const { criterion } = entry;
  const sets = CUSTOM_SET_IDS.flatMap((id) => {
    const set = criterion.sets[id];
    return set ? [[id, set.label, set.any.map((matcher) => Object.entries(matcher) as [string, CustomTagValue][])] as
      [CustomSetId, string, [string, CustomTagValue][][]]] : [];
  });
  return [[criterion.id, criterion.label, criterion.formula, criterion.radiusMetres, sets], entry.weight, entry.direction === "higher" ? 0 : 1];
}

function unpackCustom(value: CompactCustom): CustomPreference {
  const [[id, label, formula, radiusMetres, sets], weight, direction] = value;
  const unpackedSets = Object.fromEntries(sets.map(([setId, setLabel, matchers]) => [setId, {
    label: setLabel, any: matchers.map((matcher) => Object.fromEntries(matcher)),
  }])) as CustomCriterion["sets"];
  return { criterion: { id, label, sets: unpackedSets, formula, radiusMetres }, weight, direction: direction === 0 ? "higher" : "lower" };
}

// ---- where the search on screen came from ------------------------------------------------

/** "shared": opened from a #profile= link and not edited since; "example": the wizard's "Show me an
 * example", never saved; "own": everything else. */
export type ProfileOrigin = "own" | "shared" | "example";

// Keyed by the profile object itself: any edit makes a new profile, which reads "own" again.
// Nothing here is stored; a reload reads the link afresh.
const ORIGINS = new WeakMap<PreferenceProfile, Exclude<ProfileOrigin, "own">>();

export function markProfileOrigin(profile: PreferenceProfile, origin: Exclude<ProfileOrigin, "own">): PreferenceProfile {
  ORIGINS.set(profile, origin);
  return profile;
}

export function profileOrigin(profile: PreferenceProfile): ProfileOrigin {
  return ORIGINS.get(profile) ?? "own";
}

/** "Try an example": buy a 2-bed for up to £600k (a Must), King's Cross within 30 minutes, then safer streets: My match's
 * one list. A fresh profile each time, marked "example" so it is shown but never saved. */
export function exampleProfile(): PreferenceProfile {
  const base: PreferenceProfile = { ...structuredClone(DEFAULT_PROFILE), market: "buy", bedrooms: 2, ...budgetFromMaximum(600_000, "buy") };
  const safer = MATCH_CHIPS.find((chip) => chip.id === "safer-streets")!.criterion;
  return markProfileOrigin(withCriteria(base, [
    { kind: "budget", must: true },
    { kind: "place", id: "kings-cross", label: "King's Cross", target: { kind: "point", latitude: 51.5306, longitude: -0.1239 }, mode: "transit", targetMinutes: 30, must: false },
    structuredClone(safer),
  ]), "example");
}

/**
 * "Example search →" on /agents (CUJ-07 v4): the sample prompt's search (2-bed to buy up to £600k, King's Cross in
 * 30 minutes) as the #profile= link an agent hands back, so it opens My match as CUJ-08 does: chips, the map, the
 * top 10, all inside its own budget. Nothing in it is anyone's own.
 */
export function exampleSearchHref(): string {
  return `/?layer=personal-match${encodeSearchLink(exampleProfile())}`;
}

// ---- "Like this" (/?find=like&area=<carrier>:<code>) --------------------------------------------

/** The home page link that opens Find my area starting from one area. */
export function findLikeHref(geographyId: GeographyId): string {
  const [, carrier, code] = geographyId.split(":");
  return `/?find=like&area=${carrier}:${code}`;
}

/** The area a find-like link starts from (London LSOAs only), or null for any other address. */
export function parseFindLike(search: string): GeographyId | null {
  const query = new URLSearchParams(search);
  if (query.get("find") !== "like") return null;
  const area = (query.get("area") ?? "").replace(/^uk:/, "");
  return /^lsoa:E\d{8}$/.test(area) ? (`uk:${area}` as GeographyId) : null;
}

// ---- "Find areas at this budget" (/?find=budget&price=<pounds>) ---------------------------------

/** The home page link that opens Find my area with a tool's price as the draft budget (none: just opens it). */
export function findBudgetHref(price: number | null): string {
  return price !== null && Number.isFinite(price) && price > 0 ? `/?find=budget&price=${Math.round(price)}` : "/?find=budget";
}

/** A find-budget link's price (null when it has none), or undefined for any other address. */
export function parseFindBudget(search: string): number | null | undefined {
  const query = new URLSearchParams(search);
  if (query.get("find") !== "budget") return undefined;
  const price = Number(query.get("price"));
  return Number.isFinite(price) && price > 0 && price <= 100_000_000 ? Math.round(price) : null;
}

