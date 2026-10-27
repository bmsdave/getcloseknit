import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIONAL_PLANNING_SOURCE_ID,
  PILOT_BOROUGHS,
  REVIEWED_PLANNING_ROWS,
  boroughForSelectedArea,
  boroughSource,
  checkRecordCurrency,
  constraintsFor,
  councilRegisterUrl,
  deduplicateApplications,
  emptySearchMessage,
  estimatePlanningRisk,
  noCoverageMessage,
  searchPlanning,
  stageCounts,
  withdrawnFor,
} from "../src/lib/planning-evidence";
import * as planningEvidence from "../src/lib/planning-evidence";

const BANNED = [
  "no development",
  "no constraints exist",
  "no planning risk",
  "no risk",
  "guaranteed",
  "safe to assume",
];

function recordFor(reference: string) {
  const found = deduplicateApplications().find((entry) => entry.reference === reference);
  assert.ok(found, `reviewed record ${reference}`);
  return found;
}

test("duplicate national references collapse to the latest entry", () => {
  const records = deduplicateApplications();

  assert.equal(REVIEWED_PLANNING_ROWS.length, 8);
  assert.equal(records.length, 7);
  assert.equal(new Set(records.map((entry) => entry.reference)).size, records.length);
  assert.equal(recordFor("26/01024/FULL").updated, "2026-08-20");
});

test("withdrawn applications leave nearby results but stay labelled", () => {
  const result = searchPlanning("E09000033");

  assert.equal(result.status, "records");
  assert.deepEqual(
    result.records.map((entry) => entry.reference),
    ["24/05110/FULL", "25/08711/FULL", "26/01024/FULL"],
  );
  assert.equal(result.withdrawnExcluded, 1);

  const withdrawn = withdrawnFor("E09000033");
  assert.equal(withdrawn.length, 1);
  assert.equal(withdrawn[0]?.reference, "25/09120/FULL");
  assert.equal(withdrawn[0]?.status, "withdrawn");
  assert.match(withdrawn[0]?.explanation.toLowerCase() ?? "", /withdrawn/);
});

test("a borough outside the pilot reports unknown, never absent", () => {
  const result = searchPlanning("E09000028");

  assert.equal(result.status, "no-coverage");
  assert.equal(result.records.length, 0);
  assert.match(result.message.toLowerCase(), /coverage/);
  assert.match(result.message.toLowerCase(), /unknown/);
});

test("an empty search names the covered dataset", () => {
  const result = searchPlanning("E09000007", "completed");

  assert.equal(result.status, "no-records");
  assert.equal(result.records.length, 0);
  assert.match(result.message.toLowerCase(), /no records were returned/);
  assert.match(result.message.toLowerCase(), /covered dataset/);
});

test("no absolute no-risk message exists", () => {
  const messages = [
    emptySearchMessage("E09000007"),
    noCoverageMessage("E09000028"),
    searchPlanning("E09000028").message,
    searchPlanning("E09000007", "completed").message,
  ];
  for (const message of messages) {
    for (const phrase of BANNED) {
      assert.doesNotMatch(message.toLowerCase(), new RegExp(phrase), message);
    }
  }
});

test("stale national entries fail the currency check", () => {
  assert.equal(checkRecordCurrency(recordFor("2025/4412/P")).status, "stale");
});

test("current entries pass the currency check", () => {
  assert.equal(checkRecordCurrency(recordFor("26/01024/FULL")).status, "current");
});

test("entries without an update date are unverified", () => {
  const state = checkRecordCurrency(recordFor("2026/0455/P"));

  assert.equal(state.status, "unverified");
  assert.match(state.explanation.toLowerCase(), /unverified/);
});

test("overlapping constraints stay separately named", () => {
  assert.deepEqual(constraintsFor("25/08711/FULL").sort(), [
    "article-4-direction",
    "westminster-conservation-area",
  ]);
});

test("no merged constraint or risk score is exported", () => {
  const exported = planningEvidence as Record<string, unknown>;
  assert.equal(exported["constraintScore"], undefined);
  assert.equal(exported["constraint_score"], undefined);
  assert.equal(exported["planningScore"], undefined);
  assert.equal(exported["planning_score"], undefined);
});

test("planning-risk prediction is unsupported", () => {
  assert.throws(() => estimatePlanningRisk("26/01024/FULL"), /unsupported/);
});

test("planned, approved, and completed stay distinct", () => {
  assert.deepEqual(stageCounts(), { planned: 3, approved: 2, completed: 1 });
  assert.deepEqual(
    searchPlanning("E09000033", "planned").records.map((entry) => entry.reference),
    ["26/01024/FULL"],
  );
  assert.deepEqual(
    searchPlanning("E09000033", "approved").records.map((entry) => entry.reference),
    ["25/08711/FULL"],
  );
  assert.throws(() => searchPlanning("E09000033", "decided"), /unknown planning stage/);
});

test("pilot boroughs resolve to the national source, others get no adapter", () => {
  for (const borough of PILOT_BOROUGHS) {
    assert.equal(boroughSource(borough), NATIONAL_PLANNING_SOURCE_ID);
  }
  assert.throws(() => boroughSource("E09000028"), /no permitted.*interface/);
});

test("every record links its council register", () => {
  const url = councilRegisterUrl(recordFor("26/01024/FULL"));

  assert.match(url, /westminster\.gov\.uk/);
  assert.match(url, /26\/01024\/FULL/);
});

test("selected preview areas map to their pilot borough", () => {
  assert.equal(boroughForSelectedArea("uk:lsoa:E01000001"), "E09000033");
  assert.equal(boroughForSelectedArea("uk:lsoa:E01000002"), "E09000007");
  assert.equal(boroughForSelectedArea("uk:lsoa:E01000003"), "E09000028");
  assert.equal(boroughForSelectedArea(null), "E09000033");
});

test("evidence-level MSOA areas map to their pilot borough", () => {
  assert.equal(boroughForSelectedArea("uk:msoa:E02000001"), "E09000033");
  assert.equal(boroughForSelectedArea("uk:msoa:E02000002"), "E09000007");
  assert.equal(boroughForSelectedArea("uk:msoa:E02000003"), "E09000028");
});
