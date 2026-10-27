import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId, MatchPack } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { buildMatchPack } from "../src/lib/matching";
import {
  buildShortlist,
  comparedBriefHref,
  decodeSharedShortlist,
  deleteShortlist,
  describeShareAssumptions,
  describeShortlistDetails,
  DEFAULT_SHORTLIST_NAME,
  saveAreaToShortlist,
  formatSavedTime,
  encodeSharedShortlist,
  importSharedShortlist,
  isShortlistReleaseAvailable,
  LEGACY_SHORTLIST_KEYS,
  listShortlists,
  MAX_SHORTLIST_FRAGMENT_LENGTH,
  migrateLegacyShortlists,
  readSavedAreaCount,
  refreshShortlistEvidence,
  removeAreaFromShortlists,
  resolveShortlistCandidates,
  SAVED_SHORTLISTS_KEY,
  saveShortlist,
  savedAreas,
  shortlistBriefHref,
  type SavedShortlist,
} from "../src/lib/saved-shortlists";

const IDS: GeographyId[] = ["uk:lsoa:E01000001", "uk:lsoa:E01000002"];
const NAMES: Record<string, string> = {
  "uk:lsoa:E01000001": "Westminster preview",
  "uk:lsoa:E01000002": "North London preview",
};

function pack(): MatchPack {
  return buildMatchPack(structuredClone(DEFAULT_PROFILE));
}

function sample(): SavedShortlist {
  return buildShortlist({
    name: "Two-bed shortlist",
    candidates: IDS,
    candidateNames: NAMES,
    profile: structuredClone(DEFAULT_PROFILE),
    mode: "demo",
    release: "preview-2026-09",
    notes: "Visit in person before offering.",
    evidence: pack(),
  });
}

function installMemoryStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    __store: store,
  };
  return store;
}

function installThrowingStorage() {
  const denied = () => { throw new DOMException("denied", "SecurityError"); };
  (globalThis as Record<string, unknown>).window = {
    localStorage: { getItem: denied, setItem: denied, removeItem: denied },
  };
}

function uninstallWindow() {
  delete (globalThis as Record<string, unknown>).window;
}

test("saved shortlists round-trip name, candidates, profile version, mode, release, and notes", () => {
  installMemoryStorage();
  try {
    const saved = saveShortlist(sample());
    assert.equal(saved.ok, true);
    const listed = listShortlists();
    assert.equal(listed.storageDenied, false);
    assert.equal(listed.corrupted, false);
    assert.equal(listed.shortlists.length, 1);
    const restored = listed.shortlists[0];
    assert.equal(restored.name, "Two-bed shortlist");
    assert.deepEqual(restored.candidates, IDS);
    assert.equal(restored.profile.schemaVersion, "preference-profile.v1");
    assert.equal(restored.mode, "demo");
    assert.equal(restored.release, "preview-2026-09");
    assert.equal(restored.notes, "Visit in person before offering.");
    assert.equal(restored.evidence.length, 2);
  } finally {
    uninstallWindow();
  }
});

test("legacy formats migrate to the current schema and legacy keys are removed", () => {
  const legacyArray = JSON.stringify(["uk:lsoa:E01000001", "uk:lsoa:E01000002"]);
  const legacyObject = JSON.stringify([{
    name: "Old list",
    areas: ["uk:lsoa:E01000003"],
    profile: structuredClone(DEFAULT_PROFILE),
  }]);
  const { migrated } = migrateLegacyShortlists([
    JSON.parse(legacyArray),
    ...JSON.parse(legacyObject),
  ]);
  assert.equal(migrated.length, 2);
  for (const entry of migrated) {
    assert.equal(entry.schemaVersion, "saved-shortlist.v1");
    assert.equal(entry.profile.schemaVersion, "preference-profile.v1");
  }

  installMemoryStorage({ [LEGACY_SHORTLIST_KEYS[0]]: legacyArray });
  try {
    const listed = listShortlists();
    assert.equal(listed.shortlists.length, 1);
    assert.deepEqual(listed.shortlists[0].candidates, IDS);
    const store = (globalThis as Record<string, any>).window.__store as Map<string, string>;
    for (const key of LEGACY_SHORTLIST_KEYS) assert.equal(store.has(key), false);
    assert.ok(store.has(SAVED_SHORTLISTS_KEY));
  } finally {
    uninstallWindow();
  }
});

test("denied storage reports instead of throwing", () => {
  installThrowingStorage();
  try {
    assert.deepEqual(saveShortlist(sample()), { ok: false, reason: "storage-denied" });
    const listed = listShortlists();
    assert.equal(listed.storageDenied, true);
    assert.deepEqual(listed.shortlists, []);
    assert.deepEqual(deleteShortlist("anything"), { ok: false, reason: "storage-denied" });
  } finally {
    uninstallWindow();
  }
});

test("corrupted state is reported while valid entries still load", () => {
  installMemoryStorage({ [SAVED_SHORTLISTS_KEY]: "not-json{{{garbage" });
  try {
    const listed = listShortlists();
    assert.equal(listed.corrupted, true);
    assert.deepEqual(listed.shortlists, []);
  } finally {
    uninstallWindow();
  }
});

test("removed or renamed candidates are reported, never substituted", () => {
  const shortlist = sample();
  const current = pack();
  const removed = { ...current, values: current.values.filter((v) => v.geographyId !== IDS[1]) };
  const resolved = resolveShortlistCandidates(shortlist, removed);
  assert.equal(resolved.matched.length, 1);
  assert.equal(resolved.matched[0].geographyId, IDS[0]);
  assert.equal(resolved.missing.length, 1);
  assert.equal(resolved.missing[0].geographyId, IDS[1]);
  assert.match(resolved.missing[0].reason, /removed-or-renamed/);
  assert.ok(!resolved.matched.some((m) => m.geographyId === IDS[1]));
});

test("oversized share fragments are rejected", () => {
  const fragment = `#shortlist=v1.${"a".repeat(MAX_SHORTLIST_FRAGMENT_LENGTH)}`;
  const decoded = decodeSharedShortlist(fragment);
  assert.equal(decoded.ok, false);
  assert.equal((decoded as { reason: string }).reason, "too-large");
  assert.equal(decodeSharedShortlist("#profile=v1.whatever").ok, false);
  assert.equal(decodeSharedShortlist("#shortlist=v1.!!!not-base64!!!").ok, false);
});

test("an unavailable historical release is explicit and never swapped", () => {
  const shortlist = sample();
  assert.equal(isShortlistReleaseAvailable(shortlist, ["preview-2026-09"]), true);
  assert.equal(isShortlistReleaseAvailable(shortlist, ["official-2026-06"]), false);
  const resolved = resolveShortlistCandidates(shortlist, pack());
  assert.equal(resolved.release, "preview-2026-09");
  assert.equal(resolved.releaseAvailable, false);
});

test("share preview is redacted by default: no precise destinations or notes", () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.commuteDestinations = [{
    id: "work", label: "Canary Employer", latitude: 51.501234, longitude: -0.141567,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 40, weight: 3,
  }];
  const shortlist = buildShortlist({
    name: "Redaction check", candidates: IDS, candidateNames: NAMES,
    profile, mode: "demo", release: "preview-2026-09",
    notes: "Private canary note", evidence: pack(),
  });
  const fragment = encodeSharedShortlist(shortlist);
  const decoded = decodeSharedShortlist(fragment);
  assert.equal(decoded.ok, true);
  const payload = JSON.stringify(decoded);
  for (const secret of ["Canary Employer", "51.501234", "-0.141567", "Private canary note"]) {
    assert.ok(!payload.includes(secret), `redacted share leaks ${secret}`);
  }
  const assumptions = describeShareAssumptions(
    (decoded as Extract<typeof decoded, { ok: true }>).share,
  );
  const text = assumptions.join("\n");
  // Plain words in the list; the profile version and release id only behind "Details".
  assert.ok(!text.includes("preference-profile.v1"));
  assert.ok(!text.includes("preview-2026-09"));
  const details = describeShortlistDetails((decoded as Extract<typeof decoded, { ok: true }>).share);
  assert.ok(details.includes("preference-profile.v1"));
  assert.ok(details.includes("preview-2026-09"));
  assert.ok(text.includes("2 candidates"));
  assert.ok(text.includes("places excluded"));
  assert.ok(text.includes("Budget excluded"));
  assert.ok(text.includes("notes excluded"));
});

test("explicit opt-in share includes destinations and notes after preview", () => {
  const shortlist = sample();
  shortlist.profile.commuteDestinations = [{
    id: "work", label: "Office", latitude: 51.5, longitude: -0.14,
    mode: "transit", arrivalTime: "09:00", targetMinutes: 40, weight: 3,
  }];
  const fragment = encodeSharedShortlist(shortlist, { includeDestinations: true, includeNotes: true });
  const decoded = decodeSharedShortlist(fragment);
  assert.equal(decoded.ok, true);
  const share = (decoded as Extract<typeof decoded, { ok: true }>).share;
  assert.equal(share.profile.commuteDestinations.length, shortlist.profile.commuteDestinations.length);
  assert.equal(share.notes, shortlist.notes);
  assert.ok(describeShareAssumptions(share).join("\n").includes("places included"));
});

test("restore keeps the saved snapshot until an explicit refresh", () => {
  const shortlist = sample();
  const savedScores = shortlist.evidence.map((entry) => entry.score);
  const newer = pack();
  const refreshed = refreshShortlistEvidence(shortlist, newer);
  assert.deepEqual(shortlist.evidence.map((entry) => entry.score), savedScores);
  assert.equal(refreshed.evidence.length, shortlist.candidates.length);
  assert.notEqual(refreshed.updatedAt, shortlist.updatedAt);
});

test("imported shares get a fresh identity and delete removes by id", () => {
  installMemoryStorage();
  try {
    const original = sample();
    saveShortlist(original);
    const fragment = encodeSharedShortlist(original);
    const decoded = decodeSharedShortlist(fragment);
    assert.equal(decoded.ok, true);
    const imported = importSharedShortlist(
      (decoded as Extract<typeof decoded, { ok: true }>).share,
    );
    assert.notEqual(imported.id, original.id);
    assert.equal(imported.name, original.name);
    saveShortlist(imported);
    assert.equal(listShortlists().shortlists.length, 2);
    assert.equal(deleteShortlist(original.id).ok, true);
    assert.deepEqual(
      listShortlists().shortlists.map((entry) => entry.id),
      [imported.id],
    );
  } finally {
    uninstallWindow();
  }
});

test("saved times read in London time, never as an ISO string", () => {
  assert.equal(formatSavedTime("2026-10-10T15:27:00.000Z"), "10 Oct 2026, 16:27");
  assert.equal(formatSavedTime("2026-01-05T09:03:00.000Z"), "5 Jan 2026, 09:03");
  assert.equal(formatSavedTime("not a time"), "an earlier visit");
});

test("Save area starts My shortlist, then adds to the most recent shortlist", () => {
  installMemoryStorage();
  const area = (code: string) => ({ geographyId: `uk:lsoa:${code}` as GeographyId, name: `Area ${code}`, profile: DEFAULT_PROFILE, mode: "demo" as const, release: "preview-2026-09" });
  const first = saveAreaToShortlist(area("E01000001"));
  assert.equal(first.ok && first.created, true);
  assert.equal(first.ok && first.shortlist.name, DEFAULT_SHORTLIST_NAME);
  const older = sample();
  older.updatedAt = "2020-01-01T00:00:00.000Z";
  saveShortlist(older);
  const second = saveAreaToShortlist(area("E01000004"));
  assert.ok(second.ok && !second.created);
  assert.deepEqual(second.ok && second.shortlist.candidates, ["uk:lsoa:E01000001", "uk:lsoa:E01000004"]);
  const again = saveAreaToShortlist(area("E01000004"));
  assert.equal(again.ok && again.already, true);
  saveAreaToShortlist(area("E01000005"));
  saveAreaToShortlist(area("E01000006"));
  const full = saveAreaToShortlist(area("E01000007"));
  assert.equal(!full.ok && full.reason, "full");
  const stored = listShortlists().shortlists;
  assert.equal(stored.length, 2);
  assert.equal(stored.find((entry) => entry.name === DEFAULT_SHORTLIST_NAME)?.candidates.length, 4);
  installThrowingStorage();
  const denied = saveAreaToShortlist(area("E01000008"));
  assert.equal(!denied.ok && denied.reason, "storage-denied");
  uninstallWindow();
});

test("the header's saved-area count reads distinct areas and survives junk", () => {
  assert.equal(readSavedAreaCount(null), 0);
  assert.equal(readSavedAreaCount("not json"), 0);
  assert.equal(readSavedAreaCount("{}"), 0);
  assert.equal(readSavedAreaCount(JSON.stringify([
    { candidates: ["uk:lsoa:E01000001", "uk:lsoa:E01000002"] },
    { candidates: ["uk:lsoa:E01000002", 7] },
    null,
  ])), 2);
});

test("Unsave an area: it leaves every shortlist, and a shortlist left empty goes", () => {
  installMemoryStorage();
  const area = (code: string) => ({ geographyId: `uk:lsoa:${code}` as GeographyId, name: `Area ${code}`, profile: DEFAULT_PROFILE, mode: "demo" as const, release: "preview-2026-09" });
  saveAreaToShortlist(area("E01000001"));
  saveAreaToShortlist(area("E01000004"));
  const named = sample();
  named.updatedAt = "2020-01-01T00:00:00.000Z";
  saveShortlist(named);
  // Saved areas: once each, newest shortlist first.
  assert.deepEqual(savedAreas(listShortlists().shortlists).map((entry) => entry.geographyId),
    ["uk:lsoa:E01000001", "uk:lsoa:E01000004", "uk:lsoa:E01000002"]);
  assert.equal(removeAreaFromShortlists("uk:lsoa:E01000001" as GeographyId).ok, true);
  const left = listShortlists().shortlists;
  assert.deepEqual(left.find((entry) => entry.name === DEFAULT_SHORTLIST_NAME)?.candidates, ["uk:lsoa:E01000004"]);
  assert.deepEqual(left.find((entry) => entry.id === named.id)?.candidates, ["uk:lsoa:E01000002"]);
  assert.equal(left.find((entry) => entry.id === named.id)?.candidateNames["uk:lsoa:E01000001"], undefined);
  removeAreaFromShortlists("uk:lsoa:E01000004" as GeographyId);
  assert.deepEqual(listShortlists().shortlists.map((entry) => entry.id), [named.id]);
  uninstallWindow();
});

test("the brief's own link: /brief#shortlist= for the compared areas, none with nothing compared", () => {
  const href = comparedBriefHref({ pack: pack(), compared: IDS, profile: structuredClone(DEFAULT_PROFILE), mode: "demo" });
  assert.ok(href?.startsWith("/brief#shortlist=v1."));
  const decoded = decodeSharedShortlist(href!.slice("/brief".length));
  assert.ok(decoded.ok);
  assert.deepEqual(decoded.ok && decoded.share.candidates, IDS);
  assert.equal(decoded.ok && decoded.share.redacted, true);
  assert.equal(comparedBriefHref({ pack: pack(), compared: [], profile: DEFAULT_PROFILE, mode: "demo" }), null);
  assert.equal(shortlistBriefHref(sample())?.startsWith("/brief#shortlist=v1."), true);
});
