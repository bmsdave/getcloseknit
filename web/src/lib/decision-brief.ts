// AE-30: sourced household decision brief. This module only assembles a
// brief from shared models — it never recalculates. Areas come from the
// AE-18 comparison, asking/achieved figures from AE-29, costs from AE-19,
// diligence from AE-20, viewing questions from AE-28, and wording from the
// shared evidence formatting. Uncertain estimates stay estimates and open
// questions stay questions throughout.
import type {
  MetricDefinition,
  PreferenceProfile,
  SaleRecord,
} from "./contracts";
import { chosenFactors, defaultWeight, factorRowLabel, formatBudget, isOrderedSearch, orderedNeeds, type AreaComparison } from "./area-comparison";
import { budgetFromMaximum, searchItems, type SearchItem } from "./match-search";
import { itemChip, sinkParts, whyParts } from "./match-words";
import { DEFAULT_PROFILE } from "./fixtures";
import { describeUnmetLimits } from "./matching";
import { formatPounds } from "./evidence-format";
import { budgetsFor } from "./needs-validation";
import {
  COMPARISON_DISCLAIMER,
  buildCostWorksheet,
  compareToBudget,
  type BudgetComparison,
  type CostAssumptions,
  type CostLine,
} from "./housing-cost";
import {
  assessLeaseTerm,
  unansweredQuestions,
  type DiligenceQuestion,
  type LeaseholdFacts,
} from "./leasehold";
import {
  candidateConflicts,
  describeAskingVsAchieved,
  type UserCandidate,
} from "./user-candidates";
import type { ViewingStatus } from "./viewing-checklist";

export const REQUIRED_BRIEF_SECTIONS = [
  "needs",
  "assumed",
  "constraints",
  "tradeoffs",
  "candidates",
  "costs",
  "open-questions",
  "limits",
  "evidence",
] as const;

/** Every unknown reads the same way: never a zero, never a guess. */
export const UNKNOWN_NOTE = "We don't know this yet, so we haven't counted it.";
/** The same words after a label: "Council tax: we don't know this yet, …". */
const UNKNOWN_CLAUSE = `${UNKNOWN_NOTE.charAt(0).toLowerCase()}${UNKNOWN_NOTE.slice(1)}`;

export type BriefSectionId = (typeof REQUIRED_BRIEF_SECTIONS)[number];
export type BriefLineKind = "fact" | "estimate" | "unknown" | "question" | "constraint" | "tradeoff";

export interface BriefSource {
  label: string;
  url: string | null;
  release: string;
  observedAt: string;
}

export interface BriefLine {
  text: string;
  kind: BriefLineKind;
  source?: BriefSource;
}

export interface BriefSection {
  id: BriefSectionId;
  heading: string;
  lines: BriefLine[];
}

/** The top of the brief: each compared area in three lines. */
export interface BriefVerdict {
  area: string;
  /** "~£686k · £86k over your £600k limit". */
  price: string;
  /** "24 min to Your place 1 (within your 30 min)". */
  commute: string;
  /** The one thing still to find out there. */
  question: string;
  /** CUJ03 board: the area's My match score 0–100; null when it is out or unscored. */
  score?: number | null;
  /** Its strongest criteria in your order ("#1 King's Cross 18′", "#2 safer than 91%"); [] for none. */
  gains?: string[];
  /** What falls short ("≈ #1 King's Cross 41′"); [] when nothing does. */
  tradeOffs?: string[];
}

export interface DecisionBrief {
  title: string;
  generatedAt: string;
  release: string;
  /** "demo" or "real" when known: shown with the release under Sources. */
  mode?: string;
  redacted: boolean;
  /** Opened from someone else's link: it holds only what they included. */
  shared?: boolean;
  verdicts: BriefVerdict[];
  sections: BriefSection[];
}

export interface BriefRedaction {
  includeDestinations: boolean;
  includeNotes: boolean;
  /** False for a brief shared without its budget: no limit figure anywhere. Absent = shown. */
  includeBudget?: boolean;
  /** A brief opened from someone else's link: "the £650k limit", never "your". */
  shared?: boolean;
}

export interface BriefCandidateEvidence {
  candidate: UserCandidate;
  history: SaleRecord | null;
  lease: LeaseholdFacts;
}

export interface BriefViewingItem {
  /** The checklist question's id ("evening-visit"), when known. */
  id?: string;
  text: string;
  status: ViewingStatus;
  note: string | null;
}

export interface BriefViewingEvidence {
  candidateName: string;
  items: BriefViewingItem[];
}

export interface DecisionBriefInput {
  profile: PreferenceProfile;
  comparison: AreaComparison | null;
  comparisonError: string | null;
  candidates: BriefCandidateEvidence[];
  viewing: BriefViewingEvidence[];
  costs: { assumptions: CostAssumptions; onDate?: string } | null;
  metrics: MetricDefinition[];
  /** Each compared area's standout cons by geography id: its trade-offs when the search names none. */
  cons?: Record<string, string[]>;
  redaction: BriefRedaction;
  generatedAt?: string;
  mode?: string;
}

export function isSafeSourceUrl(url: string | null | undefined): boolean {
  if (!url || url.trim() === "") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function briefSource(
  label: string,
  url: string | null,
  release: string,
  observedAt: string,
): BriefSource {
  return { label, url: isSafeSourceUrl(url) ? (url as string).trim() : null, release, observedAt };
}

export function buildDecisionBrief(input: DecisionBriefInput): DecisionBrief {
  if (!input.comparison && input.candidates.length === 0) {
    throw new Error("brief needs at least one compared area or one selected candidate");
  }
  const verdicts = verdictsFor(input.profile, input.comparison, input.viewing, input.redaction, input.cons ?? {});
  // A question already shown "At a glance" for its area is not asked again below.
  const asked = new Set(verdicts.map((verdict) => `${verdict.area}\u0000${verdict.question}`));
  return {
    title: "Decision brief",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    release: input.comparison?.release ?? "not compared yet (each item below names its own version)",
    ...(input.mode ? { mode: input.mode } : {}),
    redacted: !input.redaction.includeDestinations || !input.redaction.includeNotes,
    ...(input.redaction.shared ? { shared: true } : {}),
    verdicts,
    sections: withoutRepeats([
      needsSection(input.profile, input.redaction),
      assumedSection(input.profile, input.redaction.includeBudget !== false, input.redaction.shared),
      constraintsSection(input.profile, input.comparison, input.redaction),
      tradeoffsSection(input.comparison, input.comparisonError),
      // A shared brief has no homes or costs of this device: no "add one" asks the partner can't act on.
      ...(input.redaction.shared ? [] : [candidatesSection(input.candidates, input.redaction), costsSection(input.profile, input.costs)]),
      openQuestionsSection(input.viewing.map((group) => ({
        ...group, items: group.items.filter((item) => !asked.has(`${group.candidateName}\u0000${item.text}`)),
      })), input.candidates),
      limitsSection(input.comparison, input.redaction),
      evidenceSection(input.comparison, input.candidates, input.metrics),
    ]),
  };
}

/** No sentence says the same thing twice: a repeat (in any section) keeps its first place only. */
function withoutRepeats(sections: BriefSection[]): BriefSection[] {
  const seen = new Set<string>();
  return sections.map((section) => ({
    ...section,
    lines: section.lines.filter((line) => {
      if (seen.has(line.text)) return false;
      seen.add(line.text);
      return true;
    }),
  }));
}

// ---- the top block: each area in three lines ------------------------------------------------

/** Trade-offs per area at a glance: as many as gains show (whyParts' two). */
const MAX_TRADE_OFFS = 2;

/** An area's trade-offs in one line; "None found" when neither the search nor its standouts name one. */
export function tradeOffsText(tradeOffs: readonly string[]): string {
  return tradeOffs.length ? tradeOffs.join(" · ") : "None found";
}

function verdictsFor(
  profile: PreferenceProfile,
  comparison: AreaComparison | null,
  viewing: BriefViewingEvidence[],
  redaction: BriefRedaction,
  cons: Record<string, string[]>,
): BriefVerdict[] {
  if (!comparison) return [];
  const price = comparison.rows.find((row) => row.factorId === "affordability");
  const place = comparison.rows.find((row) => row.factorId.startsWith("place:"));
  const commute = comparison.rows.find((row) => row.factorId === "commute" && row.weight > 0);
  const journey = place ?? commute ?? null;
  const items = briefItems(profile, !redaction.includeDestinations);
  return comparison.columns.map((column, index) => {
    const area = column.result.name;
    // CUJ03 board: every area has its trade-offs. What the search marks short (✗, ≈) first, then the area's own
    // standout cons (London's worst 10% on a topic), two at most; with neither, its weakest criterion that is not
    // already a gain (it meets it, but least well).
    const gainParts = items.length ? whyParts(column.result, items, profile).filter((part) => part.mark === "in") : [];
    const sinks = items.length ? sinkParts(column.result, items, profile) : [];
    const searchOffs = sinks.filter((part) => part.mark !== "in").map((part) => `${part.mark === "edge" ? "≈" : "✗"} ${part.text}`);
    const listed = [...searchOffs, ...(cons[column.result.geographyId] ?? [])].slice(0, MAX_TRADE_OFFS);
    const weakest = sinks.find((part) => part.mark === "in" && !gainParts.some((gain) => gain.id === part.id));
    const tradeOffs = listed.length || !weakest ? listed : [weakest.text];
    return {
      area,
      price: priceVerdict(profile, price?.cells[index] ?? null, redaction),
      commute: commuteVerdict(journey, index, redaction.shared),
      question: questionFor(area, comparison, index, viewing, journey),
      ...(items.length ? {
        score: column.result.excluded ? null : column.result.score,
        gains: gainParts.map((part) => part.text),
      } : {}),
      ...(items.length || tradeOffs.length ? { tradeOffs } : {}),
    };
  });
}

/** The search's items with a place named "Your place N" while destinations stay out (AE-09). */
function briefItems(profile: PreferenceProfile, redactPlaces: boolean): SearchItem[] {
  const places = (profile.places ?? []).map((place) => place.id);
  return searchItems(profile).map((item) => (item.criterion.kind === "place" && redactPlaces
    ? { ...item, criterion: { ...item.criterion, label: `Your place ${places.indexOf(item.criterion.id) + 1}` } }
    : item));
}

function priceVerdict(profile: PreferenceProfile, cell: AreaComparison["rows"][number]["cells"][number] | null, redaction: BriefRedaction): string {
  if (!cell || cell.state !== "observed" || cell.rawValue === null) return `Price: ${UNKNOWN_CLAUSE}`;
  if (redaction.includeBudget === false) return `~${formatBudget(profile, cell.rawValue)}`;
  const whose = redaction.shared ? "the" : "your";
  const limit = profile.maximumBudget;
  const gap = Math.abs(cell.rawValue - limit);
  const money = (value: number) => formatBudget(profile, value);
  const side = cell.rawValue > limit ? "over" : "under";
  const versus = gap === 0 ? `at ${whose} ${money(limit)} limit` : `${money(gap)} ${side} ${whose} ${money(limit)} limit`;
  return `~${money(cell.rawValue)} · ${versus}`;
}

function commuteVerdict(row: AreaComparison["rows"][number] | null, index: number, shared = false): string {
  if (!row) return shared ? "No journey in what was shared." : "No journey set yet: add a place you travel to.";
  const cell = row.cells[index];
  if (!cell || cell.state !== "observed") return `${row.label}: ${UNKNOWN_CLAUSE}`;
  if (row.factorId.startsWith("place:")) return `${cell.display} to ${row.label} (${cell.note.replace(/ · leads$/, "")})`;
  return `${row.label}: ${cell.display}`;
}

/** The first open viewing question for the area (not the general cost one), else a gap the other
 * two lines don't already name. */
function questionFor(
  area: string, comparison: AreaComparison, index: number, viewing: BriefViewingEvidence[],
  journey: AreaComparison["rows"][number] | null,
): string {
  const open = viewing.find((group) => group.candidateName === area)?.items
    .find((item) => item.status !== "checked" && item.id !== "total-cost");
  if (open) return open.text;
  const gap = comparison.rows.find((row) => row !== journey && row.factorId !== "affordability"
    && row.weight > 0 && row.cells[index]?.state === "unknown");
  if (gap) return `Find out its ${gap.label.toLowerCase()}: we have no figure for it here.`;
  return "Nothing open yet: note what would change your mind on a visit.";
}

/** "Highbury East · 86" (the My match score), or the name alone when it has none. */
export function verdictHeading(verdict: BriefVerdict): string {
  return typeof verdict.score === "number" ? `${verdict.area} · ${verdict.score}` : verdict.area;
}

export function renderBriefMarkdown(brief: DecisionBrief): string {
  const head = [
    `# ${brief.title}`,
    "",
    `${BRIEF_INTRO} ${brief.generatedAt.slice(0, 10)} · ${privacyNote(brief)}.`,
    "",
  ];
  const glance = brief.verdicts.length === 0 ? [] : [
    "## At a glance",
    "",
    ...brief.verdicts.flatMap((verdict) => [
      `### ${verdictHeading(verdict)}`,
      "",
      ...(verdict.gains?.length ? [`- Gains: ${verdict.gains.join(" · ")}`] : []),
      ...(verdict.tradeOffs ? [`- Trade-offs: ${tradeOffsText(verdict.tradeOffs)}`] : []),
      `- ${verdict.price}`,
      `- ${verdict.commute}`,
      `- ${verdict.question}`,
      "",
    ]),
  ];
  const sources = brief.sections.filter((section) => section.id === "evidence")
    .map((section) => ({ ...section, lines: [{ text: releaseNote(brief), kind: "fact" as const }, ...section.lines] }));
  const rest = brief.sections.filter((section) => section.id !== "evidence");
  return [...head, ...glance, ...briefSectionsMarkdown([...rest, ...sources])].join("\n");
}

export const BRIEF_INTRO = "A summary you can keep or share. Nothing leaves this device.";

export function privacyNote(brief: DecisionBrief): string {
  if (brief.shared) return "Shared: only what its sender included";
  return brief.redacted ? "Private details left out unless you tick them" : "Includes the private details you ticked";
}

/** Shown under Sources, never above it: the evidence release and whether these are preview figures. */
export function releaseNote(brief: DecisionBrief): string {
  const mode = brief.mode === "demo" ? " · Preview data, not for decisions" : brief.mode === "real" ? " · Published data" : "";
  return `Release ${brief.release}${mode}.`;
}

/** `## heading` + one bullet per line with its citation; shared with the area evidence pack. */
export function briefSectionsMarkdown(sections: { heading: string; lines: BriefLine[] }[]): string[] {
  return sections.flatMap((section) => [
    `## ${section.heading}`,
    "",
    ...section.lines.map((line) => `- ${markdownLine(line)}`),
    "",
  ]);
}

function markdownLine(line: BriefLine): string {
  if (!line.source) return line.text;
  const { label, url, release, observedAt } = line.source;
  const citation = url
    ? `[${label}, ${release}, observed ${observedAt}](${url})`
    : `${label}, ${release}, observed ${observedAt}`;
  return `${line.text} — ${citation}`;
}

// Review #2: the brief states only what the household set. Defaults (the comfortable budget the
// wizard derives, the budget's standing weight) sit under "Assumed", and untouched schools are left out.
function needsSection(profile: PreferenceProfile, redaction: BriefRedaction): BriefSection {
  return {
    id: "needs",
    heading: "Stated needs",
    lines: [
      { text: redaction.includeBudget === false ? "Budget not shared." : budgetNeed(profile), kind: "fact" },
      { text: `${profile.bedrooms} bedrooms needed.`, kind: "fact" },
      ...weightedNeeds(profile, redaction),
      ...placeNeeds(profile, redaction),
      ...destinationNeeds(profile, redaction),
      ...schoolNeeds(profile),
    ],
  };
}

function budgetNeed(profile: PreferenceProfile): string {
  const verb = profile.market === "buy" ? "Buying" : "Renting";
  const unit = profile.market === "rent" ? " a month" : "";
  if (targetAssumed(profile)) return `${verb}, up to ${formatPounds(profile.maximumBudget)}${unit} (your maximum).`;
  return `${verb}, between ${formatPounds(profile.targetBudget)} and ${formatPounds(profile.maximumBudget)}${unit} (your range).`;
}

/** The comfortable budget is derived from the maximum (or still the default), not typed by the household. */
function targetAssumed(profile: PreferenceProfile): boolean {
  return profile.targetBudget === budgetsFor(profile.maximumBudget).targetBudget
    || profile.targetBudget === budgetFromMaximum(profile.maximumBudget, profile.market).targetBudget
    || profile.targetBudget === DEFAULT_PROFILE.targetBudget;
}

function weightedNeeds(profile: PreferenceProfile, redaction: BriefRedaction): BriefLine[] {
  if (isOrderedSearch(profile)) {
    const names = orderedNeeds(profile, !redaction.includeDestinations);
    if (names.length) {
      const whose = redaction.shared ? "the sender's" : "your";
      return [{ text: `What matters, most important first: ${names.join(", ")}. This is ${whose} order, not an objective ranking.`, kind: "fact" }];
    }
    return [{ text: "Only the budget so far: nothing else is in your search yet.", kind: "unknown" }];
  }
  const chosen = chosenFactors(profile);
  if (chosen.length === 0) return [{ text: "You haven't picked any priorities yet.", kind: "unknown" }];
  const names = chosen.map((factor) => `${factorRowLabel(factor.factorId)} (${factor.weight} of 5)`).join(", ");
  return [{ text: `Priorities you picked: ${names}. These are your weights, not an objective ranking.`, kind: "fact" }];
}

/** Each place's journey as it counts in the score: "Journey to Your place 1: weight 3 of 5, limit 25 min." */
function placeNeeds(profile: PreferenceProfile, redaction: BriefRedaction): BriefLine[] {
  const places = profile.places ?? [];
  if (places.length === 0) return [];
  // A v4 search ranks places like any criterion (its #n is in "What matters"): no old 1-5 weight here.
  const weight = (place: (typeof places)[number]) => (isOrderedSearch(profile) ? "" : `weight ${place.weight} of 5, `);
  const journeys = places.map((place, index) => ({
    text: redaction.includeDestinations
      ? `Journey to \u201c${place.label}\u201d: ${weight(place)}limit ${place.targetMinutes} min, by ${place.mode}${place.must ? " (a must)" : ""}.`
      : `Journey to Your place ${index + 1}: ${weight(place)}limit ${place.targetMinutes} min${place.must ? " (a must)" : ""}.`,
    kind: "fact" as const,
  }));
  if (redaction.includeDestinations) return journeys;
  return [{
    text: `${places.length} ${places.length === 1 ? "place" : "places"} you travel to, shown as "Your place 1"${places.length > 1 ? " and so on" : ""} until you include destinations.`,
    kind: "unknown",
  }, ...journeys];
}

function destinationNeeds(profile: PreferenceProfile, redaction: BriefRedaction): BriefLine[] {
  const count = profile.commuteDestinations.length;
  if (count === 0) {
    if ((profile.places ?? []).length > 0) return [];
    return [{ text: redaction.shared ? "No places travelled to in what was shared." : "No places you travel to recorded.", kind: "unknown" }];
  }
  if (!redaction.includeDestinations) {
    return [{
      text: `${count} commute destination(s) on file — redacted from this brief until you include them.`,
      kind: "unknown",
    }];
  }
  return profile.commuteDestinations.map((destination) => ({
    text: `Commute to \u201c${destination.label}\u201d (${destination.mode}, arrive ${destination.arrivalTime}, target ${destination.targetMinutes} min).`,
    kind: "fact" as const,
  }));
}

/** Schools only when the household touched them: the default "primary, shortlist 3" is not theirs. */
function schoolNeeds(profile: PreferenceProfile): BriefLine[] {
  if (!schoolsTouched(profile)) return [];
  const phases = profile.school.phases.length > 0 ? profile.school.phases.join(" and ") : "no";
  return [{
    text: `Schools: ${phases} phase, aiming to shortlist ${profile.school.desiredSchoolCount}. Travel time is kept separate from admission.`,
    kind: "fact",
  }];
}

function schoolsTouched(profile: PreferenceProfile): boolean {
  const school = profile.school;
  const fallback = DEFAULT_PROFILE.school;
  const schoolsWeighted = profile.factors.some((factor) => factor.factorId === "schools" && factor.weight > 0)
    || (profile.ranges ?? []).some((range) => range.layer === "schools");
  return schoolsWeighted
    || school.phases.join() !== fallback.phases.join()
    || school.desiredSchoolCount !== fallback.desiredSchoolCount
    || school.shortlistUrns.length > 0
    || school.characteristics.length > 0;
}

function assumedSection(profile: PreferenceProfile, budget = true, shared = false): BriefSection {
  const lines: BriefLine[] = [];
  if (budget && targetAssumed(profile)) {
    const share = Math.round((profile.targetBudget / Math.max(1, profile.maximumBudget)) * 100);
    lines.push({
      text: `A comfortable budget of ${formatPounds(profile.targetBudget)}${profile.market === "rent" ? " a month" : ""} (${share}% of your maximum), used to grade prices.`,
      kind: "estimate",
    });
  }
  // A v4 search is its ordered list: the old factors under it are all 0, so their weights say
  // nothing about what was left out (crime and schools count as "Safer streets", "Good schools").
  if (!isOrderedSearch(profile)) {
    const price = profile.factors.find((factor) => factor.factorId === "affordability");
    if (price && price.weight > 0 && price.weight === defaultWeight("affordability")) {
      lines.push({ text: `Price counts at its standard weight (${price.weight} of 5).`, kind: "estimate" });
    }
    // Places replace the legacy commute factor: with a place set, its journey is scored, not "left out".
    const placed = (profile.places ?? []).length > 0;
    const off = profile.factors.filter((factor) => factor.weight === 0 && !(placed && factor.factorId === "commute"))
      .map((factor) => factorRowLabel(factor.factorId).toLowerCase());
    if (off.length > 0) {
      lines.push({ text: `Left out of your score: ${off.join(", ")}.`, kind: "estimate" });
    }
  }
  if (lines.length === 0) lines.push({ text: "Nothing assumed: every figure above is one you set.", kind: "fact" });
  return { id: "assumed", heading: shared ? "Assumed (not set in this search)" : "Assumed (you didn't set these)", lines };
}

export const MUST_HAVES_HEADING = "Your must-haves";

/** A v4 search's Musts in its own words ("Budget ≤ £600k", "Safer streets ≤ median"); places by placeMusts. */
function orderedMusts(profile: PreferenceProfile, redaction: BriefRedaction): BriefLine[] {
  return searchItems(profile).filter((item) => item.must && item.criterion.kind !== "place").map((item) => ({
    text: item.criterion.kind === "budget" && redaction.includeBudget === false ? "Budget (not shared)." : `${itemChip(item.criterion, profile)}.`,
    kind: "constraint" as const,
  }));
}

/** A shared brief's heading (CUJ03 step 4): the partner reads the sender's must-haves, never "your". */
export const SHARED_MUST_HAVES_HEADING = "Their must-haves";

function constraintsSection(profile: PreferenceProfile, comparison: AreaComparison | null, redaction: BriefRedaction): BriefSection {
  const musts = [...(isOrderedSearch(profile) ? orderedMusts(profile, redaction) : profile.factors.flatMap(boundLines)), ...placeMusts(profile, redaction)];
  const shared = Boolean(redaction.shared);
  return {
    id: "constraints",
    heading: shared ? SHARED_MUST_HAVES_HEADING : MUST_HAVES_HEADING,
    lines: [
      ...(musts.length > 0 ? musts : [{
        text: shared ? "No must-haves set, so no area is ruled out." : "You haven't set any must-haves, so no area is ruled out.",
        kind: "unknown" as const,
      }]),
      ...(musts.length > 0 ? areaConstraintLines(profile, comparison, shared ? "their" : "your") : []),
    ],
  };
}

function boundLines(factor: PreferenceProfile["factors"][number]): BriefLine[] {
  const bounds: string[] = [];
  if (factor.minimumUtility !== null) bounds.push(`at least ${factor.minimumUtility} out of 100`);
  if (factor.maximumUtility !== null) bounds.push(`at most ${factor.maximumUtility} out of 100`);
  if (bounds.length === 0) return [];
  return [{
    text: `${factorRowLabel(factor.factorId)} scores ${bounds.join(" and ")}.`,
    kind: "constraint",
  }];
}

/** A place marked "a must" is a must-have too; its name stays "Your place N" until destinations are included. */
function placeMusts(profile: PreferenceProfile, redaction: BriefRedaction): BriefLine[] {
  return (profile.places ?? []).flatMap((place, index) => place.must ? [{
    text: `${redaction.includeDestinations ? `\u201c${place.label}\u201d` : `Your place ${index + 1}`} within ${place.targetMinutes} min.`,
    kind: "constraint" as const,
  }] : []);
}

function areaConstraintLines(profile: PreferenceProfile, comparison: AreaComparison | null, whose: "your" | "their"): BriefLine[] {
  if (!comparison) {
    return [{ text: `No areas compared yet, so ${whose} must-haves haven't been tested.`, kind: "unknown" }];
  }
  const lines = comparison.columns.flatMap((column) =>
    describeUnmetLimits(column.result, profile).map((reason) => ({
      text: `${column.result.name}: ${reason}.`,
      kind: "constraint" as const,
    })));
  if (lines.length === 0) return [{ text: `Every area here meets ${whose} must-haves.`, kind: "fact" }];
  return lines;
}

function tradeoffsSection(comparison: AreaComparison | null, comparisonError: string | null): BriefSection {
  if (!comparison) {
    return {
      id: "tradeoffs",
      heading: "Trade-offs",
      lines: [{
        text: `Area comparison unavailable: ${comparisonError ?? "no comparison on file"}. Compare two to four areas to see the trade-offs.`,
        kind: "unknown",
      }],
    };
  }
  return {
    id: "tradeoffs",
    heading: "Trade-offs",
    lines: comparison.conclusions.filter((conclusion) => !isGapConclusion(conclusion))
      .map((conclusion) => ({ text: conclusion, kind: "tradeoff" as const })),
  };
}

/** The comparison's per-area gap sentences ("X is missing 23% of weighted evidence", "We have no …
 * figure for X"): the brief states each gap once, under Limits. */
function isGapConclusion(conclusion: string): boolean {
  return / is missing \d+% of weighted evidence\.$/.test(conclusion) || /^We have no .+ figure for /.test(conclusion);
}

function candidatesSection(candidates: BriefCandidateEvidence[], redaction: BriefRedaction): BriefSection {
  if (candidates.length === 0) {
    return {
      id: "candidates",
      heading: "Homes you're considering",
      lines: [{
        text: "No homes added yet. Add one with its asking price to set it against what it last sold for.",
        kind: "unknown",
      }],
    };
  }
  return {
    id: "candidates",
    heading: "Homes you're considering",
    lines: candidates.flatMap((entry) => candidateLines(entry, redaction)),
  };
}

function candidateLines(entry: BriefCandidateEvidence, redaction: BriefRedaction): BriefLine[] {
  const { candidate, history, lease } = entry;
  const comparison = describeAskingVsAchieved(candidate, history);
  const lines: BriefLine[] = [comparison.asking && candidate.asking ? {
    text: `${candidate.address.value} — ${comparison.asking.label}: ${formatPounds(comparison.asking.amount)} ${comparison.asking.unit} (you entered, unverified, observed ${candidate.asking.observedAt.slice(0, 10)}).`,
    kind: "estimate",
  } : { text: `${candidate.address.value} — no asking price entered yet.`, kind: "fact" }];
  lines.push(...achievedLines(entry, comparison.achieved));
  lines.push({ text: comparison.note, kind: "fact" });
  for (const conflict of candidateConflicts(candidate, { history, epcAreasSqm: epcAreasOf(history) })) {
    lines.push({ text: `${conflict.kind}: ${conflict.detail}`, kind: "unknown" });
  }
  lines.push(...candidateFactLines(candidate, redaction));
  lines.push(...leaseSnapshotLines(lease));
  return lines;
}

function achievedLines(
  entry: BriefCandidateEvidence,
  achieved: { date: string; nominalPrice: number }[],
): BriefLine[] {
  if (achieved.length === 0) {
    return [{ text: "No achieved prices linked — this candidate rests on your own figures alone.", kind: "unknown" }];
  }
  const version = entry.history?.sourceVersion ?? "unknown version";
  return achieved.map((sale) => ({
    text: `Achieved ${formatPounds(sale.nominalPrice)} on ${sale.date} (official record).`,
    kind: "fact" as const,
    source: briefSource(`Official price history ${version}`, null, version, sale.date),
  }));
}

function candidateFactLines(candidate: UserCandidate, redaction: BriefRedaction): BriefLine[] {
  const lines: BriefLine[] = [linkageLine(candidate)];
  if (candidate.bedrooms !== null) {
    lines.push({
      text: `${candidate.bedrooms.value} bedrooms (you entered, unverified, observed ${candidate.bedrooms.observedAt.slice(0, 10)}).`,
      kind: "estimate",
    });
  }
  if (candidate.floorAreaSqm !== null) {
    lines.push({
      text: `${candidate.floorAreaSqm.value} sqm (you entered, unverified, observed ${candidate.floorAreaSqm.observedAt.slice(0, 10)}).`,
      kind: "estimate",
    });
  }
  const reference = referenceLine(candidate);
  if (reference) lines.push(reference);
  if (candidate.notes && redaction.includeNotes) {
    lines.push({ text: `Private note: ${candidate.notes.value}`, kind: "fact" });
  } else if (candidate.notes) {
    lines.push({ text: "A private note is on file — redacted from this brief until you include it.", kind: "unknown" });
  }
  return lines;
}

function linkageLine(candidate: UserCandidate): BriefLine {
  if (candidate.linkage.status === "linked") {
    return {
      text: `Linked to official records via ${candidate.linkage.matchMethod} (confidence ${candidate.linkage.confidence}) — asking stays yours, history stays official.`,
      kind: "fact",
    };
  }
  return {
    text: `Not linked to any official record (${candidate.linkage.reason}); kept as entered.`,
    kind: "unknown",
  };
}

function referenceLine(candidate: UserCandidate): BriefLine | null {
  if (!candidate.referenceUrl) return null;
  const observed = candidate.referenceUrl.observedAt.slice(0, 10);
  if (isSafeSourceUrl(candidate.referenceUrl.value)) {
    return {
      text: `Reference (never fetched): ${candidate.referenceUrl.value} (you entered, unverified, observed ${observed}).`,
      kind: "fact",
      source: briefSource("Candidate reference (unverified, never fetched)", candidate.referenceUrl.value, "you entered", observed),
    };
  }
  return {
    text: "A reference was recorded but is not shown as a link (unsafe URL).",
    kind: "unknown",
  };
}

function leaseSnapshotLines(lease: LeaseholdFacts): BriefLine[] {
  const term = assessLeaseTerm(lease);
  const open = unansweredQuestions(lease).length;
  const lines: BriefLine[] = [{ text: term.note, kind: term.state === "known" ? "fact" : "unknown" }];
  lines.push(open === 0
    ? { text: "No open lease diligence questions on file.", kind: "unknown" }
    : {
      text: `${open} open lease diligence question(s) — listed under Open questions, never treated as answered.`,
      kind: "question",
    });
  return lines;
}

function costsSection(
  profile: PreferenceProfile,
  costs: { assumptions: CostAssumptions; onDate?: string } | null,
): BriefSection {
  const addPrice = profile.market === "rent" ? "Add a rent to see monthly costs." : "Add a price to see monthly costs.";
  if (!costs) {
    return { id: "costs", heading: "Total housing costs", lines: [{ text: addPrice, kind: "unknown" }] };
  }
  const worksheet = buildCostWorksheet(profile.market, costs.assumptions, costs.onDate);
  // Nothing known yet: say what to add, never a £0 total.
  if (worksheet.lines.every((line) => line.monthlyAmount === null && line.oneOffAmount === null)) {
    return {
      id: "costs",
      heading: "Total housing costs",
      lines: [{ text: addPrice, kind: "unknown" }, { text: COMPARISON_DISCLAIMER, kind: "fact" }],
    };
  }
  const budget = compareToBudget(profile, worksheet);
  return {
    id: "costs",
    heading: "Total housing costs",
    lines: [
      ...worksheet.lines.map(costLine),
      {
        text: `Known monthly total ${formatPounds(worksheet.monthlyTotal)}; first year ${formatPounds(worksheet.firstYearTotal)}. Only the figures we know are counted.`,
        kind: "estimate",
      },
      budgetLine(budget),
      ...(worksheet.missing.length > 0 ? [{
        text: `Still unknown: ${worksheet.missing.join(", ")}. We don't know these yet, so we haven't counted them.`,
        kind: "unknown" as const,
      }] : []),
      ...(worksheet.statutory ? [{
        text: `${worksheet.statutory.instrument} (${worksheet.statutory.jurisdiction}), effective ${worksheet.statutory.effectiveDate}: ${worksheet.statutory.detail}.`,
        kind: "fact" as const,
      }] : []),
      { text: COMPARISON_DISCLAIMER, kind: "fact" },
    ],
  };
}

function costLine(line: CostLine): BriefLine {
  if (line.monthlyAmount === null && line.oneOffAmount === null) {
    return { text: `${line.label}: ${UNKNOWN_CLAUSE}`, kind: "unknown" };
  }
  const amount = line.monthlyAmount !== null
    ? `${formatPounds(line.monthlyAmount)} a month`
    : `${formatPounds(line.oneOffAmount ?? 0)} one-off`;
  if (line.provenance === "estimated") {
    return { text: `${line.label}: ${amount} (estimated from your figures — not a quote, and never a price opinion).`, kind: "estimate" };
  }
  if (line.provenance === "official") {
    return { text: `${line.label}: ${amount} (official figure).`, kind: "fact" };
  }
  return { text: `${line.label}: ${amount} (as you entered).`, kind: "fact" };
}

function budgetLine(budget: BudgetComparison): BriefLine {
  const reference = budget.kind === "monthly"
    ? `${formatPounds(budget.reference)} a month`
    : `${formatPounds(budget.reference)} upfront`;
  if (budget.remaining === null) {
    return { text: `Against ${reference}: too much is unknown to say yet.`, kind: "unknown" };
  }
  if (budget.overBudget) {
    return { text: `Against ${reference} from your affordability profile: known costs exceed that budget.`, kind: "constraint" };
  }
  return {
    text: `Against ${reference} from your affordability profile: ${formatPounds(budget.remaining)} of budget left on known costs.`,
    kind: "estimate",
  };
}

function evidenceSection(
  comparison: AreaComparison | null,
  candidates: BriefCandidateEvidence[],
  metrics: MetricDefinition[],
): BriefSection {
  const lines: BriefLine[] = [];
  if (comparison) {
    for (const row of comparison.rows.filter((candidate) => candidate.weight > 0)) {
      lines.push(...comparisonRowLines(comparison, row.factorId));
    }
    lines.push({ text: "Unweighted factors are left out of this brief.", kind: "fact" });
  } else {
    lines.push({ text: "No areas compared yet, so there are no area figures to source.", kind: "unknown" });
  }
  for (const entry of candidates) lines.push(...historyEvidenceLines(entry));
  lines.push(...metrics.map((metric) => ({
    text: `${metric.label}: ${metric.provenance.sourceName}, release ${metric.provenance.release}.`,
    kind: "fact" as const,
    source: briefSource(metric.provenance.sourceName, metric.provenance.sourceUrl, metric.provenance.release, metric.freshness),
  })));
  const versions = [...new Set(candidates
    .map((entry) => entry.history?.sourceVersion)
    .filter((version): version is string => typeof version === "string"))];
  if (versions.length > 1) {
    lines.push({
      text: `Mixed source versions across candidates (${versions.join(" vs ")}) — figures are kept separate, never merged.`,
      kind: "unknown",
    });
  }
  return { id: "evidence", heading: "Sources", lines };
}

function comparisonRowLines(comparison: AreaComparison, factorId: AreaComparison["rows"][number]["factorId"]): BriefLine[] {
  const row = comparison.rows.find((candidate) => candidate.factorId === factorId)!;
  return comparison.columns.flatMap((column, index) => {
    const cell = row.cells[index]!;
    const label = `${row.label} · ${column.result.name}`;
    if (cell.state !== "observed") return [];
    // The figure the result card and compare show, then what it means, then its source.
    return [{
      text: `${label}: ${cell.display} (${cell.note}) — from ${cell.source}.`,
      kind: row.factorId === "affordability" ? "estimate" as const : "fact" as const,
    }];
  });
}

function historyEvidenceLines(entry: BriefCandidateEvidence): BriefLine[] {
  if (!entry.history) return [];
  const latest = entry.history.transactions.at(-1);
  return [{
    text: `Price history for ${entry.history.address}: source version ${entry.history.sourceVersion}${latest ? `, latest sale ${latest.date}` : ""}.`,
    kind: "fact",
    source: briefSource(
      "Official price history",
      null,
      entry.history.sourceVersion,
      latest?.date ?? entry.candidate.createdAt.slice(0, 10),
    ),
  }];
}

function openQuestionsSection(viewing: BriefViewingEvidence[], candidates: BriefCandidateEvidence[]): BriefSection {
  const lines: BriefLine[] = sharedQuestionLines(viewing);
  for (const entry of candidates) {
    for (const question of unansweredQuestions(entry.lease)) lines.push(leaseQuestionLine(question));
  }
  if (lines.length === 0) {
    lines.push({ text: "No open questions yet: note the ones that would change your mind.", kind: "unknown" });
  }
  return { id: "open-questions", heading: "Open questions", lines };
}

/** One line per question: the same open question in several areas names them all once. */
function sharedQuestionLines(viewing: BriefViewingEvidence[]): BriefLine[] {
  const open = new Map<string, string[]>();
  const lines: BriefLine[] = [];
  for (const group of viewing) {
    for (const item of group.items) {
      if (item.status === "checked" || item.note) {
        lines.push(...viewingGroupLines({ candidateName: group.candidateName, items: [item] }));
        continue;
      }
      const key = `${item.status}\u0000${item.text}`;
      open.set(key, [...(open.get(key) ?? []), group.candidateName]);
    }
  }
  const asked = [...open].map(([key, names]) => {
    const [status, text] = key.split("\u0000");
    const state = status === "unresolved" ? "marked unresolved, still open" : "not looked into yet";
    return { text: `Open (${listNames(names)}, ${state}): ${text}`, kind: "question" as const };
  });
  return [...asked, ...lines];
}

function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function viewingGroupLines(group: BriefViewingEvidence): BriefLine[] {
  return group.items.flatMap((item) => {
    if (item.status === "checked") {
      const own: BriefLine[] = [{
        text: `Checked by you at ${group.candidateName}: ${item.text} — your own observation, not a professional verdict.`,
        kind: "fact",
      }];
      if (item.note) own.push({ text: `Your note: ${item.note}`, kind: "fact" });
      return own;
    }
    const state = item.status === "unresolved" ? "marked unresolved, still open" : "not looked into yet";
    const open: BriefLine[] = [{ text: `Open (${group.candidateName}, ${state}): ${item.text}`, kind: "question" }];
    if (item.note) open.push({ text: `Your note: ${item.note}`, kind: "fact" });
    return open;
  });
}

function leaseQuestionLine(question: DiligenceQuestion): BriefLine {
  const text = `Open lease question: ${question.text} — unanswered, never a verified fact.`;
  if (question.url && isSafeSourceUrl(question.url)) {
    return {
      text,
      kind: "question",
      source: briefSource("Question reference (unverified)", question.url, "you attached", "no date recorded"),
    };
  }
  if (question.url) {
    return { text: `${text} A reference was attached but is not shown as a link (unsafe URL).`, kind: "question" };
  }
  return { text, kind: "question" };
}

/**
 * One list of what this brief can't tell you: each gap in the evidence once (naming every area it
 * applies to), then the standing caveats. Nothing here repeats a line from another section.
 */
function limitsSection(comparison: AreaComparison | null, redaction: BriefRedaction): BriefSection {
  return {
    id: "limits",
    heading: "Limits",
    lines: [
      ...(comparison ? evidenceGapLines(comparison) : []),
      { text: "Prices here are ballpark estimates, not a valuation; cost sums are not advice.", kind: "fact" },
      { text: "Asking prices are what you typed in and stay unchecked; sold prices are official records. We never mix the two.", kind: "fact" },
      { text: "A ticked box is your own observation, not a survey or a legal check. An open question is still open.", kind: "fact" },
      {
        text: redaction.shared
          ? "Exact destinations and private notes stay out unless the sender included them."
          : !redaction.includeDestinations || !redaction.includeNotes
            ? "Your exact destinations and private notes stay out unless you tick them."
            : "You ticked your exact destinations and private notes: check the preview before you show anyone.",
        kind: "fact",
      },
      { text: "Nothing is sent anywhere: exporting saves a file on this device.", kind: "fact" },
    ],
  };
}

function evidenceGapLines(comparison: AreaComparison): BriefLine[] {
  const byShare = new Map<number, string[]>();
  for (const column of comparison.columns) {
    const missing = 100 - column.result.evidenceCompleteness;
    if (missing > 0) byShare.set(missing, [...(byShare.get(missing) ?? []), column.result.name]);
  }
  const shares = [...byShare].map(([missing, names]) => ({
    text: `${listNames(names)} ${names.length === 1 ? "is" : "are each"} missing ${missing}% of the evidence you weighted.`,
    kind: "unknown" as const,
  }));
  const unknowns = comparison.rows.filter((row) => row.weight > 0).flatMap((row) => {
    const names = comparison.columns.filter((_, index) => row.cells[index]?.state === "unknown").map((column) => column.result.name);
    return names.length === 0 ? [] : [{ text: `${row.label} for ${listNames(names)}: ${UNKNOWN_CLAUSE}`, kind: "unknown" as const }];
  });
  return [...shares, ...unknowns];
}

function epcAreasOf(history: SaleRecord | null): number[] {
  const areas = (history?.transactions ?? [])
    .map((entry) => entry.floorAreaSquareMetres)
    .filter((area): area is number => area !== null);
  return [...new Set(areas)];
}
