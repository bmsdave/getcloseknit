import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectionLabel,
  matchesSchoolQuery,
  parentPriorityScore,
  resolveCurrentSchool,
  schoolHistory,
  type ReviewedSchool,
} from "../src/lib/school-evidence";

function openSchool(overrides: Partial<ReviewedSchool> = {}): ReviewedSchool {
  return {
    urn: "100004",
    name: "New Town Academy",
    previousNames: ["Old Town Primary"],
    phase: "primary",
    status: "open",
    closedDate: null,
    predecessorUrn: "100003",
    successorUrn: null,
    observations: [],
    missingObservations: [],
    sourceRelease: "directory-fixture-2026-09",
    ...overrides,
  };
}

const DIRECTORY: ReviewedSchool[] = [
  openSchool({
    urn: "100003",
    name: "Old Town Primary",
    previousNames: [],
    status: "closed",
    closedDate: "2024-08-31",
    predecessorUrn: null,
    successorUrn: "100004",
  }),
  openSchool(),
];

test("a closed school resolves to its successor, keeping the closure date", () => {
  const resolved = resolveCurrentSchool(DIRECTORY, "100003");

  assert.equal(resolved.urn, "100004");
  assert.equal(DIRECTORY[0].status, "closed");
  assert.equal(DIRECTORY[0].closedDate, "2024-08-31");
});

test("a changed URN keeps predecessor, successor, and renaming history", () => {
  const history = schoolHistory(DIRECTORY, "100004");

  assert.deepEqual(history.map((entry) => entry.urn), ["100003", "100004"]);
  assert.equal(history[1].predecessorUrn, "100003");
  assert.ok(history[1].previousNames.includes("Old Town Primary"));
});

test("an unknown URN cannot resolve", () => {
  assert.throws(() => resolveCurrentSchool(DIRECTORY, "999999"), /unknown URN/);
});

test("a missing cohort is reported, never silently dropped", () => {
  const school = openSchool({
    observations: [
      {
        kind: "performance",
        academicYear: "2024/25",
        measure: "progress",
        value: 0.4,
        cohortSize: null,
        suppressed: false,
        sourceUrl: "https://explore-education-statistics.service.gov.uk/",
        sourceRelease: "performance-fixture-2026-09",
      },
    ],
    missingObservations: ["progress:2024/25:cohort-size"],
  });

  assert.ok(school.missingObservations.includes("progress:2024/25:cohort-size"));
  assert.equal(school.observations[0].cohortSize, null);
});

test("a small suppressed sample stays visible with its cohort size", () => {
  const school = openSchool({
    observations: [
      {
        kind: "performance",
        academicYear: "2024/25",
        measure: "attainment",
        value: 62,
        cohortSize: 4,
        suppressed: true,
        sourceUrl: "https://explore-education-statistics.service.gov.uk/",
        sourceRelease: "performance-fixture-2026-09",
      },
    ],
    missingObservations: [],
  });

  assert.equal(school.observations[0].suppressed, true);
  assert.equal(school.observations[0].value, 62);
});

test("legacy judgements stay labelled legacy and incomparable with current facets", () => {
  const legacy = inspectionLabel({
    kind: "inspection-legacy",
    academicYear: "2019/20",
    measure: "overall-judgement",
    value: "Good",
    cohortSize: null,
    suppressed: false,
    sourceUrl: "https://www.gov.uk/government/organisations/ofsted",
    sourceRelease: "ofsted-fixture-2026-09",
  });
  const current = inspectionLabel({
    kind: "inspection-current",
    academicYear: "2024/25",
    measure: "achievement",
    value: 3,
    cohortSize: null,
    suppressed: false,
    sourceUrl: "https://www.gov.uk/government/organisations/ofsted",
    sourceRelease: "ofsted-fixture-2026-09",
  });

  assert.match(legacy, /legacy/i);
  assert.match(legacy, /not comparable/i);
  assert.doesNotMatch(current, /legacy/i);
});

test("parent priorities weight facets; no universal score exists", () => {
  const score = parentPriorityScore(
    { progress: 80, attendance: 40 },
    { progress: 4, attendance: 2 },
  );

  assert.equal(score.value, 67);
  assert.equal(score.evidenceCompleteness, 100);
  assert.throws(() => parentPriorityScore({ progress: 80 }, {}), /parent priorities/);
});

test("every observation links its publisher record", () => {
  const school = openSchool({
    observations: [
      {
        kind: "performance",
        academicYear: "2024/25",
        measure: "attainment",
        value: 62,
        cohortSize: 120,
        suppressed: false,
        sourceUrl: "https://explore-education-statistics.service.gov.uk/",
        sourceRelease: "performance-fixture-2026-09",
      },
    ],
    missingObservations: [],
  });

  assert.ok(school.observations.length > 0);
  for (const observation of school.observations) {
    assert.ok(observation.sourceUrl.startsWith("https://"), "publisher record URL");
    assert.ok(observation.sourceRelease.length > 0, "publisher release");
  }
});

test("directory records carry no distance or admission eligibility", () => {
  const school = openSchool();

  assert.ok(!("distanceMetres" in school), "distances stay separate");
  assert.ok(!("journeyMinutes" in school), "travel stays separate");
  assert.ok(!("admissionEvidence" in school), "eligibility stays separate");
});

test("search matches names, phases, and previous names", () => {
  assert.ok(matchesSchoolQuery(DIRECTORY[1], "new town"));
  assert.ok(matchesSchoolQuery(DIRECTORY[1], "old town primary"));
  assert.ok(!matchesSchoolQuery(DIRECTORY[1], "secondary academy"));
  assert.ok(matchesSchoolQuery(DIRECTORY[0], ""));
});
