// AE-20: leasehold due-diligence evidence. User-entered or document-referenced
// facts only — every fact keeps its source, observation date, and verification
// status. Missing facts stay unknown: this module never fills in reassuring
// defaults, never adjusts a price from the remaining term, and never applies a
// fixed year rule. Historical lease-discount research is context for a
// professional, not an input to any calculation here.
//
// Wave 1 / feature 3 adds three context aids that sit beside the brief, never
// inside it: the remaining-term band (text only — no discount is applied to
// the user's home), the service charge as a share of the price (flags at 1%
// and 2% a year) and building-safety questions keyed to a user-entered height
// (Building Safety Act thresholds at 11 m / 5 storeys and 18 m / 7 storeys).
export type VerificationStatus = "unverified" | "document" | "verified";

export interface EvidenceRef {
  source: string;
  observedAt: string;
  status: VerificationStatus;
}

export interface SourcedFact<T> {
  value: T | null;
  evidence: EvidenceRef | null;
}

export interface LeaseExpiryObservation {
  expiry: string;
  source: string;
  observedAt: string;
  status: VerificationStatus;
}

export interface DiligenceQuestion {
  id: string;
  text: string;
  url: string | null;
  answered: boolean;
}

export interface LeaseholdFacts {
  transactionTenure: string | null;
  leaseExpiry: SourcedFact<string>;
  leaseExpiryAsOf: SourcedFact<string>;
  extraExpiryObservations: LeaseExpiryObservation[];
  serviceChargeAnnual: SourcedFact<number>;
  groundRentAnnual: SourcedFact<number>;
  majorWorksNotice: SourcedFact<string>;
  questions: DiligenceQuestion[];
}

export const EMPTY_LEASEHOLD_FACTS: LeaseholdFacts = {
  transactionTenure: null,
  leaseExpiry: { value: null, evidence: null },
  leaseExpiryAsOf: { value: null, evidence: null },
  extraExpiryObservations: [],
  serviceChargeAnnual: { value: null, evidence: null },
  groundRentAnnual: { value: null, evidence: null },
  majorWorksNotice: { value: null, evidence: null },
  questions: [],
};

// Display-freshness window for a lease observation, in days. A UX prompt to
// re-check — not a legal validity period.
export const OBSERVATION_FRESH_DAYS = 90;

export type LeaseTermState = "unknown" | "conflict" | "stale" | "known";

export interface TermAssessment {
  state: LeaseTermState;
  note: string;
}

export interface GuidanceLink {
  label: string;
  url: string;
  kind: "official-guidance" | "independent-advice";
}

export const GUIDANCE_LINKS: GuidanceLink[] = [
  {
    label: "GOV.UK: Leasehold property — official guidance",
    url: "https://www.gov.uk/leasehold-property",
    kind: "official-guidance",
  },
  {
    label: "LEASE: free initial advice on leasehold",
    url: "https://www.lease-advice.org/",
    kind: "independent-advice",
  },
];

export const PROFESSIONAL_PROMPT =
  "Lease terms need legal interpretation: ask an independent solicitor or " +
  "conveyancer before relying on them.";

export interface DiligenceBrief {
  lines: string[];
  unanswered: DiligenceQuestion[];
  term: TermAssessment;
  guidance: GuidanceLink[];
  professional: string;
}

export function assessLeaseTerm(facts: LeaseholdFacts, today: string = todayIso()): TermAssessment {
  const expiries = [
    facts.leaseExpiry.value,
    ...facts.extraExpiryObservations.map((entry) => entry.expiry),
  ].filter((expiry): expiry is string => expiry !== null);
  if (expiries.length === 0) return unknownTerm();
  if (new Set(expiries).size > 1) return conflictTerm(`sources disagree (${expiries.join(" vs ")})`);
  const expiry = expiries[0];
  const asOf = facts.leaseExpiryAsOf.value;
  if (asOf !== null && asOf > expiry) return conflictTerm(`as-of date ${asOf} is later than expiry ${expiry}`);
  return assessFreshness(facts, expiry, today);
}

export function hasLeaseEvidence(facts: LeaseholdFacts): boolean {
  return facts.leaseExpiry.value !== null
    || facts.extraExpiryObservations.length > 0
    || facts.serviceChargeAnnual.value !== null
    || facts.groundRentAnnual.value !== null
    || facts.majorWorksNotice.value !== null
    || facts.questions.length > 0;
}

export function tenureWithoutLeaseEvidence(facts: LeaseholdFacts): boolean {
  return (facts.transactionTenure ?? "").trim().toLowerCase() === "leasehold"
    && !hasLeaseEvidence(facts);
}

export function unansweredQuestions(facts: LeaseholdFacts): DiligenceQuestion[] {
  return facts.questions.filter((question) => !question.answered);
}

export function addQuestion(questions: DiligenceQuestion[], text: string): DiligenceQuestion[] {
  const trimmed = text.trim();
  if (trimmed === "") return questions;
  return [...questions, { id: nextQuestionId(questions), text: trimmed, url: null, answered: false }];
}

export function attachQuestionUrl(
  questions: DiligenceQuestion[],
  id: string,
  url: string,
): DiligenceQuestion[] {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return questions;
  return questions.map((question) => question.id === id ? { ...question, url: trimmed } : question);
}

export function setQuestionAnswered(
  questions: DiligenceQuestion[],
  id: string,
  answered: boolean,
): DiligenceQuestion[] {
  return questions.map((question) => question.id === id ? { ...question, answered } : question);
}

export function buildDiligenceBrief(facts: LeaseholdFacts, today: string = todayIso()): DiligenceBrief {
  const term = assessLeaseTerm(facts, today);
  const lines = [tenureLine(facts), term.note, ...costLines(facts), ...questionLines(facts)];
  if (tenureWithoutLeaseEvidence(facts)) lines.splice(1, 0, TENURE_WITHOUT_EVIDENCE);
  return { lines, unanswered: unansweredQuestions(facts), term, guidance: GUIDANCE_LINKS, professional: PROFESSIONAL_PROMPT };
}

export type LeaseBandId = "under-80" | "80-99" | "100-125" | "over-125";

export interface LeaseBand {
  id: LeaseBandId;
  label: string;
  context: string;
}

export const LEASE_BANDS: Record<LeaseBandId, LeaseBand> = {
  "under-80": {
    id: "under-80",
    label: "Under 80 years left",
    context: "Extending usually costs noticeably more below 80 years under the current rules, and some " +
      "lenders lend less or not at all. Ask for a lease-extension quote and whether the seller will start " +
      "the statutory extension before exchange.",
  },
  "80-99": {
    id: "80-99",
    label: "80–99 years left",
    context: "Most lenders accept this today, but the lease falls below 80 years within the next two decades. " +
      "Plan for an extension before you would want to sell.",
  },
  "100-125": {
    id: "100-125",
    label: "100–125 years left",
    context: "The term rarely worries lenders at this length; the ground rent terms and service charge matter more.",
  },
  "over-125": {
    id: "over-125",
    label: "Over 125 years left",
    context: "The term itself is rarely the issue (long and share-of-freehold leases sit here); focus on the " +
      "service charge, ground rent and who manages the building.",
  },
};

export const LEASE_BAND_NOTE =
  "Context for a conversation with a solicitor or valuer — no price adjustment is applied to this home.";

/** Whole years from `today` to the lease expiry; null when the expiry is missing or not a date. */
export function yearsRemaining(expiry: string | null, today: string = todayIso()): number | null {
  if (expiry === null || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const days = daysBetween(today, expiry);
  if (!Number.isFinite(days)) return null;
  return Math.max(0, Math.floor(days / 365.25));
}

/** Remaining-term band: <80 / 80–99 / 100–125 / >125 years. */
export function leaseBand(years: number | null): LeaseBand | null {
  if (years === null || !Number.isFinite(years) || years < 0) return null;
  if (years < 80) return LEASE_BANDS["under-80"];
  if (years < 100) return LEASE_BANDS["80-99"];
  if (years <= 125) return LEASE_BANDS["100-125"];
  return LEASE_BANDS["over-125"];
}

export type ServiceChargeFlag = "under-1" | "1-to-2" | "2-plus";

export interface ServiceChargeShare {
  percent: number;
  flag: ServiceChargeFlag;
  note: string;
}

export const SERVICE_CHARGE_FLAGS = { elevated: 1, high: 2 } as const;

/** Yearly service charge as a percent of the price, flagged at 1% and 2%. */
export function serviceChargeShare(charge: number | null, price: number | null): ServiceChargeShare | null {
  if (charge === null || price === null || !(charge >= 0) || !(price > 0)) return null;
  const raw = (charge / price) * 100;
  const percent = Math.round(raw * 100) / 100; // display only; flags use the unrounded share
  if (raw >= SERVICE_CHARGE_FLAGS.high) {
    return { percent, flag: "2-plus", note: "2% of the price or more a year: high. Ask what it covers, " +
      "for planned major works and the reserve fund, and whether your lender accepts it." };
  }
  if (raw >= SERVICE_CHARGE_FLAGS.elevated) {
    return { percent, flag: "1-to-2", note: "1–2% of the price a year: above typical. Ask for three years of " +
      "statements and the budget for next year." };
  }
  return { percent, flag: "under-1", note: "Under 1% of the price a year. Still ask for recent statements " +
    "and any planned major works." };
}

export interface BuildingHeight {
  metres: number | null;
  storeys: number | null;
}

export type HeightTier = "unknown" | "under-11" | "11-to-18" | "18-plus";

export const SAFETY_THRESHOLDS = {
  protected: { metres: 11, storeys: 5 },
  higherRisk: { metres: 18, storeys: 7 },
} as const;

/** Building Safety Act tier from whichever height the user entered (either threshold met counts). */
export function heightTier(height: BuildingHeight): HeightTier {
  const metres = positive(height.metres);
  const storeys = positive(height.storeys);
  if (metres === null && storeys === null) return "unknown";
  const meets = (limit: { metres: number; storeys: number }) =>
    (metres !== null && metres >= limit.metres) || (storeys !== null && storeys >= limit.storeys);
  if (meets(SAFETY_THRESHOLDS.higherRisk)) return "18-plus";
  if (meets(SAFETY_THRESHOLDS.protected)) return "11-to-18";
  return "under-11";
}

const PROTECTED_QUESTIONS = [
  "Has the landlord given a landlord's certificate, and has the seller completed a leaseholder deed of " +
    "certificate (Building Safety Act cost protection from 11 m or 5 storeys)?",
  "Is there an EWS1 form or a PAS 9980 external wall assessment, and will your lender accept it?",
  "Is any cladding or fire-safety remediation outstanding, and who is paying for it?",
];

export const BUILDING_SAFETY_QUESTIONS: Record<HeightTier, string[]> = {
  unknown: [],
  "under-11": [
    "Below 11 m and 5 storeys the Building Safety Act cost protections do not apply: has a lender asked " +
      "for an EWS1 form, or is any external wall or balcony work planned?",
  ],
  "11-to-18": PROTECTED_QUESTIONS,
  "18-plus": [
    ...PROTECTED_QUESTIONS,
    "Is the building registered with the Building Safety Regulator as a higher-risk building (18 m or " +
      "7 storeys, two or more homes), and who is its Accountable Person?",
    "Can you see the building's safety case summary and resident engagement strategy?",
  ],
};

export function buildingSafetyQuestions(height: BuildingHeight): { tier: HeightTier; questions: string[] } {
  const tier = heightTier(height);
  return { tier, questions: BUILDING_SAFETY_QUESTIONS[tier] };
}

function positive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

const TENURE_WITHOUT_EVIDENCE =
  "No lease evidence on file for a leasehold record — expiry, charges, " +
  "notices, and management questions are all still open.";

function unknownTerm(): TermAssessment {
  return {
    state: "unknown",
    note: "Lease expiry: unknown. Do not assume a long lease; confirm the expiry "
      + "and its as-of date from the lease or transfer documents.",
  };
}

function conflictTerm(detail: string): TermAssessment {
  return {
    state: "conflict",
    note: `Lease dates conflict (${detail}). Treat the remaining term as unknown `
      + "until the lease document itself is checked.",
  };
}

function assessFreshness(facts: LeaseholdFacts, expiry: string, today: string): TermAssessment {
  const observations: EvidenceRef[] = [
    facts.leaseExpiry.evidence,
    facts.leaseExpiryAsOf.evidence,
    ...facts.extraExpiryObservations,
  ].filter((evidence): evidence is EvidenceRef => evidence !== null);
  const oldest = observations.map((evidence) => evidence.observedAt).sort()[0] ?? null;
  if (oldest === null) return staleTerm("no dated observation");
  if (daysBetween(oldest, today) > OBSERVATION_FRESH_DAYS) return staleTerm(`observation from ${oldest}`);
  return { state: "known", note: `Lease expiry ${expiry}, last observed ${oldest}. Still confirm with a solicitor before relying on it.` };
}

function staleTerm(detail: string): TermAssessment {
  return {
    state: "stale",
    note: `Lease expiry observation has expired (${detail}, older than ${OBSERVATION_FRESH_DAYS} days). Re-check the lease before relying on it.`,
  };
}

function tenureLine(facts: LeaseholdFacts): string {
  const tenure = (facts.transactionTenure ?? "").trim();
  if (tenure === "") return "Recorded transaction tenure: not recorded.";
  return `Recorded transaction tenure: ${tenure} (kept as recorded; it says nothing about the lease terms).`;
}

function costLines(facts: LeaseholdFacts): string[] {
  return [
    moneyLine("Service charge", facts.serviceChargeAnnual, "per year"),
    moneyLine("Ground rent", facts.groundRentAnnual, "per year"),
    facts.majorWorksNotice.value === null
      ? "Major works notices: unknown — ask the managing agent for recent and planned works."
      : `Major works notice (as entered): ${facts.majorWorksNotice.value} ${provenance(facts.majorWorksNotice.evidence)}.`,
  ];
}

function moneyLine(label: string, fact: SourcedFact<number>, cadence: string): string {
  if (fact.value === null) return `${label}: unknown — do not treat as zero.`;
  return `${label} (as entered): ${fact.value} ${cadence} ${provenance(fact.evidence)}.`;
}

function provenance(evidence: EvidenceRef | null): string {
  if (evidence === null) return "(no source recorded)";
  return `(source: ${evidence.source}, observed ${evidence.observedAt}, ${evidence.status})`;
}

function questionLines(facts: LeaseholdFacts): string[] {
  if (facts.questions.length === 0) {
    return ["No diligence questions recorded yet — add the ones that would change the decision."];
  }
  return facts.questions.map((question) => {
    const state = question.answered ? "answered" : "unanswered";
    const reference = question.url === null ? "no reference attached" : `reference: ${question.url}`;
    return `Question (${state}): ${question.text} — ${reference}.`;
  });
}

function nextQuestionId(questions: DiligenceQuestion[]): string {
  const numbers = questions.map((question) => Number(question.id.replace(/^q-/, ""))).filter((n) => Number.isInteger(n));
  return `q-${(numbers.length === 0 ? 0 : Math.max(...numbers)) + 1}`;
}

function daysBetween(from: string, to: string): number {
  return (parseDate(to) - parseDate(from)) / 86_400_000;
}

function parseDate(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
