// AE-26: coverage-aware planning context pilot.
//
// First release reads the national Planning Data planning-application
// dataset for two pilot boroughs. Duplicate national references
// collapse to the latest entry; withdrawn applications leave nearby
// results but stay labelled; boroughs outside the pilot report
// no-coverage (unknown, never absent); an empty search names the
// covered dataset, never the absence of development. Planned, approved,
// and completed stages stay distinct, overlapping constraints stay
// separately named, and every record links its authoritative council
// register. No borough adapter runs without a permitted stable
// interface filling a demonstrated gap. Planning-risk prediction is
// unsupported by design.

export const NATIONAL_PLANNING_SOURCE_ID = "planning-data-uk-applications";
export const PLANNING_STAGES = ["planned", "approved", "completed"] as const;
export type PlanningStage = (typeof PLANNING_STAGES)[number];
export const STALE_AFTER_DAYS = 180;
export const PILOT_BOROUGHS = ["E09000033", "E09000007"] as const;
export const DATASET_UPDATED = "2026-08-30";
export const REVIEW_AS_OF = "2026-09-06";

export interface ReviewedPlanningSource {
  sourceId: string;
  name: string;
  authority: string;
  dataset: string;
  datasetUpdated: string;
  reviewDate: string;
  coverage: string;
}

export const REVIEWED_PLANNING_SOURCE: ReviewedPlanningSource = {
  sourceId: NATIONAL_PLANNING_SOURCE_ID,
  name: "Planning Data planning applications (pilot boroughs)",
  authority: "Ministry of Housing, Communities and Local Government (Planning Data)",
  dataset: "planning-application",
  datasetUpdated: DATASET_UPDATED,
  reviewDate: REVIEW_AS_OF,
  coverage: "Pilot: Westminster (E09000033) and Camden (E09000007)",
};

export type PlanningStatus = "active" | "withdrawn";
export type PlanningSearchStatus = "records" | "no-records" | "no-coverage";
export type PlanningCurrency = "current" | "stale" | "unverified";

export interface PlanningRecord {
  reference: string;
  borough: string;
  title: string;
  stage: PlanningStage;
  decision: string;
  status: PlanningStatus;
  updated: string | null;
  registerPath: string;
  constraints: string[];
  explanation: string;
}

export interface PlanningSearch {
  status: PlanningSearchStatus;
  records: PlanningRecord[];
  withdrawnExcluded: number;
  message: string;
}

export interface PlanningCurrencyState {
  status: PlanningCurrency;
  explanation: string;
}

// Reviewed reference sample: national planning-application rows for the
// pilot boroughs, mirroring the reviewed ingestion fixture
// planning/national-sample.json (including its duplicate reference).
export const REVIEWED_PLANNING_ROWS: PlanningRecord[] = [
  {
    reference: "26/01024/FULL", borough: "E09000033",
    title: "Partial demolition and six-storey rear extension, 12 Preview Street",
    stage: "planned", decision: "proposal: awaiting decision", status: "active",
    updated: "2026-08-20", registerPath: "26/01024/FULL",
    constraints: ["westminster-conservation-area"],
    explanation: "proposal: awaiting decision",
  },
  {
    reference: "26/01024/FULL", borough: "E09000033",
    title: "Partial demolition and six-storey rear extension, 12 Preview Street",
    stage: "planned", decision: "proposal: awaiting decision", status: "active",
    updated: "2026-07-01", registerPath: "26/01024/FULL",
    constraints: ["westminster-conservation-area"],
    explanation: "proposal: awaiting decision",
  },
  {
    reference: "25/08711/FULL", borough: "E09000033",
    title: "Change of use of ground floor to cafe, 4 Preview Mews",
    stage: "approved", decision: "decision: granted 2026-05-14", status: "active",
    updated: "2026-05-20", registerPath: "25/08711/FULL",
    constraints: ["westminster-conservation-area", "article-4-direction"],
    explanation: "decision: granted 2026-05-14",
  },
  {
    reference: "24/05110/FULL", borough: "E09000033",
    title: "Erection of two dwellings, rear of 9 Preview Gardens",
    stage: "completed",
    decision: "decision: granted 2024-11-02; build recorded complete",
    status: "active", updated: "2026-06-10", registerPath: "24/05110/FULL",
    constraints: [],
    explanation: "decision: granted 2024-11-02; build recorded complete",
  },
  {
    reference: "25/09120/FULL", borough: "E09000033",
    title: "Rooftop extension, 21 Preview Road",
    stage: "planned",
    decision: "proposal withdrawn by the applicant 2026-06-30",
    status: "withdrawn", updated: "2026-06-30", registerPath: "25/09120/FULL",
    constraints: [],
    explanation: "Withdrawn: proposal withdrawn by the applicant 2026-06-30. " +
      "Withdrawn applications are not active proposals and leave nearby results.",
  },
  {
    reference: "2026/0123/P", borough: "E09000007",
    title: "Demolition of garage and erection of a mews house, land at Preview Lane",
    stage: "planned", decision: "proposal: awaiting decision", status: "active",
    updated: "2026-08-28", registerPath: "2026/0123/P",
    constraints: ["camden-conservation-area"],
    explanation: "proposal: awaiting decision",
  },
  {
    reference: "2025/4412/P", borough: "E09000007",
    title: "Conversion to four flats, 77 Preview High Street",
    stage: "approved", decision: "decision: granted 2025-12-08", status: "active",
    updated: "2025-11-30", registerPath: "2025/4412/P",
    constraints: [],
    explanation: "decision: granted 2025-12-08",
  },
  {
    reference: "2026/0455/P", borough: "E09000007",
    title: "Shopfront alterations, 3 Preview Parade",
    stage: "planned", decision: "proposal: awaiting decision", status: "active",
    updated: null, registerPath: "2026/0455/P",
    constraints: [],
    explanation: "proposal: awaiting decision",
  },
];

export const BOROUGH_NAMES: Record<string, string> = {
  E09000033: "Westminster",
  E09000007: "Camden",
  E09000028: "Southwark (outside pilot)",
};

const COUNCIL_REGISTER_BASES: Record<string, string> = {
  E09000033: "https://www.westminster.gov.uk/planning-search",
  E09000007: "https://www.camden.gov.uk/planning-search",
};

// Preview areas resolve at MSOA level in demo evidence responses; both the
// requested LSOA ids and the evidence-level MSOA ids map to their borough.
const SELECTED_BOROUGHS: Record<string, string> = {
  "uk:lsoa:E01000001": "E09000033",
  "uk:lsoa:E01000002": "E09000007",
  "uk:lsoa:E01000003": "E09000028",
  "uk:msoa:E02000001": "E09000033",
  "uk:msoa:E02000002": "E09000007",
  "uk:msoa:E02000003": "E09000028",
};

export function deduplicateApplications(
  rows: PlanningRecord[] = REVIEWED_PLANNING_ROWS,
): PlanningRecord[] {
  const latest = new Map<string, PlanningRecord>();
  for (const row of rows) {
    const key = `${row.borough}/${row.reference}`;
    const known = latest.get(key);
    if (known === undefined || sortKey(row) > sortKey(known)) latest.set(key, row);
  }
  return [...latest.values()].sort(compareRecords);
}

export function searchPlanning(
  borough: string,
  stage?: string,
  rows: PlanningRecord[] = REVIEWED_PLANNING_ROWS,
): PlanningSearch {
  requireKnownStage(stage);
  if (!(PILOT_BOROUGHS as readonly string[]).includes(borough)) {
    return { status: "no-coverage", records: [], withdrawnExcluded: 0, message: noCoverageMessage(borough) };
  }
  const unique = deduplicateApplications(rows);
  const active = unique.filter((entry) =>
    entry.borough === borough && entry.status !== "withdrawn" && (stage === undefined || entry.stage === stage));
  const excluded = unique.filter((entry) =>
    entry.borough === borough && entry.status === "withdrawn" && (stage === undefined || entry.stage === stage)).length;
  if (active.length === 0) {
    return { status: "no-records", records: [], withdrawnExcluded: excluded, message: emptySearchMessage(borough) };
  }
  return { status: "records", records: active, withdrawnExcluded: excluded, message: hitMessage(borough) };
}

export function withdrawnFor(
  borough: string,
  rows: PlanningRecord[] = REVIEWED_PLANNING_ROWS,
): PlanningRecord[] {
  return deduplicateApplications(rows).filter(
    (entry) => entry.borough === borough && entry.status === "withdrawn",
  );
}

export function constraintsFor(
  reference: string,
  rows: PlanningRecord[] = REVIEWED_PLANNING_ROWS,
): string[] {
  const found = deduplicateApplications(rows).find((entry) => entry.reference === reference);
  if (found === undefined) throw new Error(`unknown planning reference: ${reference}`);
  return [...found.constraints];
}

export function checkRecordCurrency(
  record: PlanningRecord,
  asOf: string = REVIEW_AS_OF,
): PlanningCurrencyState {
  if (record.updated === null) {
    return {
      status: "unverified",
      explanation: `No update date in the national entry for ${record.reference}: ` +
        "currency is unverified; check the council register before relying on this record.",
    };
  }
  const recordAge = daysBetween(record.updated, asOf);
  const datasetAge = daysBetween(DATASET_UPDATED, asOf);
  if (recordAge > STALE_AFTER_DAYS || datasetAge > STALE_AFTER_DAYS) {
    return {
      status: "stale",
      explanation: `The national entry for ${record.reference} was last updated ` +
        `${record.updated} (${recordAge} days before ${asOf}): treat it as stale ` +
        "and check the council register for the current position.",
    };
  }
  return {
    status: "current",
    explanation: `The national entry for ${record.reference} was updated ${record.updated}, ` +
      `inside the ${STALE_AFTER_DAYS}-day review window of the ${DATASET_UPDATED} ` +
      "dataset refresh: current.",
  };
}

export function boroughSource(borough: string): string {
  if ((PILOT_BOROUGHS as readonly string[]).includes(borough)) return NATIONAL_PLANNING_SOURCE_ID;
  throw new Error(
    `borough ${borough} is outside the pilot coverage: no permitted stable borough ` +
    "interface fills that gap, so no borough adapter runs and nothing is scraped",
  );
}

export function councilRegisterUrl(record: PlanningRecord): string {
  const base = COUNCIL_REGISTER_BASES[record.borough];
  if (base === undefined) throw new Error(`no council register link for borough ${record.borough}`);
  return `${base}/${record.registerPath}`;
}

export function stageCounts(
  rows: PlanningRecord[] = REVIEWED_PLANNING_ROWS,
): Record<PlanningStage, number> {
  const active = deduplicateApplications(rows).filter((entry) => entry.status !== "withdrawn");
  return {
    planned: active.filter((entry) => entry.stage === "planned").length,
    approved: active.filter((entry) => entry.stage === "approved").length,
    completed: active.filter((entry) => entry.stage === "completed").length,
  };
}

export function boroughForSelectedArea(geographyId: string | null): string {
  if (geographyId === null) return "E09000033";
  return SELECTED_BOROUGHS[geographyId] ?? "E09000033";
}

export function boroughLabel(borough: string): string {
  return BOROUGH_NAMES[borough] ?? borough;
}

export function emptySearchMessage(borough: string): string {
  return `No records were returned in the covered dataset for ${boroughLabel(borough)}; ` +
    "this says nothing about development or constraints beyond these records. " +
    "Check the council register for the authoritative position.";
}

export function noCoverageMessage(borough: string): string {
  return `${boroughLabel(borough)} is outside the pilot planning coverage: planning ` +
    "records are unknown here, not absent. Check the council register for the area " +
    "instead of assuming anything from this pilot.";
}

export function estimatePlanningRisk(..._args: unknown[]): never {
  throw new Error(
    "planning-risk prediction is unsupported: show the reviewed proposal, its " +
    "decision state, and the council register link, never a score",
  );
}

function hitMessage(borough: string): string {
  return `National planning records for ${boroughLabel(borough)}. Stages stay distinct: ` +
    "planned is not approval, approval is not completion.";
}

function requireKnownStage(stage: string | undefined): void {
  if (stage !== undefined && !(PLANNING_STAGES as readonly string[]).includes(stage)) {
    throw new Error(`unknown planning stage ${stage}: use one of ${PLANNING_STAGES.join(", ")}`);
  }
}

function daysBetween(from: string, to: string): number {
  const milliseconds = Date.parse(to) - Date.parse(from);
  return Math.floor(milliseconds / 86_400_000);
}

function sortKey(row: PlanningRecord): string {
  return row.updated ?? "";
}

function compareRecords(left: PlanningRecord, right: PlanningRecord): number {
  return `${left.borough}/${left.reference}`.localeCompare(`${right.borough}/${right.reference}`);
}
