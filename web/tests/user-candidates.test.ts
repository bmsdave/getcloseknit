import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId, PropertyHistory } from "../src/lib/contracts";
import {
  buildUserCandidate,
  candidateConflicts,
  describeAskingVsAchieved,
  directoryFromFixtures,
  editUserCandidate,
  emptyCandidateStore,
  loadUserCandidates,
  resolveCandidateLinkage,
  saveUserCandidates,
  USER_CANDIDATES_KEY,
  type CandidateOfficial,
  type KnownAddress,
  type UserCandidateInput,
} from "../src/lib/user-candidates";
import { savedCandidateFor } from "../src/components/user-candidates";

const AREA = "uk:lsoa:E01000001" as GeographyId;
const OBSERVED_AT = "2026-09-06T10:00:00.000Z";

const DIRECTORY: KnownAddress[] = [
  { uprn: "100000000001", address: "1 Parliament Preview, London, SW1A 1AA", geographyId: AREA },
  { uprn: "100000000002", address: "Flat 1, 10 Test Road, London E1 1AA", geographyId: AREA },
  { uprn: "100000000003", address: "Flat 2, 10 Test Road, London E1 1AA", geographyId: AREA },
];

const HISTORY: PropertyHistory = {
  uprn: "100000000001",
  address: "1 Parliament Preview, London, SW1A 1AA",
  geographyId: AREA,
  transactions: [
    {
      date: "2022-11-03",
      nominalPrice: 570_000,
      floorAreaSquareMetres: 54,
      inflationAdjustedPrice: 625_000,
      localMarketAdjustedPrice: 668_000,
    },
  ],
  estimateDisclaimer: "Not a valuation.",
  sourceVersion: "preview-hmlr-epc-cpih-2026-06",
};

function official(overrides: Partial<CandidateOfficial> = {}): CandidateOfficial {
  return { history: HISTORY, epcAreasSqm: [54], ...overrides };
}

function input(overrides: Partial<UserCandidateInput> = {}): UserCandidateInput {
  return {
    addressText: "1 Parliament Preview, London, SW1A 1AA",
    uprn: "100000000001",
    askingKind: "sale",
    askingAmount: 600_000,
    priceUnit: "gbp-total",
    bedrooms: 2,
    floorAreaSqm: 54,
    notes: "Near the park",
    ...overrides,
  };
}

test("unknown address is kept as an unlinked candidate, never dropped", () => {
  const result = buildUserCandidate(
    input({ addressText: "99 Nowhere Lane, London E9 9ZZ", uprn: null }),
    DIRECTORY, [], OBSERVED_AT,
  );
  assert.equal(result.ok, true);
  assert.equal(result.candidate.linkage.status, "unlinked");
  assert.equal(result.candidate.linkage.reason, "unknown-address");
  assert.equal(result.candidate.uprn, null);
  assert.equal(result.candidate.address.value, "99 Nowhere Lane, London E9 9ZZ");
});

test("ambiguous flat stays unlinked and lists the matching flats", () => {
  const result = buildUserCandidate(
    input({ addressText: "10 Test Road, London E1 1AA", uprn: null }),
    DIRECTORY, [], OBSERVED_AT,
  );
  assert.equal(result.ok, true);
  assert.equal(result.candidate.linkage.status, "unlinked");
  assert.equal(result.candidate.linkage.reason, "ambiguous-address");
  assert.deepEqual(result.candidate.linkage.options, [
    "Flat 1, 10 Test Road, London E1 1AA",
    "Flat 2, 10 Test Road, London E1 1AA",
  ]);
  assert.equal(result.candidate.uprn, null);
});

test("invalid price units are rejected", () => {
  const result = buildUserCandidate(
    input({ askingKind: "sale", priceUnit: "gbp-per-month" }),
    DIRECTORY, [], OBSERVED_AT,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-price-units");
});

test("non-positive asking amounts are rejected", () => {
  const result = buildUserCandidate(input({ askingAmount: 0 }), DIRECTORY, [], OBSERVED_AT);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-price");
});

test("conflicting EPC area is kept and reported as a user-vs-official conflict", () => {
  const result = buildUserCandidate(input({ floorAreaSqm: 80 }), DIRECTORY, [], OBSERVED_AT);
  assert.equal(result.ok, true);
  const conflicts = candidateConflicts(result.candidate, official());
  const area = conflicts.find((conflict) => conflict.kind === "user-area-vs-epc");
  assert.ok(area);
  assert.match(area.detail, /80/);
  assert.match(area.detail, /54/);
});

test("malformed reference URLs are rejected", () => {
  for (const referenceUrl of ["not a url", "ftp://example.invalid/x", "example.invalid/flat"]) {
    const result = buildUserCandidate(input({ referenceUrl }), DIRECTORY, [], OBSERVED_AT);
    assert.equal(result.ok, false, referenceUrl);
    if (!result.ok) assert.equal(result.reason, "malformed-url");
  }
});

test("duplicate candidates are rejected", () => {
  const first = buildUserCandidate(input(), DIRECTORY, [], OBSERVED_AT);
  assert.equal(first.ok, true);
  const second = buildUserCandidate(input(), DIRECTORY, [first.candidate], OBSERVED_AT);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "duplicate-candidate");
});

test("a failed identity match preserves the candidate and links nothing", () => {
  const built = buildUserCandidate(
    input({ addressText: "10 Test Road, London E1 1AA", uprn: null }),
    DIRECTORY, [], OBSERVED_AT,
  );
  assert.equal(built.ok, true);
  const linkage = resolveCandidateLinkage(built.candidate, DIRECTORY);
  assert.equal(linkage.status, "unlinked");
  assert.equal(built.candidate.uprn, null);
  assert.equal(built.candidate.address.value, "10 Test Road, London E1 1AA");
  assert.equal(built.candidate.asking?.value.amount, 600_000);
});

test("verified UPRN links with the verified-uprn method at full confidence", () => {
  const built = buildUserCandidate(input(), DIRECTORY, [], OBSERVED_AT);
  assert.equal(built.ok, true);
  assert.equal(built.candidate.linkage.status, "linked");
  if (built.candidate.linkage.status === "linked") {
    assert.equal(built.candidate.linkage.matchMethod, "verified-uprn");
    assert.equal(built.candidate.linkage.confidence, 1);
  }
});

test("every entered field is marked unverified with an observation date", () => {
  const built = buildUserCandidate(input(), DIRECTORY, [], OBSERVED_AT);
  assert.equal(built.ok, true);
  const candidate = built.candidate;
  const builtWithUrl = buildUserCandidate(input({ referenceUrl: "https://example.invalid/listing/1" }), DIRECTORY, [], OBSERVED_AT);
  assert.equal(builtWithUrl.ok, true);
  const fields = [candidate.address, candidate.asking, candidate.bedrooms, candidate.floorAreaSqm, candidate.notes];
  if (builtWithUrl.ok) fields.push(builtWithUrl.candidate.referenceUrl);
  for (const field of fields) {
    assert.equal(field?.verification, "unverified");
    assert.equal(field?.observedAt, OBSERVED_AT);
  }
});

test("asking stays distinct from achieved prices and is never merged", () => {
  const built = buildUserCandidate(input({ askingAmount: 600_000 }), DIRECTORY, [], OBSERVED_AT);
  assert.equal(built.ok, true);
  const view = describeAskingVsAchieved(built.candidate, HISTORY);
  assert.equal(view.asking?.label, "Asking price (you entered, unverified)");
  assert.equal(view.asking?.amount, 600_000);
  assert.deepEqual(view.achieved.map((entry) => entry.nominalPrice), [570_000]);
  assert.match(view.note, /unverified/);
  assert.match(view.note, /achieved/);
  assert.equal("merged" in view, false);
  assert.equal("daysOnMarket" in view, false);
});

test("candidate views never infer days on market, photos, or descriptions", () => {
  const built = buildUserCandidate(input(), DIRECTORY, [], OBSERVED_AT);
  assert.equal(built.ok, true);
  const conflicts = candidateConflicts(built.candidate, official());
  const serialized = JSON.stringify({ candidate: built.candidate, conflicts });
  assert.doesNotMatch(serialized, /daysOnMarket/i);
  assert.doesNotMatch(serialized, /photo/i);
  assert.doesNotMatch(serialized, /description/i);
});

test("editing a candidate re-stamps the observation date and revalidates", () => {
  const built = buildUserCandidate(input(), DIRECTORY, [], OBSERVED_AT);
  assert.equal(built.ok, true);
  const edited = editUserCandidate(
    built.candidate, { askingAmount: 595_000, notes: "Reduced" }, "2026-09-07T10:00:00.000Z",
  );
  assert.equal(edited.ok, true);
  assert.equal(edited.candidate.asking?.value.amount, 595_000);
  assert.equal(edited.candidate.asking?.observedAt, "2026-09-07T10:00:00.000Z");
  assert.equal(edited.candidate.notes?.observedAt, "2026-09-07T10:00:00.000Z");
  assert.equal(edited.candidate.address.observedAt, OBSERVED_AT);
  const bad = editUserCandidate(built.candidate, { referenceUrl: "bogus" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, "malformed-url");
});

test("directoryFromFixtures exposes known official addresses for selection", () => {
  const directory = directoryFromFixtures(
    [{ id: "SW1A 1AA", geographyId: AREA, uprn: "100000000001" }],
    [HISTORY],
  );
  assert.deepEqual(directory, [
    { uprn: "100000000001", address: "1 Parliament Preview, London, SW1A 1AA", geographyId: AREA },
  ]);
});

test("empty store loads cleanly", () => {
  assert.deepEqual(emptyCandidateStore(), { schemaVersion: "user-candidate-store.v1", candidates: [] });
});

function stubWindow(store: Record<string, string> = {}, denied = false) {
  const globalScope = globalThis as Record<string, unknown>;
  const previous = globalScope.window;
  const getItem = (key: string) => {
    if (denied) throw new Error("denied");
    return store[key] ?? null;
  };
  const setItem = (key: string, value: string) => {
    if (denied) throw new Error("denied");
    store[key] = value;
  };
  globalScope.window = { localStorage: { getItem, setItem, removeItem: (key: string) => { delete store[key]; } } };
  return () => { globalScope.window = previous; };
}

test("candidates persist locally and reload with linkage intact", () => {
  const restore = stubWindow();
  try {
    const built = buildUserCandidate(input(), DIRECTORY, [], OBSERVED_AT);
    assert.equal(built.ok, true);
    assert.equal(saveUserCandidates({ ...emptyCandidateStore(), candidates: [built.candidate] }).ok, true);
    const scope = globalThis as unknown as { window: { localStorage: { getItem: (key: string) => string | null } } };
    assert.ok(scope.window.localStorage.getItem(USER_CANDIDATES_KEY)?.includes("verified-uprn"));
    const loaded = loadUserCandidates();
    assert.equal(loaded.corrupted, false);
    assert.equal(loaded.storageDenied, false);
    assert.equal(loaded.store.candidates.length, 1);
    assert.equal(loaded.store.candidates[0]?.linkage.status, "linked");
  } finally {
    restore();
  }
});

test("corrupted storage reports corruption and denied storage reports denial", () => {
  const restoreCorrupt = stubWindow({ [USER_CANDIDATES_KEY]: "not json" });
  try {
    assert.equal(loadUserCandidates().corrupted, true);
  } finally {
    restoreCorrupt();
  }
  const restoreDenied = stubWindow({}, true);
  try {
    const loaded = loadUserCandidates();
    assert.equal(loaded.storageDenied, true);
    assert.equal(saveUserCandidates(emptyCandidateStore()).ok, false);
  } finally {
    restoreDenied();
  }
});

test("Save this home finds an already saved home by UPRN, or by address when it has none", () => {
  const built = buildUserCandidate(input(), DIRECTORY, [], OBSERVED_AT);
  assert.ok(built.ok);
  const saved = [built.candidate];
  assert.equal(savedCandidateFor(saved, "100000000001", "Another spelling")?.id, built.candidate.id);
  assert.equal(savedCandidateFor(saved, null, "1 parliament preview london sw1a 1aa")?.id, built.candidate.id);
  assert.equal(savedCandidateFor(saved, "100000000002", "Flat 1, 10 Test Road, London E1 1AA"), null);
  assert.equal(built.candidate.linkage.status, "linked");
});

test("a home saved without an asking price keeps it null until the reader adds one", () => {
  const built = buildUserCandidate(input({ askingAmount: null }), DIRECTORY, [], OBSERVED_AT);
  if (!built.ok) throw new Error(built.reason);
  assert.equal(built.candidate.asking, null);
  assert.equal(describeAskingVsAchieved(built.candidate, null).asking, null);
  assert.deepEqual(candidateConflicts(built.candidate, { history: null, epcAreasSqm: [] }), []);
  // A second press with no price is a duplicate, not a second home.
  const again = buildUserCandidate(input({ askingAmount: null }), DIRECTORY, [built.candidate], OBSERVED_AT);
  assert.equal(again.ok, false);
  const notesOnly = editUserCandidate(built.candidate, { notes: "Nice light" }, OBSERVED_AT);
  if (!notesOnly.ok) throw new Error(notesOnly.reason);
  assert.equal(notesOnly.candidate.asking, null);
  const priced = editUserCandidate(built.candidate, { askingAmount: 650_000 }, "2026-09-07T10:00:00.000Z");
  if (!priced.ok) throw new Error(priced.reason);
  assert.deepEqual(priced.candidate.asking?.value, { kind: "sale", amount: 650_000, unit: "gbp-total" });
  assert.equal(priced.candidate.asking?.observedAt, "2026-09-07T10:00:00.000Z");
});
