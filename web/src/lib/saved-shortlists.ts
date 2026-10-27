import type {
  GeographyId,
  MatchPack,
  MatchResult,
  PreferenceProfile,
} from "./contracts";
import { areaDisplayName } from "./area-labels";
import { assertPreferenceProfile } from "./contracts";
import { DEFAULT_PROFILE } from "./fixtures";
import type { DataMode } from "./map-state";
import { contractProfile } from "./match-model";
import {
  decodeSharedProfile,
  encodeSharedProfile,
} from "./profile-state";
import { encodeProfileLinkV3 } from "./profile-v2";

export const SAVED_SHORTLISTS_KEY = "close-knit.saved-shortlists.v1";
export const LEGACY_SHORTLIST_KEYS = [
  "close-knit.shortlist.v1",
  "close-knit.saved-shortlists.v0",
] as const;
export const SHORTLIST_SCHEMA = "saved-shortlist.v1";
export const SHORTLIST_SHARE_SCHEMA = "saved-shortlist-share.v1";
export const SHORTLIST_PROFILE_VERSION = "preference-profile.v1";
export const SHORTLIST_FRAGMENT_PREFIX = "#shortlist=v1.";
export const MAX_SHORTLIST_FRAGMENT_LENGTH = 8192;
export const MAX_SHORTLIST_CANDIDATES = 4;
export const MAX_SHORTLIST_NOTES_LENGTH = 500;
/** Fired on window after any write to the saved shortlists or saved items (♡ N, the Saved panel). */
export const SAVED_CHANGE_EVENT = "close-knit:saved-change";

/** Tells every ♡ on the page that what is saved changed. */
export function notifySavedChange(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(SAVED_CHANGE_EVENT));
}

export interface ShortlistCandidateSnapshot {
  geographyId: GeographyId;
  name: string;
  score: number | null;
  excluded: boolean;
  evidenceCompleteness: number;
}

export interface SavedShortlist {
  schemaVersion: typeof SHORTLIST_SCHEMA;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  candidates: GeographyId[];
  candidateNames: Record<string, string>;
  profile: PreferenceProfile;
  mode: DataMode;
  release: string;
  notes?: string;
  evidence: ShortlistCandidateSnapshot[];
}

export interface ShortlistStoreResult {
  shortlists: SavedShortlist[];
  corrupted: boolean;
  storageDenied: boolean;
}

export type ShortlistWriteResult =
  | { ok: true }
  | { ok: false; reason: "storage-denied" | "invalid-shortlist" };

export interface SharedShortlist {
  schemaVersion: typeof SHORTLIST_SHARE_SCHEMA;
  name: string;
  candidates: GeographyId[];
  candidateNames: Record<string, string>;
  profile: PreferenceProfile;
  mode: DataMode;
  release: string;
  notes?: string;
  redacted: boolean;
  /** False when the budget was left out (the profile then carries UNSHARED_BUDGET). */
  budgetShared: boolean;
  /** Whether exact places (destinations, pinned points, drawn areas) came with it. */
  placesShared: boolean;
  /**
   * The link's own reference when this device made it for its own brief (Compare › Brief, Saved › Open):
   * the full search stays on this device under it (rememberOwnBrief), never in the link.
   */
  ref?: string;
  /**
   * CUJ03 step 4: each area's My match score as the sender saw it. Their exact places and budget may stay
   * out of the link, which would score the areas differently here; the partner is shown these instead.
   */
  scores?: Record<string, number>;
  /** The profile exactly as the link carries it (the #profile= fragment inside the envelope). */
  profileFragment: string;
}

export type ShortlistDecodeResult =
  | { ok: true; share: SharedShortlist }
  | { ok: false; reason: "not-a-shortlist" | "too-large" | "corrupt" };

export interface ShortlistResolution {
  matched: MatchResult[];
  missing: { geographyId: GeographyId; name: string; reason: string }[];
  release: string;
  releaseAvailable: boolean;
}

interface BuildShortlistInput {
  name: string;
  candidates: GeographyId[];
  candidateNames: Record<string, string>;
  profile: PreferenceProfile;
  mode: DataMode;
  release: string;
  notes?: string;
  evidence: MatchPack;
}

export function buildShortlist(input: BuildShortlistInput): SavedShortlist {
  const now = new Date().toISOString();
  return {
    schemaVersion: SHORTLIST_SCHEMA,
    id: createShortlistId(),
    name: cleanName(input.name),
    createdAt: now,
    updatedAt: now,
    candidates: cleanCandidates(input.candidates),
    candidateNames: input.candidateNames,
    profile: assertPreferenceProfile(structuredClone(input.profile)),
    mode: cleanMode(input.mode),
    release: cleanRelease(input.release),
    notes: cleanNotes(input.notes),
    evidence: snapshotCandidates(input.evidence, input.candidates, input.candidateNames),
  };
}

export const DEFAULT_SHORTLIST_NAME = "My shortlist";

export type SaveAreaResult =
  | { ok: true; shortlist: SavedShortlist; created: boolean; already: boolean }
  | { ok: false; reason: "storage-denied" | "invalid-shortlist" | "full"; shortlist?: SavedShortlist };

/**
 * "Save area" from an area page: adds the area to the most recently saved shortlist, or starts
 * "My shortlist" when there is none. The snapshot holds the name only (no match score is known
 * there); a refresh from the results fills in the rest.
 */
export function saveAreaToShortlist(input: {
  geographyId: GeographyId; name: string; profile: PreferenceProfile; mode: DataMode; release: string;
}): SaveAreaResult {
  const listed = listShortlists();
  if (listed.storageDenied) return { ok: false, reason: "storage-denied" };
  const recent = [...listed.shortlists].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  const snapshot: ShortlistCandidateSnapshot = { geographyId: input.geographyId, name: input.name, score: null, excluded: false, evidenceCompleteness: 0 };
  if (recent?.candidates.includes(input.geographyId)) return { ok: true, shortlist: recent, created: false, already: true };
  if (recent && recent.candidates.length >= MAX_SHORTLIST_CANDIDATES) return { ok: false, reason: "full", shortlist: recent };
  let next: SavedShortlist;
  try {
    const now = new Date().toISOString();
    next = recent
      ? { ...recent, updatedAt: freshTimestamp(recent.updatedAt), candidates: [...recent.candidates, input.geographyId],
          candidateNames: { ...recent.candidateNames, [input.geographyId]: input.name }, evidence: [...recent.evidence, snapshot] }
      : { schemaVersion: SHORTLIST_SCHEMA, id: createShortlistId(), name: DEFAULT_SHORTLIST_NAME, createdAt: now, updatedAt: now,
          candidates: [input.geographyId], candidateNames: { [input.geographyId]: input.name },
          profile: assertPreferenceProfile(structuredClone(input.profile)), mode: cleanMode(input.mode), release: cleanRelease(input.release),
          evidence: [snapshot] };
  } catch {
    return { ok: false, reason: "invalid-shortlist" };
  }
  const written = saveShortlist(next);
  return written.ok ? { ok: true, shortlist: next, created: !recent, already: false } : { ok: false, reason: written.reason };
}

/** Unsave an area: it leaves every saved shortlist, and a shortlist left empty is deleted. */
export function removeAreaFromShortlists(geographyId: GeographyId): ShortlistWriteResult {
  const listed = listShortlists();
  if (listed.storageDenied) return { ok: false, reason: "storage-denied" };
  for (const entry of listed.shortlists) {
    if (!entry.candidates.includes(geographyId)) continue;
    const candidates = entry.candidates.filter((id) => id !== geographyId);
    const candidateNames = Object.fromEntries(Object.entries(entry.candidateNames).filter(([id]) => id !== geographyId));
    const written = candidates.length === 0
      ? deleteShortlist(entry.id)
      : saveShortlist({ ...entry, updatedAt: freshTimestamp(entry.updatedAt), candidates, candidateNames,
          evidence: entry.evidence.filter((snapshot) => snapshot.geographyId !== geographyId) });
    if (!written.ok) return written;
  }
  return { ok: true };
}

/** Every saved area once, newest shortlist first: the Saved panel's Areas and the ♡ on the map. */
export function savedAreas(shortlists: SavedShortlist[]): { geographyId: GeographyId; name: string }[] {
  const seen = new Map<GeographyId, string>();
  const newest = [...shortlists].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  for (const entry of newest) {
    for (const id of entry.candidates) if (!seen.has(id)) seen.set(id, entry.candidateNames[id] ?? id);
  }
  return [...seen].map(([geographyId, name]) => ({ geographyId, name }));
}

/** Everything included: what this device's own brief shows (never what its link carries). */
export const OWN_BRIEF: ShareInclusions = { includeBudget: true, includeDestinations: true, includeNotes: true };

/** /brief with the shortlist's fragment (private details left out unless included); null when it can't be built. */
export function shortlistBriefHref(
  shortlist: SavedShortlist,
  options: ShareInclusions = {},
): string | null {
  return briefHref(shortlist, options);
}

function briefHref(shortlist: SavedShortlist, options: ShareInclusions, ref?: string): string | null {
  try {
    const fragment = encodeSharedShortlist(shortlist, options, ref);
    return fragment.length > MAX_SHORTLIST_FRAGMENT_LENGTH ? null : `/brief${fragment}`;
  } catch {
    return null;
  }
}

/**
 * This device's own brief (Compare › Brief, Saved › Open): the link in the address bar is the
 * redacted one (no budget, exact places or notes), so copying it shares nothing private. The full search stays
 * on this device under the link's `ref`, and /brief reads it back only here (ownBrief). Without storage the
 * link still opens, as a shared brief.
 */
export function ownShortlistBriefHref(shortlist: SavedShortlist): string | null {
  return briefHref(shortlist, {}, rememberOwnBrief(shortlist) ?? undefined);
}

/** Own briefs made on this device: the link's ref and the full search behind it, newest first. */
export const OWN_BRIEFS_KEY = "close-knit.own-briefs.v1";
const MAX_OWN_BRIEFS = 20;
const REF_PATTERN = /^[A-Za-z0-9]{8,40}$/;

interface OwnBrief { ref: string; profile: PreferenceProfile; notes?: string }

function readOwnBriefs(): OwnBrief[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OWN_BRIEFS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is OwnBrief =>
      Boolean(entry) && typeof entry.ref === "string" && REF_PATTERN.test(entry.ref) && typeof entry.profile === "object") : [];
  } catch {
    return [];
  }
}

/** Keeps the shortlist's full search under a ref (the same ref for the same search and notes); null without storage. */
export function rememberOwnBrief(shortlist: Pick<SavedShortlist, "profile" | "notes">): string | null {
  if (typeof window === "undefined") return null;
  try {
    const key = JSON.stringify([shortlist.profile, shortlist.notes ?? null]);
    const briefs = readOwnBriefs();
    const known = briefs.find((entry) => JSON.stringify([entry.profile, entry.notes ?? null]) === key);
    const ref = known?.ref ?? createRef();
    const entry: OwnBrief = { ref, profile: structuredClone(shortlist.profile), ...(shortlist.notes ? { notes: shortlist.notes } : {}) };
    const next = [entry, ...briefs.filter((item) => item.ref !== ref)].slice(0, MAX_OWN_BRIEFS);
    window.localStorage.setItem(OWN_BRIEFS_KEY, JSON.stringify(next));
    return ref;
  } catch {
    return null;
  }
}

/** The full search behind a link this device made for itself; null on any other device (a shared brief). */
export function ownBrief(ref: string | undefined): { profile: PreferenceProfile; notes?: string } | null {
  if (!ref || typeof window === "undefined") return null;
  const entry = readOwnBriefs().find((item) => item.ref === ref);
  if (!entry) return null;
  try {
    return { profile: assertPreferenceProfile(structuredClone(entry.profile)), ...(entry.notes ? { notes: entry.notes } : {}) };
  } catch {
    return null;
  }
}

function createRef(): string {
  const random = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (random) return random().replace(/-/g, "").slice(0, 20);
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e12).toString(36)}`.slice(0, 20);
}

/**
 * The brief's own link for the compared areas and the search (G06): a shortlist built on the spot,
 * never stored. Null with nothing compared or a link too long to share.
 */
export function comparedBriefHref(input: {
  pack: MatchPack; compared: GeographyId[]; profile: PreferenceProfile; mode: DataMode;
  includeDestinations?: boolean; includeNotes?: boolean; includeBudget?: boolean;
}): string | null {
  if (input.compared.length === 0) return null;
  try {
    const names = Object.fromEntries(input.pack.values.map((result) => [result.geographyId, areaDisplayName(result) ?? result.name]));
    const shortlist = buildShortlist({
      name: DEFAULT_SHORTLIST_NAME, candidates: input.compared, candidateNames: Object.fromEntries(input.compared.map((id) => [id, names[id] ?? id])),
      profile: input.profile, mode: input.mode, release: input.pack.sourceReleaseSet, evidence: input.pack,
    });
    return shortlistBriefHref(shortlist, { includeDestinations: input.includeDestinations, includeBudget: input.includeBudget, includeNotes: input.includeNotes });
  } catch {
    return null;
  }
}

/**
 * /compare › Brief (the one way to a brief): the brief for the areas side by side and this
 * browser's search, built on the spot (only the search is kept, under the link's ref; the link itself is
 * redacted). Null with no area or a link too long to share.
 */
export function areasBriefHref(input: {
  candidates: GeographyId[]; candidateNames: Record<string, string>; profile: PreferenceProfile; mode: DataMode; release: string;
}): string | null {
  try {
    const now = new Date().toISOString();
    return ownShortlistBriefHref({
      schemaVersion: SHORTLIST_SCHEMA, id: "compare", name: DEFAULT_SHORTLIST_NAME, createdAt: now, updatedAt: now,
      candidates: cleanCandidates(input.candidates), candidateNames: input.candidateNames, profile: input.profile,
      mode: cleanMode(input.mode), release: cleanRelease(input.release), evidence: [],
    });
  } catch {
    return null;
  }
}

export function snapshotCandidates(
  pack: MatchPack,
  candidates: GeographyId[],
  names: Record<string, string>,
): ShortlistCandidateSnapshot[] {
  return candidates.map((id) => {
    const result = pack.values.find((candidate) => candidate.geographyId === id);
    if (!result) throw new Error(`shortlist unknown area: ${id}`);
    return {
      geographyId: id,
      name: result.name || names[id] || id,
      score: result.score,
      excluded: result.excluded,
      evidenceCompleteness: result.evidenceCompleteness,
    };
  });
}

export function listShortlists(): ShortlistStoreResult {
  const storage = readStorage();
  if (storage.denied) return { shortlists: [], corrupted: false, storageDenied: true };
  const migrated = adoptLegacyEntries(storage);
  const parsed = parseStoredList(storage.main);
  const shortlists = [...migrated, ...parsed.shortlists];
  if (migrated.length > 0) persistShortlists(storage.store, shortlists);
  return { shortlists, corrupted: parsed.corrupted, storageDenied: false };
}

export function saveShortlist(shortlist: SavedShortlist): ShortlistWriteResult {
  let valid: SavedShortlist;
  try {
    valid = assertShortlist(shortlist);
  } catch {
    return { ok: false, reason: "invalid-shortlist" };
  }
  const storage = readStorage();
  if (storage.denied) return { ok: false, reason: "storage-denied" };
  const parsed = parseStoredList(storage.main);
  const next = [valid, ...parsed.shortlists.filter((entry) => entry.id !== valid.id)];
  try {
    storage.store.setItem(SAVED_SHORTLISTS_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, reason: "storage-denied" };
  }
  notifySavedChange();
  return { ok: true };
}

export function deleteShortlist(id: string): ShortlistWriteResult {
  const storage = readStorage();
  if (storage.denied) return { ok: false, reason: "storage-denied" };
  const parsed = parseStoredList(storage.main);
  const next = parsed.shortlists.filter((entry) => entry.id !== id);
  try {
    storage.store.setItem(SAVED_SHORTLISTS_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, reason: "storage-denied" };
  }
  notifySavedChange();
  return { ok: true };
}

export function migrateLegacyShortlists(entries: unknown): { migrated: SavedShortlist[] } {
  if (!Array.isArray(entries)) return { migrated: [] };
  const migrated: SavedShortlist[] = [];
  for (const entry of entries) {
    const shortlist = migrateLegacyEntry(entry);
    if (shortlist) migrated.push(shortlist);
  }
  return { migrated };
}

/**
 * What a share may carry beyond the areas and the criteria, each left out unless ticked in the review:
 * exact places (commute destinations, pinned points and drawn areas: coordinates), the
 * budget, and private notes (the shortlist's and each area's).
 */
export interface ShareInclusions {
  includeDestinations?: boolean;
  includeBudget?: boolean;
  includeNotes?: boolean;
}

/**
 * The budget a share carries when the budget is left out: a ceiling no London area reaches, so every
 * area grades the same on price and none is "over budget". The link says so (`include.budget: false`)
 * and the brief that opens it says "Budget not shared" instead of a figure.
 */
export const UNSHARED_BUDGET = 100_000_000;

/** The profile a share carries: the private parts removed unless the review included them. */
export function redactProfileForShare(profile: PreferenceProfile, options: ShareInclusions = {}): PreferenceProfile {
  const redacted: PreferenceProfile = structuredClone(profile);
  if (!options.includeDestinations) {
    redacted.commuteDestinations = [];
    // Pinned points ("near work", "either office") carry coordinates; "nearest park" or a school rule do not.
    redacted.places = (redacted.places ?? []).filter((place) => place.target.kind !== "point" && place.target.kind !== "any-of");
    redacted.zones = (redacted.zones ?? []).filter((zone) => zone.kind !== "polygon");
  }
  if (!options.includeBudget) {
    redacted.targetBudget = UNSHARED_BUDGET;
    redacted.maximumBudget = UNSHARED_BUDGET;
  }
  if (!options.includeNotes && redacted.marks) redacted.marks = { ...redacted.marks, notes: {} };
  // Tailor answers never leave this device (profile-state.matchRequestProfile).
  delete redacted.household;
  delete redacted.lifestyle;
  if (!redacted.places?.length) delete redacted.places;
  if (!redacted.zones?.length) delete redacted.zones;
  return assertPreferenceProfile(redacted);
}

/**
 * The profile as a link carries it: the v3 list (order, Musts, soft edges), so the brief that opens
 * it reads the same search. Only a legacy commute destination (shared on purpose) needs the v1 form.
 */
function shareProfileFragment(profile: PreferenceProfile): string {
  if (profile.commuteDestinations.length === 0) {
    try {
      return encodeProfileLinkV3(contractProfile(profile));
    } catch {
      // A profile the v2 contract can't hold: the v1 form below.
    }
  }
  return encodeSharedProfile(profile);
}

/** The sender's scores for the link: only the shortlist's own areas that scored, never anything else. */
function sentScores(shortlist: SavedShortlist): { scores?: Record<string, number> } {
  const scores = cleanScores(Object.fromEntries(shortlist.evidence
    .filter((entry) => !entry.excluded && typeof entry.score === "number")
    .map((entry) => [entry.geographyId, entry.score])), shortlist.candidates);
  return scores ? { scores } : {};
}

function cleanScores(value: unknown, candidates: readonly string[]): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const scores = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([id, score]) =>
    candidates.includes(id) && typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100)) as Record<string, number>;
  return Object.keys(scores).length ? scores : undefined;
}

/** The scores a pack gives a shortlist's areas (out of the search: none), as a link carries them. */
export function packScores(pack: MatchPack, candidates: readonly string[]): Record<string, number> {
  return Object.fromEntries(pack.values.filter((result) => candidates.includes(result.geographyId) && !result.excluded
    && typeof result.score === "number").map((result) => [result.geographyId, result.score as number]));
}

/**
 * The same #shortlist= link with the sender's scores in it: the owner's own brief writes them into its address
 * once it has ranked, so the link they copy from the address bar shows a partner the same numbers. Null when the
 * fragment can't be read or already says so.
 */
export function fragmentWithScores(fragment: string, scores: Record<string, number>): string | null {
  if (!fragment.startsWith(SHORTLIST_FRAGMENT_PREFIX)) return null;
  try {
    const envelope = fromBase64Url(fragment.slice(SHORTLIST_FRAGMENT_PREFIX.length)) as ShareEnvelope;
    if (!envelope || envelope.schemaVersion !== SHORTLIST_SHARE_SCHEMA) return null;
    const clean = cleanScores(scores, cleanCandidates(envelope.candidates));
    if (JSON.stringify(clean ?? null) === JSON.stringify(cleanScores(envelope.scores, cleanCandidates(envelope.candidates)) ?? null)) return null;
    const rest: ShareEnvelope = { ...envelope };
    delete rest.scores;
    const next = `${SHORTLIST_FRAGMENT_PREFIX}${toBase64Url({ ...rest, ...(clean ? { scores: clean } : {}) })}`;
    return next.length > MAX_SHORTLIST_FRAGMENT_LENGTH ? null : next;
  } catch {
    return null;
  }
}

/**
 * A shared brief's pack with the sender's scores on their areas (CUJ03 step 4: sender and partner see the same
 * numbers). Everything else (gains, trade-offs, prices) is read here from what the link carries.
 */
export function withSentScores(pack: MatchPack, scores: Record<string, number> | undefined): MatchPack {
  if (!scores) return pack;
  return {
    ...pack,
    values: pack.values.map((result) => (typeof scores[result.geographyId] === "number" && !result.excluded
      ? { ...result, score: scores[result.geographyId] } : result)),
  };
}

export function encodeSharedShortlist(shortlist: SavedShortlist, options: ShareInclusions = {}, ref?: string): string {
  const valid = redactProfileForShare(shortlist.profile, options);
  const include = { places: Boolean(options.includeDestinations), budget: Boolean(options.includeBudget), notes: Boolean(options.includeNotes) };
  const envelope = {
    schemaVersion: SHORTLIST_SHARE_SCHEMA,
    name: shortlist.name,
    candidates: shortlist.candidates,
    candidateNames: shortlist.candidateNames,
    mode: shortlist.mode,
    release: shortlist.release,
    redacted: !include.places || !include.budget || !include.notes,
    include,
    ...(options.includeNotes && shortlist.notes ? { notes: shortlist.notes } : {}),
    ...(ref && REF_PATTERN.test(ref) ? { ref } : {}),
    ...sentScores(shortlist),
    profileFragment: shareProfileFragment(valid),
  };
  return `${SHORTLIST_FRAGMENT_PREFIX}${toBase64Url(envelope)}`;
}

/** What the review step lists before a link is made: what goes with it, and what stays out. */
export function shareReviewLines(profile: PreferenceProfile, candidates: string[], options: ShareInclusions, notes = false): {
  shared: string[]; left: string[];
} {
  const exact = [
    ...profile.commuteDestinations.map((destination) => destination.label),
    ...(profile.places ?? []).filter((place) => place.target.kind === "point" || place.target.kind === "any-of").map((place) => place.label),
    ...(profile.zones ?? []).filter((zone) => zone.kind === "polygon").map((zone) => zone.label ?? "an area you drew"),
  ];
  const noteCount = Object.keys(profile.marks?.notes ?? {}).length + (notes ? 1 : 0);
  const shared = [`${candidates.length} ${candidates.length === 1 ? "area" : "areas"}: ${candidates.join("; ")}`, "What matters, in order"];
  const left: string[] = [];
  const money = `£${profile.maximumBudget.toLocaleString("en-GB")}${profile.market === "rent" ? " a month" : ""}`;
  (options.includeBudget ? shared : left).push(`Budget up to ${money}`);
  if (exact.length) (options.includeDestinations ? shared : left).push(`Exact places: ${exact.join(", ")}`);
  if (noteCount) (options.includeNotes ? shared : left).push(`Private notes (${noteCount})`);
  return { shared, left };
}

export function decodeSharedShortlist(fragment: string): ShortlistDecodeResult {
  if (!fragment.startsWith(SHORTLIST_FRAGMENT_PREFIX)) return { ok: false, reason: "not-a-shortlist" };
  if (fragment.length > MAX_SHORTLIST_FRAGMENT_LENGTH) return { ok: false, reason: "too-large" };
  try {
    const envelope = fromBase64Url(fragment.slice(SHORTLIST_FRAGMENT_PREFIX.length)) as ShareEnvelope;
    if (!envelope || envelope.schemaVersion !== SHORTLIST_SHARE_SCHEMA) return { ok: false, reason: "corrupt" };
    const profile = decodeSharedProfile(envelope.profileFragment);
    if (!profile) return { ok: false, reason: "corrupt" };
    const candidates = cleanCandidates(envelope.candidates);
    const scores = cleanScores(envelope.scores, candidates);
    return {
      ok: true,
      share: {
        schemaVersion: SHORTLIST_SHARE_SCHEMA,
        name: cleanName(envelope.name),
        candidates,
        candidateNames: envelope.candidateNames ?? {},
        profile,
        mode: cleanMode(envelope.mode),
        release: cleanRelease(envelope.release),
        redacted: envelope.redacted !== false,
        // Older links carried the budget (and pinned places) whatever they said.
        budgetShared: envelope.include?.budget !== false,
        placesShared: envelope.include ? envelope.include.places === true : profile.commuteDestinations.length > 0,
        ...(typeof envelope.notes === "string" ? { notes: cleanNotes(envelope.notes) } : {}),
        ...(typeof envelope.ref === "string" && REF_PATTERN.test(envelope.ref) ? { ref: envelope.ref } : {}),
        ...(scores ? { scores } : {}),
        profileFragment: envelope.profileFragment,
      },
    };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

const SAVED_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London",
});

/** "10 Oct 2026, 16:27" (London time) for a stored ISO timestamp; never the raw ISO string. */
export function formatSavedTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? SAVED_TIME.format(new Date(time)) : "an earlier visit";
}

/** The technical record behind a saved or shared shortlist, for a "Details" disclosure only. */
export function describeShortlistDetails(entry: { mode: DataMode; release: string; profile?: { schemaVersion: string } }): string {
  return `Profile ${entry.profile?.schemaVersion ?? SHORTLIST_PROFILE_VERSION} · ${entry.mode} data · release ${entry.release}`;
}

export function describeShareAssumptions(share: SharedShortlist): string[] {
  const names = share.candidates.map((id) => share.candidateNames[id] ?? "an area");
  return [
    `Shortlist “${share.name}” with ${share.candidates.length} candidates: ${names.join("; ")}.`,
    share.mode === "demo" ? "Built on demo data, not for decisions." : "Built on the live data it was saved with.",
    share.budgetShared ? `Budget included: up to £${share.profile.maximumBudget.toLocaleString("en-GB")}.` : "Budget excluded.",
    share.placesShared ? "Exact places included (destinations, pinned points, drawn areas)." : "Exact places excluded.",
    share.notes ? "Private notes included." : "Private notes excluded.",
    share.redacted ? "Redacted by default — confirm each inclusion before sharing." : "Full share — every inclusion was confirmed.",
  ];
}

export function importSharedShortlist(share: SharedShortlist): SavedShortlist {
  const now = new Date().toISOString();
  return {
    schemaVersion: SHORTLIST_SCHEMA,
    id: createShortlistId(),
    name: share.name,
    createdAt: now,
    updatedAt: now,
    candidates: [...share.candidates],
    candidateNames: { ...share.candidateNames },
    // A share without its budget keeps the unset default budget, never the stand-in ceiling.
    profile: share.budgetShared ? structuredClone(share.profile)
      : { ...structuredClone(share.profile), targetBudget: DEFAULT_PROFILE.targetBudget, maximumBudget: DEFAULT_PROFILE.maximumBudget },
    mode: share.mode,
    release: share.release,
    ...(share.notes ? { notes: share.notes } : {}),
    evidence: share.candidates.map((id) => ({
      geographyId: id,
      name: share.candidateNames[id] ?? id,
      score: null,
      excluded: false,
      evidenceCompleteness: 0,
    })),
  };
}

export function resolveShortlistCandidates(
  shortlist: SavedShortlist,
  pack: MatchPack,
): ShortlistResolution {
  const matched: MatchResult[] = [];
  const missing: ShortlistResolution["missing"] = [];
  for (const id of shortlist.candidates) {
    const result = pack.values.find((candidate) => candidate.geographyId === id);
    if (result) matched.push(result);
    else missing.push({ geographyId: id, name: shortlist.candidateNames[id] ?? id, reason: "removed-or-renamed" });
  }
  return {
    matched,
    missing,
    release: shortlist.release,
    releaseAvailable: pack.sourceReleaseSet === shortlist.release,
  };
}

export function isShortlistReleaseAvailable(
  shortlist: SavedShortlist,
  availableReleases: string[],
): boolean {
  return availableReleases.includes(shortlist.release);
}

interface ShareEnvelope {
  schemaVersion: string;
  name: unknown;
  candidates: unknown;
  candidateNames?: Record<string, string>;
  mode: unknown;
  release: unknown;
  notes?: unknown;
  redacted?: unknown;
  include?: { places?: unknown; budget?: unknown; notes?: unknown };
  ref?: unknown;
  scores?: unknown;
  profileFragment: string;
}

interface StoredState {
  store: Storage;
  main: string | null;
  denied: boolean;
}

export function refreshShortlistEvidence(
  shortlist: SavedShortlist,
  pack: MatchPack,
): SavedShortlist {
  const names: Record<string, string> = { ...shortlist.candidateNames };
  for (const result of pack.values) {
    if (shortlist.candidates.includes(result.geographyId)) names[result.geographyId] = result.name;
  }
  const savedById = new Map(shortlist.evidence.map((entry) => [entry.geographyId, entry]));
  return {
    ...structuredClone(shortlist),
    updatedAt: freshTimestamp(shortlist.updatedAt),
    candidateNames: names,
    evidence: shortlist.candidates.map((id) => {
      const result = pack.values.find((candidate) => candidate.geographyId === id);
      const saved = savedById.get(id);
      if (!result) {
        if (!saved) throw new Error(`shortlist unknown area: ${id}`);
        return saved;
      }
      return {
        geographyId: id,
        name: result.name || names[id] || id,
        score: result.score,
        excluded: result.excluded,
        evidenceCompleteness: result.evidenceCompleteness,
      };
    }),
  };
}

function createShortlistId(): string {
  const random = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (random) return `shortlist-${random()}`;
  return `shortlist-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function freshTimestamp(previous: string): string {
  const now = new Date().toISOString();
  if (!previous || now > previous) return now;
  const bumped = Date.parse(previous) + 1;
  return Number.isFinite(bumped) ? new Date(bumped).toISOString() : now;
}

function cleanName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 80) {
    throw new Error("shortlist needs a name of 1-80 characters");
  }
  return value.trim();
}

function cleanCandidates(value: unknown): GeographyId[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SHORTLIST_CANDIDATES) {
    throw new Error("shortlist needs 1-4 candidate areas");
  }
  const ids = value.map((entry) => {
    if (typeof entry !== "string" || !/^uk:(lsoa|msoa|lad):E\d{8}$/.test(entry)) {
      throw new Error(`shortlist unknown area: ${String(entry)}`);
    }
    return entry as GeographyId;
  });
  if (new Set(ids).size !== ids.length) throw new Error("shortlist needs distinct areas");
  return ids;
}

function cleanMode(value: unknown): DataMode {
  if (value !== "demo" && value !== "real") throw new Error("shortlist needs a data mode");
  return value;
}

function cleanRelease(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 64) {
    throw new Error("shortlist needs a release reference");
  }
  return value.trim();
}

function cleanNotes(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > MAX_SHORTLIST_NOTES_LENGTH) {
    throw new Error("shortlist notes hold at most 500 characters");
  }
  return value;
}

function readStorage(): StoredState {
  if (typeof window === "undefined") return { store: null as never, main: null, denied: true };
  try {
    const store = window.localStorage;
    return { store, main: store.getItem(SAVED_SHORTLISTS_KEY), denied: false };
  } catch {
    return { store: null as never, main: null, denied: true };
  }
}

function adoptLegacyEntries(storage: StoredState): SavedShortlist[] {
  const migrated: SavedShortlist[] = [];
  for (const key of LEGACY_SHORTLIST_KEYS) {
    const raw = readLegacyKey(storage, key);
    if (raw === null) continue;
    const { migrated: entries } = migrateLegacyShortlists(normalizeLegacyStored(parseLegacyRaw(raw)));
    migrated.push(...entries);
    removeLegacyKey(storage, key);
  }
  return migrated;
}

function readLegacyKey(storage: StoredState, key: string): string | null {
  try {
    return storage.store.getItem(key);
  } catch {
    return null;
  }
}

function removeLegacyKey(storage: StoredState, key: string): void {
  try {
    storage.store.removeItem(key);
  } catch {
    return;
  }
}

function normalizeLegacyStored(parsed: unknown): unknown {
  if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) return [parsed];
  return parsed;
}

function parseLegacyRaw(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function persistShortlists(store: Storage, shortlists: SavedShortlist[]): void {
  try {
    store.setItem(SAVED_SHORTLISTS_KEY, JSON.stringify(shortlists));
  } catch {
    return;
  }
}

function parseStoredList(raw: string | null): { shortlists: SavedShortlist[]; corrupted: boolean } {
  if (!raw) return { shortlists: [], corrupted: false };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { shortlists: [], corrupted: true };
    const shortlists: SavedShortlist[] = [];
    let corrupted = false;
    for (const entry of parsed) {
      const shortlist = parseShortlistValue(entry);
      if (shortlist) shortlists.push(shortlist);
      else corrupted = true;
    }
    return { shortlists, corrupted };
  } catch {
    return { shortlists: [], corrupted: true };
  }
}

function parseShortlistValue(value: unknown): SavedShortlist | null {
  try {
    return assertShortlist(value as SavedShortlist);
  } catch {
    return null;
  }
}

function assertShortlist(value: SavedShortlist): SavedShortlist {
  if (!value || typeof value !== "object" || value.schemaVersion !== SHORTLIST_SCHEMA) {
    throw new Error("unknown shortlist version");
  }
  if (typeof value.id !== "string" || value.id.length === 0) throw new Error("shortlist needs an id");
  const evidence = Array.isArray(value.evidence) ? value.evidence.map(assertSnapshot) : null;
  if (!evidence) throw new Error("shortlist needs an evidence snapshot");
  return {
    schemaVersion: SHORTLIST_SCHEMA,
    id: value.id,
    name: cleanName(value.name),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    candidates: cleanCandidates(value.candidates),
    candidateNames: value.candidateNames ?? {},
    profile: assertPreferenceProfile(value.profile),
    mode: cleanMode(value.mode),
    release: cleanRelease(value.release),
    ...(cleanNotes(value.notes) ? { notes: cleanNotes(value.notes) } : {}),
    evidence,
  };
}

function assertSnapshot(value: ShortlistCandidateSnapshot): ShortlistCandidateSnapshot {
  if (!value || typeof value !== "object") throw new Error("shortlist snapshot entry invalid");
  cleanCandidates([value.geographyId]);
  if (typeof value.name !== "string") throw new Error("shortlist snapshot entry invalid");
  if (value.score !== null && typeof value.score !== "number") throw new Error("shortlist snapshot entry invalid");
  return {
    geographyId: value.geographyId,
    name: value.name,
    score: value.score,
    excluded: value.excluded === true,
    evidenceCompleteness: typeof value.evidenceCompleteness === "number" ? value.evidenceCompleteness : 0,
  };
}

function migrateLegacyEntry(entry: unknown): SavedShortlist | null {
  try {
    if (Array.isArray(entry)) return migrateIdList(entry);
    if (entry && typeof entry === "object") {
      const candidate = entry as Record<string, unknown>;
      if (candidate.schemaVersion === SHORTLIST_SCHEMA) return assertShortlist(candidate as unknown as SavedShortlist);
      return migrateV0Object(candidate);
    }
    return null;
  } catch {
    return null;
  }
}

function migrateIdList(ids: unknown[]): SavedShortlist {
  return migratedShortlist({
    name: "Recovered shortlist",
    candidates: cleanCandidates(ids),
    candidateNames: {},
    profile: structuredClone(DEFAULT_PROFILE),
    mode: "demo",
    release: "preview-2026-09",
  });
}

function migrateV0Object(candidate: Record<string, unknown>): SavedShortlist | null {
  const ids = candidate.areas ?? candidate.candidates ?? candidate.geographyIds;
  const profile = candidate.profile as PreferenceProfile | undefined;
  if (!ids || !profile) return null;
  return migratedShortlist({
    name: typeof candidate.name === "string" ? candidate.name : "Recovered shortlist",
    candidates: cleanCandidates(ids),
    candidateNames: (candidate.candidateNames as Record<string, string>) ?? {},
    profile,
    mode: candidate.mode ?? "demo",
    release: candidate.release ?? "preview-2026-09",
    ...(typeof candidate.notes === "string" ? { notes: candidate.notes } : {}),
  });
}

function migratedShortlist(input: {
  name: unknown;
  candidates: GeographyId[];
  candidateNames: Record<string, string>;
  profile: PreferenceProfile;
  mode: unknown;
  release: unknown;
  notes?: string;
}): SavedShortlist {
  const now = new Date().toISOString();
  return {
    schemaVersion: SHORTLIST_SCHEMA,
    id: createShortlistId(),
    name: cleanName(input.name),
    createdAt: now,
    updatedAt: now,
    candidates: input.candidates,
    candidateNames: input.candidateNames,
    profile: assertPreferenceProfile(structuredClone(input.profile)),
    mode: cleanMode(input.mode),
    release: cleanRelease(input.release),
    ...(cleanNotes(input.notes) ? { notes: cleanNotes(input.notes) } : {}),
    evidence: input.candidates.map((id) => ({
      geographyId: id,
      name: input.candidateNames[id] ?? id,
      score: null,
      excluded: false,
      evidenceCompleteness: 0,
    })),
  };
}

function toBase64Url(value: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): unknown {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

/**
 * How many distinct areas a stored saved-shortlists value holds (the subpage
 * header's "Saved areas (N)"). Reads only; 0 for nothing, junk or no storage.
 */
export function readSavedAreaCount(raw: string | null): number {
  if (!raw) return 0;
  try {
    const lists = JSON.parse(raw) as unknown;
    if (!Array.isArray(lists)) return 0;
    const ids = new Set<string>();
    for (const list of lists) {
      const candidates = (list as { candidates?: unknown } | null)?.candidates;
      if (Array.isArray(candidates)) for (const id of candidates) if (typeof id === "string") ids.add(id);
    }
    return ids.size;
  } catch {
    return 0;
  }
}
