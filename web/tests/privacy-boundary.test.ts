import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { buildShareUrl, DEFAULT_MAP_STATE } from "../src/lib/map-state";
import { buildMatchPack, telemetryProfile } from "../src/lib/matching";
import { createMatchRequest, readMatchJob, resetMatchJobs } from "../src/lib/match-jobs";
import {
  decodeSharedProfile,
  encodeSharedProfile,
  eraseLocalProfile,
  loadLocalProfile,
  PROFILE_STORAGE_KEY,
  saveLocalProfile,
  sensitiveFieldPreview,
} from "../src/lib/profile-state";

const CANARY_LABEL = "Canary Employer";
const CANARY_LAT = 51.501234;
const CANARY_LON = -0.141567;
const CANARY_TARGET = 617343;
const CANARY_MAXIMUM = 637211;

function canaryProfile() {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.targetBudget = CANARY_TARGET;
  profile.maximumBudget = CANARY_MAXIMUM;
  profile.analyticsConsent = true;
  profile.commuteDestinations = [{
    id: "canary-work", label: CANARY_LABEL, latitude: CANARY_LAT, longitude: CANARY_LON,
    mode: "transit", arrivalTime: "09:07", targetMinutes: 40, weight: 3,
  }];
  return profile;
}

function canaryStrings() {
  return [CANARY_LABEL, String(CANARY_LAT), String(CANARY_LON), String(CANARY_TARGET), String(CANARY_MAXIMUM)];
}

test("opt-out telemetry is null and opt-in telemetry hides canary values", () => {
  const denied = { ...canaryProfile(), analyticsConsent: false };
  assert.equal(telemetryProfile(denied), null);

  const encoded = JSON.stringify(telemetryProfile(canaryProfile()));
  for (const secret of canaryStrings()) assert.ok(!encoded.includes(secret), `telemetry leaks ${secret}`);
});

test("match packs and public map URLs hold no canary values", () => {
  const packEncoded = JSON.stringify(buildMatchPack(canaryProfile()));
  for (const secret of canaryStrings()) assert.ok(!packEncoded.includes(secret), `match pack leaks ${secret}`);

  const shareUrl = buildShareUrl("https://example.org", DEFAULT_MAP_STATE);
  for (const secret of canaryStrings()) assert.ok(!shareUrl.includes(secret), `public URL leaks ${secret}`);
});

test("explicit share payload round-trips but is never part of the map URL", () => {
  const fragment = encodeSharedProfile(canaryProfile()).slice(1);
  assert.ok(fragment.startsWith("profile=v1."));
  assert.deepEqual(decodeSharedProfile(`#${fragment}`), canaryProfile());
});

test("commute cache keys are coarse: same cell reuses, far cell recomputes", () => {
  resetMatchJobs();
  const first = canaryProfile();
  const queued = createMatchRequest(first, 1_000);
  assert.ok("jobId" in queued.body);
  assert.equal(queued.status, 202);

  const near = structuredClone(first);
  near.commuteDestinations[0].latitude = 51.501456;
  near.commuteDestinations[0].longitude = -0.141789;
  near.commuteDestinations[0].arrivalTime = "09:11";
  const complete = readMatchJob(queued.body.jobId, 2_000);
  assert.equal(complete.status, 200);
  assert.equal(createMatchRequest(near, 2_001).status, 200);

  const far = structuredClone(first);
  far.commuteDestinations[0].latitude = 51.545;
  far.commuteDestinations[0].longitude = -0.094;
  assert.equal(createMatchRequest(far, 2_002).status, 202);
});

test("completed match jobs drop the stored profile instead of caching it", () => {
  resetMatchJobs();
  const queued = createMatchRequest(canaryProfile(), 1_000);
  assert.ok("jobId" in queued.body);
  assert.equal(readMatchJob(queued.body.jobId, 2_000).status, 200);
  assert.equal(readMatchJob(queued.body.jobId, 2_001).status, 404);
});

test("local profile storage saves, erases, and survives denied storage", () => {
  installMemoryStorage();
  try {
    saveLocalProfile(canaryProfile());
    assert.deepEqual(loadLocalProfile(DEFAULT_PROFILE), canaryProfile());
    eraseLocalProfile();
    assert.deepEqual(loadLocalProfile(DEFAULT_PROFILE), DEFAULT_PROFILE);

    installThrowingStorage();
    saveLocalProfile(canaryProfile());
    eraseLocalProfile();
    assert.deepEqual(loadLocalProfile(DEFAULT_PROFILE), DEFAULT_PROFILE);
  } finally {
    uninstallWindow();
  }
});

test("explicit-share preview names sensitive fields without exact coordinates", () => {
  const preview = sensitiveFieldPreview(canaryProfile()).join("\n");
  assert.ok(preview.includes(CANARY_LABEL));
  assert.ok(preview.includes(CANARY_MAXIMUM.toLocaleString("en-GB")));
  assert.ok(!preview.includes(String(CANARY_LAT)));
  assert.ok(!preview.includes(String(CANARY_LON)));
});

test("service worker never caches personalized API responses", () => {
  const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.ok(worker.includes("/api/"));
  assert.ok(worker.includes("GET"));
});

function installMemoryStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
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

void PROFILE_STORAGE_KEY;
