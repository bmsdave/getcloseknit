import assert from "node:assert/strict";
import test from "node:test";

import type {
  CommuteDestination,
  GeographyId,
  PropertyHistory,
} from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { EMPTY_LEASEHOLD_FACTS } from "../src/lib/leasehold";
import { assessNoiseCandidate } from "../src/lib/noise-evidence";
import {
  buildViewingChecklist,
  describeViewingProgress,
  emptyViewingStore,
  groupViewingCandidates,
  loadViewingPlan,
  questionState,
  recordCandidateVisit,
  saveViewingPlan,
  setQuestionNote,
  setQuestionStatus,
  type ViewingEvidence,
  agentQuestions,
} from "../src/lib/viewing-checklist";

test("five questions to ask the agent: the lease facts for buyers, damp and deposit for renters", () => {
  assert.deepEqual(agentQuestions("buy").map((question) => question.id),
    ["lease", "service-charge", "ground-rent", "major-works", "energy"]);
  assert.equal(agentQuestions("rent").length, 5);
  assert.match(agentQuestions("rent")[0].question, /damp and mould/);
  for (const question of [...agentQuestions("buy"), ...agentQuestions("rent")]) {
    assert.doesNotMatch(`${question.question} ${question.why}`, /\b(safe|surveyed|verified|legally)\b/i);
  }
});

const CANDIDATE = { id: "uk:lsoa:E01000001" as GeographyId, name: "Westminster preview" };
const FORBIDDEN = /\b(surveyed|safe|legally|verified|guarantee)\b/i;

function destination(label: string): CommuteDestination {
  return {
    id: `dest-${label}`, label, latitude: 51.5, longitude: -0.12,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 45, weight: 3,
  };
}

function evidence(overrides: Partial<ViewingEvidence> = {}): ViewingEvidence {
  return {
    profile: DEFAULT_PROFILE,
    lease: EMPTY_LEASEHOLD_FACTS,
    history: null,
    noise: null,
    costUnknowns: [],
    ...overrides,
  };
}

function historyWithArea(): PropertyHistory {
  return {
    uprn: "100000000001",
    address: "1 Parliament Preview, London, SW1A 1AA",
    geographyId: "uk:lsoa:E01000001",
    transactions: [
      {
        date: "2022-11-03", nominalPrice: 570_000, floorAreaSquareMetres: null,
        inflationAdjustedPrice: 625_000,
        localMarketAdjustedPrice: 668_000,
      },
    ],
    estimateDisclaimer: "Not a valuation.",
    sourceVersion: "preview-test",
  };
}

test("missing lease evidence creates a lease-documents question", () => {
  const questions = buildViewingChecklist(CANDIDATE, evidence({
    lease: { ...EMPTY_LEASEHOLD_FACTS, transactionTenure: "leasehold" },
  }));
  assert.ok(questions.some((question) => question.kind === "lease-documents"));
});

test("missing floor-area evidence creates a room-layout question", () => {
  const questions = buildViewingChecklist(CANDIDATE, evidence({ history: historyWithArea() }));

  const layout = questions.find((question) => question.kind === "room-layout");
  assert.ok(layout);
  assert.match(layout.text, /2022-11-03/);
});

test("unrelated concerns stay out without context", () => {
  const questions = buildViewingChecklist(CANDIDATE, evidence({
    lease: { ...EMPTY_LEASEHOLD_FACTS, transactionTenure: "freehold" },
  }));
  assert.deepEqual(questions, []);
});

test("renting adds a damp-mould question; buying does not", () => {
  const renting = buildViewingChecklist(CANDIDATE, evidence({
    profile: { ...DEFAULT_PROFILE, market: "rent", targetBudget: 2_000, maximumBudget: 2_400 },
  }));
  const damp = renting.find((question) => question.id === "damp-mould");
  assert.ok(damp);
  assert.equal(damp.kind, "damp-mould");
  assert.match(damp.text, /damp and mould/);
  assert.doesNotMatch(damp.text, FORBIDDEN);
  assert.equal(buildViewingChecklist(CANDIDATE, evidence()).some((question) => question.id === "damp-mould"), false);
});

test("saved plans keyed before damp-mould existed still load and gain it unvisited", () => {
  installMemoryStorage({
    "close-knit.viewing-checklist.v1": JSON.stringify({
      schemaVersion: "viewing-checklist.v1",
      candidates: { [CANDIDATE.id]: { questions: { survey: { status: "checked", note: "", updatedAt: "2026-01-01T00:00:00.000Z" } }, visits: [] } },
    }),
  });
  try {
    const loaded = loadViewingPlan();
    assert.equal(loaded.corrupted, false);
    assert.equal(questionState(loaded.store, CANDIDATE.id, "survey").status, "checked");
    assert.equal(questionState(loaded.store, CANDIDATE.id, "damp-mould").status, "unvisited");
  } finally {
    uninstallWindow();
  }
});

test("commute destinations create one trial question each", () => {
  const questions = buildViewingChecklist(CANDIDATE, evidence({
    profile: {
      ...DEFAULT_PROFILE,
      commuteDestinations: [destination("Office A"), destination("Office B")],
    },
  }));
  const trials = questions.filter((question) => question.kind === "commute-trial");
  assert.equal(trials.length, 2);
  assert.match(trials[0].text, /Office A/);
  assert.match(trials[1].text, /Office B/);
});

test("redacted destinations omit precise labels but keep the trial", () => {
  const questions = buildViewingChecklist(CANDIDATE, evidence({
    profile: {
      ...DEFAULT_PROFILE,
      commuteDestinations: [destination("Office A")],
    },
  }), { redactDestinations: true });
  const trials = questions.filter((question) => question.kind === "commute-trial");
  assert.equal(trials.length, 1);
  assert.doesNotMatch(trials[0].text, /Office A/);
  assert.match(trials[0].text, /transit/);
});

test("mapped noise creates evening-visit and noise-observation questions", () => {
  const questions = buildViewingChecklist(CANDIDATE, evidence({
    noise: assessNoiseCandidate("uk:lsoa:E01000003"),
  }));
  assert.ok(questions.some((question) => question.kind === "evening-visit"));
  assert.ok(questions.some((question) => question.kind === "noise-observation"));
});

test("no screening means no noise questions", () => {
  const questions = buildViewingChecklist(CANDIDATE, evidence({ noise: null }));
  assert.ok(questions.every((question) => question.kind !== "evening-visit"));
  assert.ok(questions.every((question) => question.kind !== "noise-observation"));
});

test("a concrete history creates a survey question, none without one", () => {
  const withHistory = buildViewingChecklist(CANDIDATE, evidence({ history: historyWithArea() }));
  assert.ok(withHistory.some((question) => question.kind === "survey"));
  const without = buildViewingChecklist(CANDIDATE, evidence({ history: null }));
  assert.ok(without.every((question) => question.kind !== "survey"));
  assert.ok(without.every((question) => question.kind !== "room-layout"));
});

test("open cost unknowns create a total-cost question naming them", () => {
  const questions = buildViewingChecklist(CANDIDATE, evidence({
    costUnknowns: ["service charge", "council tax"],
  }));
  const cost = questions.find((question) => question.kind === "total-cost");
  assert.ok(cost);
  assert.match(cost.text, /service charge/);
  const without = buildViewingChecklist(CANDIDATE, evidence());
  assert.ok(without.every((question) => question.kind !== "total-cost"));
});

test("question states move unvisited, checked, and unresolved", () => {
  let store = emptyViewingStore();
  assert.equal(questionState(store, CANDIDATE.id, "noise-observation").status, "unvisited");
  store = setQuestionStatus(store, CANDIDATE.id, "noise-observation", "checked");
  assert.equal(questionState(store, CANDIDATE.id, "noise-observation").status, "checked");
  store = setQuestionStatus(store, CANDIDATE.id, "noise-observation", "unresolved");
  assert.equal(questionState(store, CANDIDATE.id, "noise-observation").status, "unresolved");
});

test("private notes cap at the shortlist-notes limit", () => {
  let store = emptyViewingStore();
  store = setQuestionNote(store, CANDIDATE.id, "noise-observation", "x".repeat(600));
  assert.equal(questionState(store, CANDIDATE.id, "noise-observation").note.length, 500);
  store = setQuestionNote(store, CANDIDATE.id, "noise-observation", "   ");
  assert.equal(questionState(store, CANDIDATE.id, "noise-observation").note, "");
});

function installMemoryStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

function uninstallWindow() {
  delete (globalThis as Record<string, unknown>).window;
}

test("recorded visits persist per candidate with slot and order", () => {
  installMemoryStorage();
  try {
    let store = emptyViewingStore();
    store = recordCandidateVisit(store, CANDIDATE.id, "evening");
    store = recordCandidateVisit(store, CANDIDATE.id, "weekend");
    assert.deepEqual(
      store.candidates[CANDIDATE.id].visits.map((visit) => [visit.id, visit.slot]),
      [["visit-1", "evening"], ["visit-2", "weekend"]],
    );
    assert.equal(saveViewingPlan(store).ok, true);
    const loaded = loadViewingPlan();
    assert.equal(loaded.storageDenied, false);
    assert.deepEqual(loaded.store.candidates[CANDIDATE.id].visits.length, 2);
  } finally {
    uninstallWindow();
  }
});

test("corrupted storage loads empty and reports it", () => {
  installMemoryStorage({ "close-knit.viewing-checklist.v1": "{not json" });
  try {
    const loaded = loadViewingPlan();
    assert.equal(loaded.corrupted, true);
    assert.deepEqual(loaded.store, emptyViewingStore());
  } finally {
    uninstallWindow();
  }
});

test("progress never labels a property surveyed, safe, or legally verified", () => {
  for (const states of [
    [],
    ["checked", "checked"],
    ["checked", "unresolved", "unvisited"],
  ]) {
    const line = describeViewingProgress(states as ("checked" | "unresolved" | "unvisited")[]);
    assert.doesNotMatch(line, FORBIDDEN);
  }
  const done = describeViewingProgress(["checked", "checked"]);
  assert.match(done, /own observation/);
});

test("every generated question avoids assurance labels", () => {
  const questions = buildViewingChecklist(CANDIDATE, evidence({
    profile: { ...DEFAULT_PROFILE, commuteDestinations: [destination("Office A")] },
    lease: { ...EMPTY_LEASEHOLD_FACTS, transactionTenure: "leasehold" },
    history: historyWithArea(),
    noise: assessNoiseCandidate("uk:lsoa:E01000003"),
    costUnknowns: ["service charge"],
  }));
  assert.ok(questions.length >= 7);
  for (const question of questions) assert.doesNotMatch(question.text, FORBIDDEN);
  assert.ok(questions.every((question) => !/aircraft/i.test(question.text)));
});

test("viewing groups share an area and only multi-viewing groups link a route", () => {
  const groups = groupViewingCandidates(
    [
      { id: "uk:lsoa:E01000001" as GeographyId, name: "First" },
      { id: "uk:lsoa:E01000002" as GeographyId, name: "Second" },
      { id: "uk:lsoa:E01000003" as GeographyId, name: "Third" },
    ],
    (id) => (id.endsWith("3") ? "uk:lad:E09000002" : "uk:lad:E09000001"),
  );
  assert.equal(groups.length, 2);
  const pair = groups.find((group) => group.members.length === 2)!;
  assert.match(pair.routeUrl ?? "", /^https:\/\//);
  const single = groups.find((group) => group.members.length === 1)!;
  assert.equal(single.routeUrl, null);
});
