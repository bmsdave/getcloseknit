// AE-29: user-entered property candidates without a listings feed.
// Every entered field stays unverified with its observation date; links to
// official transactions happen only through the AE-11 identity methods
// (verified-uprn, cautious-address, unresolved), and asking figures are
// never merged with achieved prices. Nothing here fetches photos,
// descriptions, or listing data, and nothing infers days on market.
import type { GeographyId, PropertyHistory, SaleRecord } from "./contracts";
import { MAX_SHORTLIST_NOTES_LENGTH } from "./saved-shortlists";

export const USER_CANDIDATES_KEY = "close-knit.user-candidates.v1";
export const USER_CANDIDATE_SCHEMA = "user-candidate.v1";
export const USER_CANDIDATE_STORE_SCHEMA = "user-candidate-store.v1";

export type CandidateMatchMethod = "verified-uprn" | "cautious-address" | "unresolved";
export type AskingKind = "sale" | "rent";
export type PriceUnit = "gbp-total" | "gbp-per-month";

export interface UnverifiedField<T> {
  value: T;
  verification: "unverified";
  observedAt: string;
}

export interface KnownAddress {
  uprn: string | null;
  address: string;
  geographyId: GeographyId;
}

export interface UserCandidateInput {
  addressText: string;
  uprn?: string | null;
  referenceUrl?: string;
  askingKind: AskingKind;
  /** Null when the home is saved before the reader has the asking price (it can be added later). */
  askingAmount: number | null;
  priceUnit: PriceUnit;
  bedrooms?: number | null;
  floorAreaSqm?: number | null;
  notes?: string;
}

export type CandidateLinkage =
  | { status: "linked"; identityId: string; matchMethod: CandidateMatchMethod; confidence: number }
  | { status: "unlinked"; reason: "unknown-address" | "ambiguous-address"; options?: string[] };

export interface UserCandidate {
  schemaVersion: typeof USER_CANDIDATE_SCHEMA;
  id: string;
  address: UnverifiedField<string>;
  uprn: string | null;
  geographyId: GeographyId | null;
  referenceUrl: UnverifiedField<string> | null;
  /** Null for a home saved without an asking price yet. */
  asking: UnverifiedField<{ kind: AskingKind; amount: number; unit: PriceUnit }> | null;
  bedrooms: UnverifiedField<number> | null;
  floorAreaSqm: UnverifiedField<number> | null;
  notes: UnverifiedField<string> | null;
  linkage: CandidateLinkage;
  createdAt: string;
  updatedAt: string;
}

export type BuildCandidateResult =
  | { ok: true; candidate: UserCandidate }
  | { ok: false; reason: "invalid-price-units" | "invalid-price" | "malformed-url" | "duplicate-candidate" };

export interface CandidateConflict {
  kind: "user-area-vs-epc" | "asking-vs-achieved";
  detail: string;
}

export interface CandidateOfficial {
  history: SaleRecord | null;
  epcAreasSqm: number[];
}

export interface AskingVsAchieved {
  asking: { label: string; amount: number; unit: string } | null;
  achieved: { date: string; nominalPrice: number }[];
  note: string;
}

export interface CandidateEdit {
  askingAmount?: number;
  priceUnit?: PriceUnit;
  bedrooms?: number | null;
  floorAreaSqm?: number | null;
  notes?: string;
  referenceUrl?: string;
}

export type EditCandidateResult =
  | { ok: true; candidate: UserCandidate }
  | { ok: false; reason: "invalid-price-units" | "invalid-price" | "malformed-url" };

export function normalizeCandidateAddress(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).join(" ");
}

export function buildUserCandidate(
  input: UserCandidateInput,
  directory: KnownAddress[],
  existing: UserCandidate[] = [],
  now: string = new Date().toISOString(),
): BuildCandidateResult {
  const priceError = input.askingAmount === null ? null : checkAsking(input.askingKind, input.askingAmount, input.priceUnit);
  if (priceError) return { ok: false, reason: priceError };
  const urlError = checkReferenceUrl(input.referenceUrl);
  if (urlError) return { ok: false, reason: urlError };
  if (isDuplicateCandidate(input, existing)) return { ok: false, reason: "duplicate-candidate" };
  return { ok: true, candidate: assembleCandidate(input, directory, now) };
}

export function resolveCandidateLinkage(candidate: UserCandidate, directory: KnownAddress[]): CandidateLinkage {
  const verified = candidate.uprn === null ? null
    : directory.find((entry) => entry.uprn !== null && entry.uprn === candidate.uprn) ?? null;
  if (verified) return linkedIdentity(verified.uprn ?? candidate.uprn ?? "", "verified-uprn", 1);
  const address = normalizeCandidateAddress(candidate.address.value);
  const matches = directory.filter((entry) => normalizeCandidateAddress(entry.address) === address);
  if (matches.length === 1 && matches[0]) return addressLinkage(matches[0]);
  if (matches.length > 1) return ambiguousLinkage(matches);
  const building = directory.filter((entry) => buildingKey(entry.address) === address);
  if (building.length > 1) return ambiguousLinkage(building);
  return { status: "unlinked", reason: "unknown-address" };
}

export function editUserCandidate(candidate: UserCandidate, patch: CandidateEdit, now: string = new Date().toISOString()): EditCandidateResult {
  const kind = candidate.asking?.value.kind ?? "sale";
  const amount = patch.askingAmount ?? candidate.asking?.value.amount ?? null;
  const unit = patch.priceUnit ?? candidate.asking?.value.unit ?? (kind === "sale" ? "gbp-total" : "gbp-per-month");
  const priceError = amount === null ? null : checkAsking(kind, amount, unit);
  if (priceError) return { ok: false, reason: priceError };
  if (patch.referenceUrl !== undefined) {
    const urlError = checkReferenceUrl(patch.referenceUrl);
    if (urlError) return { ok: false, reason: urlError };
  }
  return { ok: true, candidate: applyEdit(candidate, patch, amount, unit, now) };
}

export function candidateConflicts(candidate: UserCandidate, official: CandidateOfficial): CandidateConflict[] {
  if (candidate.linkage.status !== "linked" || !official.history) return [];
  return [...areaConflicts(candidate, official.epcAreasSqm), ...askingConflicts(candidate, official.history)];
}

export function describeAskingVsAchieved(candidate: UserCandidate, history: SaleRecord | null): AskingVsAchieved {
  const asking = candidate.asking?.value ?? null;
  return {
    asking: asking && {
      label: asking.kind === "sale" ? "Asking price (you entered, unverified)" : "Asking rent (you entered, unverified)",
      amount: asking.amount,
      unit: asking.unit === "gbp-total" ? "£ total" : "£ per month",
    },
    achieved: (history?.transactions ?? []).map((entry) => ({ date: entry.date, nominalPrice: entry.nominalPrice })),
    note: "Your entered asking figure is unverified and shown separately; achieved prices are official records and the two are never combined.",
  };
}

export function directoryFromFixtures(
  results: { id: string; geographyId: GeographyId; uprn: string | null }[],
  histories: PropertyHistory[],
): KnownAddress[] {
  const addresses = new Map(histories.map((history) => [history.uprn, history.address]));
  return results
    .filter((result) => addresses.has(result.uprn ?? ""))
    .map((result) => ({
      uprn: result.uprn,
      address: addresses.get(result.uprn ?? "") ?? result.id,
      geographyId: result.geographyId,
    }));
}

export interface CandidateStore {
  schemaVersion: typeof USER_CANDIDATE_STORE_SCHEMA;
  candidates: UserCandidate[];
}

export function emptyCandidateStore(): CandidateStore {
  return { schemaVersion: USER_CANDIDATE_STORE_SCHEMA, candidates: [] };
}

export function loadUserCandidates(): { store: CandidateStore; corrupted: boolean; storageDenied: boolean } {
  if (typeof window === "undefined") return { store: emptyCandidateStore(), corrupted: false, storageDenied: true };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(USER_CANDIDATES_KEY);
  } catch {
    return { store: emptyCandidateStore(), corrupted: false, storageDenied: true };
  }
  if (raw === null) return { store: emptyCandidateStore(), corrupted: false, storageDenied: false };
  try {
    return { store: assertCandidateStore(JSON.parse(raw) as unknown), corrupted: false, storageDenied: false };
  } catch {
    return { store: emptyCandidateStore(), corrupted: true, storageDenied: false };
  }
}

export function saveUserCandidates(store: CandidateStore): { ok: true } | { ok: false; reason: "storage-denied" } {
  if (typeof window === "undefined") return { ok: false, reason: "storage-denied" };
  try {
    window.localStorage.setItem(USER_CANDIDATES_KEY, JSON.stringify(store));
  } catch {
    return { ok: false, reason: "storage-denied" };
  }
  return { ok: true };
}

type PriceError = "invalid-price-units" | "invalid-price";

function checkAsking(kind: AskingKind, amount: number, unit: PriceUnit): PriceError | null {
  const expected: PriceUnit = kind === "sale" ? "gbp-total" : "gbp-per-month";
  if (unit !== expected) return "invalid-price-units";
  if (!Number.isFinite(amount) || amount <= 0) return "invalid-price";
  return null;
}

function checkReferenceUrl(referenceUrl: string | undefined): "malformed-url" | null {
  if (referenceUrl === undefined || referenceUrl.trim() === "") return null;
  try {
    const parsed = new URL(referenceUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "malformed-url";
  } catch {
    return "malformed-url";
  }
  return null;
}

function isDuplicateCandidate(input: UserCandidateInput, existing: UserCandidate[]): boolean {
  const address = normalizeCandidateAddress(input.addressText);
  return existing.some((candidate) =>
    normalizeCandidateAddress(candidate.address.value) === address
    && (candidate.asking?.value.kind ?? input.askingKind) === input.askingKind
    && (candidate.asking?.value.amount ?? null) === input.askingAmount);
}

function assembleCandidate(input: UserCandidateInput, directory: KnownAddress[], now: string): UserCandidate {
  const draft: UserCandidate = {
    schemaVersion: USER_CANDIDATE_SCHEMA,
    id: `candidate-${normalizeCandidateAddress(input.addressText).replaceAll(" ", "-").slice(0, 48)}`,
    address: unverified(input.addressText.trim(), now),
    uprn: input.uprn ?? null,
    geographyId: null,
    referenceUrl: input.referenceUrl?.trim() ? unverified(input.referenceUrl.trim(), now) : null,
    asking: input.askingAmount === null ? null : unverified({ kind: input.askingKind, amount: input.askingAmount, unit: input.priceUnit }, now),
    bedrooms: input.bedrooms == null ? null : unverified(input.bedrooms, now),
    floorAreaSqm: input.floorAreaSqm == null ? null : unverified(input.floorAreaSqm, now),
    notes: input.notes?.trim() ? unverified(input.notes.trim().slice(0, MAX_SHORTLIST_NOTES_LENGTH), now) : null,
    linkage: { status: "unlinked", reason: "unknown-address" },
    createdAt: now,
    updatedAt: now,
  };
  const linkage = resolveCandidateLinkage(draft, directory);
  const geographyId = linkage.status === "linked"
    ? (directory.find((entry) => entry.uprn === draft.uprn)?.geographyId ?? singleMatchArea(draft, directory))
    : singleMatchArea(draft, directory);
  return { ...draft, linkage, geographyId };
}

function buildingKey(address: string): string {
  return normalizeCandidateAddress(address).replace(/^(flat|apartment|unit) [a-z0-9]+ /, "");
}

function ambiguousLinkage(matches: KnownAddress[]): CandidateLinkage {
  return { status: "unlinked", reason: "ambiguous-address", options: matches.map((entry) => entry.address) };
}

function addressLinkage(match: KnownAddress): CandidateLinkage {
  if (match.uprn) return linkedIdentity(match.uprn, "cautious-address", 0.6);
  return linkedIdentity(`addr-${normalizeCandidateAddress(match.address).replaceAll(" ", "-")}`, "cautious-address", 0.6);
}

function linkedIdentity(identityId: string, matchMethod: CandidateMatchMethod, confidence: number): CandidateLinkage {
  return { status: "linked", identityId, matchMethod, confidence };
}

function singleMatchArea(candidate: UserCandidate, directory: KnownAddress[]): GeographyId | null {
  const matches = directory.filter((entry) =>
    normalizeCandidateAddress(entry.address) === normalizeCandidateAddress(candidate.address.value));
  return matches.length === 1 && matches[0] ? matches[0].geographyId : null;
}

function areaConflicts(candidate: UserCandidate, epcAreasSqm: number[]): CandidateConflict[] {
  if (candidate.floorAreaSqm === null) return [];
  const userArea = candidate.floorAreaSqm.value;
  const conflicting = epcAreasSqm.filter((area) => areasConflict(userArea, area));
  if (conflicting.length === 0) return [];
  return [{
    kind: "user-area-vs-epc",
    detail: `You entered ${userArea} sqm but official certificates record ${conflicting.join(", ")} sqm; neither is adopted over the other.`,
  }];
}

function askingConflicts(candidate: UserCandidate, history: SaleRecord): CandidateConflict[] {
  const latest = history.transactions.at(-1);
  if (!latest || candidate.asking?.value.kind !== "sale") return [];
  const direction = candidate.asking.value.amount >= latest.nominalPrice ? "above" : "below";
  return [{
    kind: "asking-vs-achieved",
    detail: `Your entered asking price is ${direction} the latest achieved price of £${latest.nominalPrice.toLocaleString("en-GB")} (${latest.date}); asking and achieved stay separate figures.`,
  }];
}

function areasConflict(first: number, second: number): boolean {
  const spread = Math.abs(first - second);
  if (spread > 2) return true;
  const smallest = Math.min(first, second);
  return smallest > 0 && spread / smallest > 0.05;
}

function applyEdit(candidate: UserCandidate, patch: CandidateEdit, amount: number | null, unit: PriceUnit, now: string): UserCandidate {
  const kind = candidate.asking?.value.kind ?? "sale";
  return {
    ...candidate,
    asking: amount === null ? candidate.asking : { value: { kind, amount, unit }, verification: "unverified", observedAt: now },
    bedrooms: patch.bedrooms === undefined ? candidate.bedrooms : optionalField(patch.bedrooms, now),
    floorAreaSqm: patch.floorAreaSqm === undefined ? candidate.floorAreaSqm : optionalField(patch.floorAreaSqm, now),
    notes: patch.notes === undefined ? candidate.notes : textField(patch.notes, now),
    referenceUrl: patch.referenceUrl === undefined ? candidate.referenceUrl : textField(patch.referenceUrl, now),
    updatedAt: now,
  };
}

function optionalField(value: number | null, now: string): UnverifiedField<number> | null {
  return value === null ? null : unverified(value, now);
}

function textField(value: string, now: string): UnverifiedField<string> | null {
  return value.trim() === "" ? null : unverified(value.trim().slice(0, MAX_SHORTLIST_NOTES_LENGTH), now);
}

function unverified<T>(value: T, observedAt: string): UnverifiedField<T> {
  return { value, verification: "unverified", observedAt };
}

function assertCandidateStore(value: unknown): CandidateStore {
  if (!value || typeof value !== "object") throw new Error("candidate store must be an object");
  const store = value as CandidateStore;
  if (store.schemaVersion !== USER_CANDIDATE_STORE_SCHEMA) throw new Error("unknown candidate store version");
  if (!Array.isArray(store.candidates)) throw new Error("candidate store needs candidates");
  return store;
}
