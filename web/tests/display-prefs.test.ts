import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DISPLAY_PREFS,
  DISPLAY_PREFS_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  loadDisplayPrefs,
  saveDisplayPrefs,
} from "../src/lib/profile-state";

test("display preferences round-trip through their own storage key", () => {
  const store = installMemoryStorage();
  try {
    assert.deepEqual(loadDisplayPrefs(), DEFAULT_DISPLAY_PREFS);
    saveDisplayPrefs({ areaUnit: "sqft" });
    assert.deepEqual(loadDisplayPrefs(), { areaUnit: "sqft" });
    assert.ok(store.has(DISPLAY_PREFS_STORAGE_KEY));
    assert.equal(store.has(PROFILE_STORAGE_KEY), false);
  } finally {
    uninstallWindow();
  }
});

test("unknown or corrupt display preferences fall back to square metres", () => {
  installMemoryStorage({ [DISPLAY_PREFS_STORAGE_KEY]: "{\"areaUnit\":\"acres\"}" });
  try {
    assert.deepEqual(loadDisplayPrefs(), { areaUnit: "sqm" });
  } finally {
    uninstallWindow();
  }
  installMemoryStorage({ [DISPLAY_PREFS_STORAGE_KEY]: "not json" });
  try {
    assert.deepEqual(loadDisplayPrefs(), DEFAULT_DISPLAY_PREFS);
  } finally {
    uninstallWindow();
  }
});

test("blocked storage keeps the default and never throws", () => {
  const denied = () => { throw new DOMException("denied", "SecurityError"); };
  (globalThis as Record<string, unknown>).window = {
    localStorage: { getItem: denied, setItem: denied, removeItem: denied },
  };
  try {
    assert.doesNotThrow(() => saveDisplayPrefs({ areaUnit: "sqft" }));
    assert.deepEqual(loadDisplayPrefs(), DEFAULT_DISPLAY_PREFS);
  } finally {
    uninstallWindow();
  }
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
  return store;
}

function uninstallWindow() {
  delete (globalThis as Record<string, unknown>).window;
}
