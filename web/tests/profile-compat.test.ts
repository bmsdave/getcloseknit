import assert from "node:assert/strict";
import test from "node:test";

import type { PreferenceProfile } from "../src/lib/contracts";
import {
  decodeSharedProfile,
  encodeSharedProfile,
  eraseLocalProfile,
  loadLocalProfile,
  loadWizardStage,
  PROFILE_STORAGE_KEY,
  saveLocalProfile,
  saveWizardStage,
} from "../src/lib/profile-state";

// Artifacts produced by the PRE-REDESIGN implementation (21680e3, before the
// UX-21..28 wizard work) for the profile below. The profile schema, storage
// key, and fragment codec are byte-identical between that revision and the
// current one; these pins fail if the durable contract ever drifts.
const PRE_REDESIGN_STORED =
  `{"schemaVersion":"preference-profile.v1","market":"buy","targetBudget":500000,` +
  `"maximumBudget":650000,"bedrooms":2,"forecastHorizon":"1y","factors":[` +
  `{"factorId":"affordability","weight":3,"direction":"target-range","minimumUtility":null,"maximumUtility":null},` +
  `{"factorId":"crime","weight":3,"direction":"lower","minimumUtility":60,"maximumUtility":null},` +
  `{"factorId":"commute","weight":3,"direction":"lower","minimumUtility":null,"maximumUtility":null},` +
  `{"factorId":"schools","weight":3,"direction":"higher","minimumUtility":null,"maximumUtility":null}],` +
  `"commuteDestinations":[],"school":{"phases":["primary"],"characteristics":[],` +
  `"facetWeights":{"progress":3,"attainment":2,"attendance":1},"shortlistUrns":[],"desiredSchoolCount":3},` +
  `"analyticsConsent":false}`;
const PRE_REDESIGN_FRAGMENT =
  "#profile=v1.WzAsNTAwMDAwLDY1MDAwMCwyLDEsW1swLDMsMixudWxsLG51bGxdLFszLDMsMSw2MCxudWxsXSxbNywzLDEsbnVsbCxudWxsXSxbOCwzLDAsbnVsbCxudWxsXV0sW10sW1sicHJpbWFyeSJdLFtdLFtbInByb2dyZXNzIiwzXSxbImF0dGFpbm1lbnQiLDJdLFsiYXR0ZW5kYW5jZSIsMV1dLFtdLDNdLDBd";

function preRedesignProfile(): PreferenceProfile {
  return JSON.parse(PRE_REDESIGN_STORED) as PreferenceProfile;
}

test("profiles created before the redesign load unchanged", () => {
  const store = installMemoryStores();
  try {
    store.local.set(PROFILE_STORAGE_KEY, PRE_REDESIGN_STORED);
    assert.deepEqual(loadLocalProfile(fallbackProfile()), preRedesignProfile());
    assert.deepEqual(decodeSharedProfile(PRE_REDESIGN_FRAGMENT), preRedesignProfile());
  } finally {
    uninstallWindow();
  }
});

test("newly saved profiles decode with the existing utilities", () => {
  const store = installMemoryStores();
  try {
    const profile = { ...preRedesignProfile(), targetBudget: 425000, maximumBudget: 500000 };
    saveLocalProfile(profile);
    assert.deepEqual(loadLocalProfile(fallbackProfile()), profile);
    assert.deepEqual(decodeSharedProfile(encodeSharedProfile(profile)), profile);
    assert.equal(store.local.get(PROFILE_STORAGE_KEY), JSON.stringify(profile));
  } finally {
    uninstallWindow();
  }
});

test("a shared link with the tenth factor (index 9) round-trips and old links still decode", () => {
  installMemoryStores();
  try {
    const profile = preRedesignProfile();
    profile.factors.push({
      factorId: "station-access", weight: 4, direction: "lower", minimumUtility: 50, maximumUtility: null,
    });
    const fragment = encodeSharedProfile(profile);
    assert.deepEqual(decodeSharedProfile(fragment), profile);
    const encoded = JSON.parse(Buffer.from(fragment.split(".")[1], "base64url").toString("utf8"));
    assert.deepEqual(encoded[5].at(-1), [9, 4, 1, 50, null]);
    assert.deepEqual(decodeSharedProfile(PRE_REDESIGN_FRAGMENT), preRedesignProfile());
  } finally {
    uninstallWindow();
  }
});

test("zones ride in an optional tenth fragment element and older links still decode", () => {
  installMemoryStores();
  try {
    const profile = preRedesignProfile();
    // Without zones the fragment is byte-identical to the pre-zones codec.
    assert.equal(encodeSharedProfile(profile), PRE_REDESIGN_FRAGMENT);
    assert.equal(encodeSharedProfile({ ...profile, zones: [] }), PRE_REDESIGN_FRAGMENT);
    profile.zones = [
      { kind: "station", stationId: "osm:n5614077964", maxWalkMinutes: 15, label: "Oxford Circus" },
      { kind: "borough", id: "uk:lad:E09000007" },
      { kind: "lsoas", ids: ["uk:lsoa:E01000001", "uk:lsoa:E01000002"], label: "Near friends" },
    ];
    const fragment = encodeSharedProfile(profile);
    assert.deepEqual(decodeSharedProfile(fragment), profile);
    const encoded = JSON.parse(Buffer.from(fragment.split(".")[1], "base64url").toString("utf8"));
    assert.equal(encoded.length, 10);
    assert.deepEqual(encoded[9], [
      [0, "osm:n5614077964", 15, "Oxford Circus"],
      [1, "uk:lad:E09000007"],
      [2, ["uk:lsoa:E01000001", "uk:lsoa:E01000002"], "Near friends"],
    ]);
    assert.deepEqual(decodeSharedProfile(PRE_REDESIGN_FRAGMENT), preRedesignProfile());
    assert.equal("zones" in decodeSharedProfile(PRE_REDESIGN_FRAGMENT)!, false);
  } finally {
    uninstallWindow();
  }
});

test("wizard stage stays ephemeral and never enters the durable profile store", () => {
  const store = installMemoryStores();
  try {
    assert.equal(loadWizardStage(1), 1);
    saveWizardStage(3);
    assert.equal(loadWizardStage(1), 3);
    assert.equal(store.local.size, 0);
  } finally {
    uninstallWindow();
  }
});

test("erasing the profile also resets the ephemeral wizard stage", () => {
  installMemoryStores();
  try {
    saveLocalProfile(preRedesignProfile());
    saveWizardStage(3);
    eraseLocalProfile();
    assert.deepEqual(loadLocalProfile(fallbackProfile()), fallbackProfile());
    assert.equal(loadWizardStage(1), 1);
  } finally {
    uninstallWindow();
  }
});

test("wizard stage degrades to the fallback when session storage is denied", () => {
  installThrowingStores();
  try {
    assert.equal(loadWizardStage(2), 2);
    saveWizardStage(3);
    assert.equal(loadWizardStage(2), 2);
  } finally {
    uninstallWindow();
  }
});

function fallbackProfile(): PreferenceProfile {
  return {
    ...preRedesignProfile(),
    market: "rent",
    targetBudget: 1500,
    maximumBudget: 2000,
    bedrooms: 1,
    forecastHorizon: "5y",
    analyticsConsent: true,
  };
}

function installMemoryStores(): { local: Map<string, string> } {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => void local.set(key, value),
      removeItem: (key: string) => void local.delete(key),
    },
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => void session.set(key, value),
      removeItem: (key: string) => void session.delete(key),
    },
  };
  return { local };
}

function installThrowingStores() {
  const denied = () => { throw new DOMException("denied", "SecurityError"); };
  (globalThis as Record<string, unknown>).window = {
    localStorage: { getItem: denied, setItem: denied, removeItem: denied },
    sessionStorage: { getItem: denied, setItem: denied, removeItem: denied },
  };
}

function uninstallWindow() {
  delete (globalThis as Record<string, unknown>).window;
}
