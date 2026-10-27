import assert from "node:assert/strict";
import test from "node:test";

import {
  DISTANCE_INSUFFICIENT_EXPLANATION,
  PILOT_ADMISSION_AUTHORITIES,
  addAdmissionQuestion,
  assessPilotAdmissions,
  estimateAdmissionProbability,
  hasAdmissionEvidence,
  pilotAdmissionCoverage,
  type PriorityCutoff,
} from "../src/lib/school-evidence";

function cutoff(overrides: Partial<PriorityCutoff> = {}): PriorityCutoff {
  return {
    academicYear: "2025/26",
    priorityGroup: "distance",
    distanceMetres: 820,
    measurementMethod: "straight-line",
    sourceUrl: "https://example.invalid/a25",
    sourceRelease: "rel-25",
    ...overrides,
  };
}

const THREE_YEARS: PriorityCutoff[] = [
  cutoff({ academicYear: "2023/24", distanceMetres: 900 }),
  cutoff({ academicYear: "2024/25", distanceMetres: 750 }),
  cutoff({ academicYear: "2025/26", distanceMetres: 820 }),
];

test("conflicting measurement methods across years are unavailable, never merged", () => {
  const assessment = assessPilotAdmissions(
    [
      cutoff({ academicYear: "2023/24", distanceMetres: 900, measurementMethod: "straight-line" }),
      cutoff({ academicYear: "2024/25", distanceMetres: 750, measurementMethod: "walking-route" }),
      cutoff({ academicYear: "2025/26", distanceMetres: 820, measurementMethod: "straight-line" }),
    ],
    700,
    null,
    ["2023/24", "2024/25", "2025/26"],
  );

  assert.equal(assessment.claim, "unavailable");
  assert.equal(assessment.conflicting, true);
  assert.equal(assessment.isProbability, false);
});

test("a guide using a different measurement method conflicts with the cutoffs", () => {
  const assessment = assessPilotAdmissions(THREE_YEARS, 700, {
    authorityCode: "E09000033",
    authorityName: "Westminster",
    academicYear: "2026/27",
    priorityRules: ["sibling priority", "distance"],
    measurementMethod: "walking-route",
    priorityArea: "no priority area published",
    guidanceUrl: "https://example.invalid/guide",
    sourceRelease: "rel-26",
  }, ["2023/24", "2024/25", "2025/26"]);

  assert.equal(assessment.claim, "unavailable");
  assert.equal(assessment.conflicting, true);
});

test("multiple priority groups never merge into one reach count", () => {
  const assessment = assessPilotAdmissions(
    [...THREE_YEARS, cutoff({ academicYear: "2025/26", priorityGroup: "sibling", distanceMetres: 2500 })],
    800,
    null,
    ["2023/24", "2024/25", "2025/26"],
  );

  assert.equal(assessment.yearsObserved, 3);
  assert.match(assessment.explanation, /sibling/);
});

test("a missing recent year is unavailable and names the gap", () => {
  const assessment = assessPilotAdmissions(
    [
      cutoff({ academicYear: "2022/23", distanceMetres: 900 }),
      cutoff({ academicYear: "2023/24", distanceMetres: 750 }),
    ],
    700,
    null,
    ["2022/23", "2023/24", "2024/25", "2025/26"],
  );

  assert.equal(assessment.claim, "unavailable");
  assert.ok(assessment.missingYears.includes("2025/26"));
  assert.match(assessment.explanation, /gap/);
});

test("a property just within a historical distance never gets a guaranteed place", () => {
  const assessment = assessPilotAdmissions(THREE_YEARS, 819, null, ["2023/24", "2024/25", "2025/26"]);

  assert.notEqual(assessment.claim, "guaranteed-place");
  assert.equal(assessment.claim, "historical-only");
  assert.match(assessment.explanation, /distance alone/);
  assert.ok(assessment.explanation.includes(DISTANCE_INSUFFICIENT_EXPLANATION));
  assert.equal(assessment.isProbability, false);
});

test("admission probability estimates are unsupported", () => {
  assert.throws(() => estimateAdmissionProbability(THREE_YEARS, 800), /unsupported/);
});

test("pilot-authority coverage names covered and outside authorities", () => {
  const inside = pilotAdmissionCoverage(PILOT_ADMISSION_AUTHORITIES[0].code);
  const outside = pilotAdmissionCoverage("E09000099");

  assert.equal(inside.covered, true);
  assert.equal(outside.covered, false);
  assert.ok(PILOT_ADMISSION_AUTHORITIES.length >= 2);
  assert.ok(inside.pilotCodes.length >= 2);
  assert.match(inside.note, /pilot/i);
});

test("admissions questions record text only — no child details are collected", () => {
  const questions = addAdmissionQuestion([], "What counts as sibling priority?");

  assert.equal(questions.length, 1);
  assert.equal(questions[0].text, "What counts as sibling priority?");
  assert.ok(!("childAge" in questions[0]), "no child age collected");
  assert.ok(!("childName" in questions[0]), "no child name collected");
  assert.ok(!("dateOfBirth" in questions[0]), "no date of birth collected");
});

test("the distance-insufficiency explanation points at the current guidance", () => {
  assert.match(DISTANCE_INSUFFICIENT_EXPLANATION, /distance alone/i);
  assert.match(DISTANCE_INSUFFICIENT_EXPLANATION, /guidance/);
  assert.match(DISTANCE_INSUFFICIENT_EXPLANATION, /never guarantees/);
  assert.doesNotMatch(DISTANCE_INSUFFICIENT_EXPLANATION, /guaranteed-place/);
});

test("the admissions pilot shows only when some school has admission evidence", () => {
  const unavailable = { admissionEvidence: { kind: "unavailable" } };

  assert.equal(hasAdmissionEvidence([]), false);
  assert.equal(hasAdmissionEvidence([unavailable, unavailable]), false);
  assert.equal(hasAdmissionEvidence([unavailable, { admissionEvidence: { kind: "historical-reach" } }]), true);
});
