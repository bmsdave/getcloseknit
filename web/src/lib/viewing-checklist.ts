// AE-28: viewing and area checklist. Every question is generated from an
// explicit user priority or a concrete gap in the evidence — never generic
// advice. Observations stay private on the device and reuse the shortlist
// notes limit (AE-27). A checked box records the user's own observation;
// completion never presents a property as surveyed, safe, or legally
// verified, so those verdicts appear nowhere in this module's copy.
import type {
  GeographyId,
  PreferenceProfile,
  SaleRecord,
} from "./contracts";
import {
  hasLeaseEvidence,
  tenureWithoutLeaseEvidence,
  type LeaseholdFacts,
} from "./leasehold";
import {
  type AreaVisit,
  type NoiseScreening,
  type VisitSlot,
} from "./noise-evidence";
import { MAX_SHORTLIST_NOTES_LENGTH } from "./saved-shortlists";

export const VIEWING_CHECKLIST_KEY = "close-knit.viewing-checklist.v1";
export const VIEWING_CHECKLIST_SCHEMA = "viewing-checklist.v1";
export const ROUTE_PLANNER_URL = "https://tfl.gov.uk/plan-a-journey/";

export type ViewingStatus = "unvisited" | "checked" | "unresolved";

export type ViewingQuestionKind =
  | "commute-trial"
  | "evening-visit"
  | "noise-observation"
  | "room-layout"
  | "survey"
  | "lease-documents"
  | "total-cost"
  | "damp-mould";

export interface ViewingQuestion {
  id: string;
  kind: ViewingQuestionKind;
  /** A few words for the list; the full question sits behind its (?). */
  label: string;
  text: string;
}

export interface ViewingCandidate {
  id: GeographyId;
  name: string;
}

export interface ViewingEvidence {
  profile: PreferenceProfile;
  lease: LeaseholdFacts;
  history: SaleRecord | null;
  noise: NoiseScreening | null;
  costUnknowns: string[];
}

export function buildViewingChecklist(
  candidate: ViewingCandidate,
  evidence: ViewingEvidence,
  options: { redactDestinations?: boolean } = {},
): ViewingQuestion[] {
  return [
    ...commuteTrialQuestions(evidence.profile, options.redactDestinations ?? false),
    ...eveningVisitQuestion(candidate, evidence.noise),
    ...noiseObservationQuestion(candidate, evidence.noise),
    ...layoutQuestion(evidence.history),
    ...surveyQuestion(evidence.history),
    ...leaseDocumentsQuestion(evidence.lease),
    ...totalCostQuestion(evidence),
    ...dampMouldQuestion(evidence.profile),
  ];
}

function commuteTrialQuestions(profile: PreferenceProfile, redactDestinations: boolean): ViewingQuestion[] {
  return profile.commuteDestinations.map((destination, index) => ({
    id: `commute-trial-${index + 1}`,
    kind: "commute-trial",
    label: `Commute to ${redactDestinations ? "your destination" : `\u201c${destination.label}\u201d`}`,
    text: `Ride the real commute to ${redactDestinations ? "your commute destination" : `\u201c${destination.label}\u201d`} ` +
      `(${destination.mode}, arrive ${destination.arrivalTime}) before ` +
      "deciding \u2014 the map shows a typical weekday, not your door to door.",
  }));
}

function eveningVisitQuestion(
  candidate: ViewingCandidate,
  noise: NoiseScreening | null,
): ViewingQuestion[] {
  if (noise?.status !== "mapped-exposure" || noise.band === null) return [];
  return [{
    id: "evening-visit",
    kind: "evening-visit",
    label: "Visit in the evening",
    text: `Revisit ${candidate.name} in the evening: the mapped ${noise.band} ` +
      `${noise.unit} band is a day average and says nothing about the ` +
      "evening peak outside it.",
  }];
}

function noiseObservationQuestion(
  candidate: ViewingCandidate,
  noise: NoiseScreening | null,
): ViewingQuestion[] {
  if (noise === null) return [];
  return [{ id: "noise-observation", kind: "noise-observation", label: "Listen on the visit", text: noisePrompt(candidate, noise) }];
}

function noisePrompt(candidate: ViewingCandidate, noise: NoiseScreening): string {
  if (noise.status === "mapped-exposure" && noise.band !== null) {
    return `Listen at ${candidate.name} itself: a mapped ${noise.band} band ` +
      "never predicts what a home sounds like \u2014 windows, floor, and the " +
      "side of the street all change it.";
  }
  if (noise.status === "no-mapped-exposure") {
    return `${candidate.name} sits between the mapped road corridors, so no ` +
      "modelled band applies here. Treat noise as unknown, not quiet \u2014 " +
      "listen on the visit.";
  }
  return `${candidate.name} is outside the reviewed road-noise coverage, so ` +
    "noise exposure is unknown here, not quiet.";
}

function layoutQuestion(history: SaleRecord | null): ViewingQuestion[] {
  const dates = (history?.transactions ?? [])
    .filter((transaction) => transaction.floorAreaSquareMetres === null)
    .map((transaction) => transaction.date);
  if (history === null || dates.length === 0) return [];
  return [{
    id: "room-layout",
    kind: "room-layout",
    label: "Check the room layout",
    text: `Floor area was not recorded for the ${dates.join(", ")} sale at ` +
      `${history.address}: check the room layout and storage against your ` +
      "needs on the viewing.",
  }];
}

function surveyQuestion(history: SaleRecord | null): ViewingQuestion[] {
  if (history === null || history.transactions.length === 0) return [];
  return [{
    id: "survey",
    kind: "survey",
    label: "Get an independent survey",
    text: `No map or price record can confirm structure or damp at ` +
      `${history.address}: instruct an independent survey before relying on ` +
      "anything you see on the visit.",
  }];
}

function leaseDocumentsQuestion(lease: LeaseholdFacts): ViewingQuestion[] {
  if (!needsLeaseEvidence(lease)) return [];
  return [{
    id: "lease-documents",
    kind: "lease-documents",
    label: "Read the lease documents",
    text: "Lease paperwork is still open here: confirm the expiry, charges, " +
      "and notices in the lease documents \u2014 a tenure flag is not an answer.",
  }];
}

function needsLeaseEvidence(lease: LeaseholdFacts): boolean {
  if (tenureWithoutLeaseEvidence(lease)) return true;
  const tenure = (lease.transactionTenure ?? "").trim().toLowerCase();
  const leaseholdish = tenure === "leasehold" || tenure === "share of freehold";
  return leaseholdish && lease.leaseExpiry.value === null;
}

function totalCostQuestion(evidence: ViewingEvidence): ViewingQuestion[] {
  const open = [...evidence.costUnknowns, ...chargeUnknowns(evidence)];
  if (open.length === 0) return [];
  return [{
    id: "total-cost",
    kind: "total-cost",
    label: "Confirm the total costs",
    text: `Total-cost unknowns still open: ${open.join(", ")}. Confirm each ` +
      "before budgeting \u2014 an unknown is never zero.",
  }];
}

// Renting is the explicit context: no rent index or listing records damp,
// and it is the defect renters most often meet, so a renter always gets it.
function dampMouldQuestion(profile: PreferenceProfile): ViewingQuestion[] {
  if (profile.market !== "rent") return [];
  return [{
    id: "damp-mould",
    kind: "damp-mould",
    label: "Check for damp and mould",
    text: "Look for damp and mould on the viewing: inside cupboards, behind furniture, around " +
      "windows and on bathroom ceilings. Fresh paint can hide it, so ask how any past mould was treated.",
  }];
}

function chargeUnknowns(evidence: ViewingEvidence): string[] {
  if (evidence.profile.market !== "buy") return [];
  if (!needsLeaseEvidence(evidence.lease) && !hasLeaseEvidence(evidence.lease)) return [];
  return leaseChargeUnknowns(evidence.lease);
}

export function leaseChargeUnknowns(lease: LeaseholdFacts): string[] {
  const open: string[] = [];
  if (lease.serviceChargeAnnual.value === null) open.push("service charge");
  if (lease.groundRentAnnual.value === null) open.push("ground rent");
  if (lease.majorWorksNotice.value === null) open.push("major works notices");
  return open;
}

export interface ViewingQuestionState {
  status: ViewingStatus;
  note: string;
  updatedAt: string;
}

export interface ViewingCandidateState {
  questions: Record<string, ViewingQuestionState>;
  visits: AreaVisit[];
}

export interface ViewingPlanStore {
  schemaVersion: typeof VIEWING_CHECKLIST_SCHEMA;
  candidates: Record<string, ViewingCandidateState>;
}

export interface ViewingPlanLoad {
  store: ViewingPlanStore;
  corrupted: boolean;
  storageDenied: boolean;
}

export type ViewingPlanWrite =
  | { ok: true }
  | { ok: false; reason: "storage-denied" };

export function emptyViewingStore(): ViewingPlanStore {
  return { schemaVersion: VIEWING_CHECKLIST_SCHEMA, candidates: {} };
}

export function questionState(
  store: ViewingPlanStore,
  candidateId: string,
  questionId: string,
): ViewingQuestionState {
  return store.candidates[candidateId]?.questions[questionId] ?? defaultQuestionState();
}

export function setQuestionStatus(
  store: ViewingPlanStore,
  candidateId: string,
  questionId: string,
  status: ViewingStatus,
): ViewingPlanStore {
  const next = structuredClone(store);
  const current = ensureCandidate(next, candidateId).questions[questionId]
    ?? defaultQuestionState();
  ensureCandidate(next, candidateId).questions[questionId] = {
    ...current, status, updatedAt: new Date().toISOString(),
  };
  return next;
}

export function setQuestionNote(
  store: ViewingPlanStore,
  candidateId: string,
  questionId: string,
  note: string,
): ViewingPlanStore {
  const next = structuredClone(store);
  const current = ensureCandidate(next, candidateId).questions[questionId]
    ?? defaultQuestionState();
  ensureCandidate(next, candidateId).questions[questionId] = {
    ...current,
    note: note.trim().slice(0, MAX_SHORTLIST_NOTES_LENGTH),
    updatedAt: new Date().toISOString(),
  };
  return next;
}

export function recordCandidateVisit(
  store: ViewingPlanStore,
  candidateId: string,
  slot: VisitSlot,
): ViewingPlanStore {
  const next = structuredClone(store);
  const candidate = ensureCandidate(next, candidateId);
  candidate.visits = [...candidate.visits, { id: nextVisitId(candidate.visits), slot, noteId: null }];
  return next;
}

export function loadViewingPlan(): ViewingPlanLoad {
  if (typeof window === "undefined") return { store: emptyViewingStore(), corrupted: false, storageDenied: true };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(VIEWING_CHECKLIST_KEY);
  } catch {
    return { store: emptyViewingStore(), corrupted: false, storageDenied: true };
  }
  if (raw === null) return { store: emptyViewingStore(), corrupted: false, storageDenied: false };
  try {
    return { store: assertViewingStore(JSON.parse(raw) as unknown), corrupted: false, storageDenied: false };
  } catch {
    return { store: emptyViewingStore(), corrupted: true, storageDenied: false };
  }
}

export function saveViewingPlan(store: ViewingPlanStore): ViewingPlanWrite {
  if (typeof window === "undefined") return { ok: false, reason: "storage-denied" };
  try {
    window.localStorage.setItem(VIEWING_CHECKLIST_KEY, JSON.stringify(store));
  } catch {
    return { ok: false, reason: "storage-denied" };
  }
  return { ok: true };
}

export interface ViewingGroup {
  key: string;
  label: string;
  members: ViewingCandidate[];
  routeUrl: string | null;
}

export function groupViewingCandidates(
  candidates: ViewingCandidate[],
  /** The deployment's own parent lookup (real mode: the API's parentId); no fixture default. */
  parentOf: (id: GeographyId) => GeographyId | null,
): ViewingGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, ViewingCandidate[]>();
  for (const candidate of candidates) {
    const key = parentOf(candidate.id) ?? `single:${candidate.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)?.push(candidate);
  }
  return order.map((key) => {
    const members = buckets.get(key) ?? [];
    return {
      key,
      label: groupLabel(key, members),
      members,
      routeUrl: members.length > 1 ? ROUTE_PLANNER_URL : null,
    };
  });
}

function groupLabel(key: string, members: ViewingCandidate[]): string {
  if (key.startsWith("single:")) return members[0]?.name ?? key;
  const [, carrier, code] = key.split(":");
  return `Same ${carrier === "lad" ? "borough" : carrier} ${code}: plan one trip for ${members.map((member) => member.name).join(", ")}.`;
}

function defaultQuestionState(): ViewingQuestionState {
  return { status: "unvisited", note: "", updatedAt: new Date().toISOString() };
}

function ensureCandidate(store: ViewingPlanStore, candidateId: string): ViewingCandidateState {
  store.candidates[candidateId] ??= { questions: {}, visits: [] };
  return store.candidates[candidateId];
}

function nextVisitId(visits: AreaVisit[]): string {
  const numbers = visits
    .map((visit) => Number(visit.id.replace(/^visit-/, "")))
    .filter((value) => Number.isInteger(value));
  return `visit-${(numbers.length === 0 ? 0 : Math.max(...numbers)) + 1}`;
}

function assertViewingStore(value: unknown): ViewingPlanStore {
  if (!value || typeof value !== "object") throw new Error("viewing plan must be an object");
  const store = value as ViewingPlanStore;
  if (store.schemaVersion !== VIEWING_CHECKLIST_SCHEMA) throw new Error("unknown viewing plan version");
  if (!store.candidates || typeof store.candidates !== "object") throw new Error("viewing plan needs candidates");
  for (const candidate of Object.values(store.candidates)) assertCandidateState(candidate);
  return store;
}

function assertCandidateState(candidate: ViewingCandidateState): void {
  if (!candidate || typeof candidate !== "object") throw new Error("viewing candidate must be an object");
  if (!candidate.questions || typeof candidate.questions !== "object") throw new Error("viewing candidate needs questions");
  if (!Array.isArray(candidate.visits)) throw new Error("viewing candidate needs visits");
}

export function describeViewingProgress(states: ViewingStatus[]): string {
  if (states.length === 0) {
    return "No viewing questions yet \u2014 questions appear only when your " +
      "priorities or missing evidence call for them.";
  }
  const checked = states.filter((state) => state === "checked").length;
  const unresolved = states.filter((state) => state === "unresolved").length;
  const open = states.length - checked;
  const middle = unresolved > 0
    ? `${open} still open (${unresolved} marked unresolved)`
    : `${open} still open`;
  return `${checked} of ${states.length} questions checked \u00b7 ${middle}. ` +
    "A checked box is your own observation note, not a professional verdict.";
}

// ---- Questions to ask the agent ---------------------------------------------

export interface AgentQuestion { id: string; question: string; why: string }

/** Where the ticks for the short agent checklist are kept (this device only). */
export const AGENT_QUESTIONS_KEY = "close-knit.agent-questions.v1";

/**
 * Five questions to ask the agent before an offer (buyers) or a holding
 * deposit (renters): the facts no public record holds. Short on purpose:
 * the answers go to a solicitor or into the money tools, not into a form.
 */
export function agentQuestions(market: PreferenceProfile["market"]): AgentQuestion[] {
  if (market === "rent") {
    return [
      { id: "damp", question: "Is there any damp and mould, and has it been fixed?", why: "Landlords must deal with it; ask to see where it was." },
      { id: "deposit", question: "Which scheme protects the deposit?", why: "It must be in a government-backed scheme within 30 days." },
      { id: "included", question: "What does the rent include: bills, council tax, furniture?", why: "Council tax and energy often add hundreds a month." },
      { id: "energy", question: "What is the energy certificate rating?", why: "A low rating means higher bills; most lets need E or better." },
      { id: "tenancy", question: "When can I move in, and on what tenancy?", why: "Ask for the tenancy agreement before paying anything." },
    ];
  }
  return [
    { id: "lease", question: "Freehold or leasehold? If leasehold, how many years are left on the lease?", why: "Under 80 years makes a lease costly to extend and harder to mortgage." },
    { id: "service-charge", question: "What is the service charge a year, and what was it the last three years?", why: "Ask for the accounts; sharp rises often point to works." },
    { id: "ground-rent", question: "Is there ground rent, and can it rise?", why: "A rent that doubles can make a home hard to sell." },
    { id: "major-works", question: "Are any major works planned or already billed (roof, lifts, cladding)?", why: "A works bill is shared between the flats and can be large." },
    { id: "energy", question: "What is the energy certificate rating, and how old is it?", why: "A low rating means higher bills; certificates last ten years." },
  ];
}
