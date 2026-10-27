import assert from "node:assert/strict";
import test from "node:test";

import { loadWizardStage, saveWizardStage, WIZARD_STAGE_STORAGE_KEY } from "../src/lib/profile-state";

test("wizard stage persists, rejects garbage, and survives denied storage", () => {
  installMemoryStorage();
  try {
    assert.equal(loadWizardStage(1), 1);
    saveWizardStage(3);
    assert.equal(loadWizardStage(1), 3);

    const store = (globalThis as Record<string, unknown>).window as {
      sessionStorage: { setItem: (key: string, value: string) => void };
    };
    store.sessionStorage.setItem(WIZARD_STAGE_STORAGE_KEY, "needs");
    assert.equal(loadWizardStage(1), 1);
    store.sessionStorage.setItem(WIZARD_STAGE_STORAGE_KEY, "0");
    assert.equal(loadWizardStage(2), 2);
  } finally {
    uninstallWindow();
  }

  installThrowingStorage();
  try {
    assert.equal(loadWizardStage(1), 1);
    saveWizardStage(3);
  } finally {
    uninstallWindow();
  }
});

function installMemoryStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

function installThrowingStorage() {
  const denied = () => { throw new DOMException("denied", "SecurityError"); };
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: { getItem: denied, setItem: denied, removeItem: denied },
  };
}

function uninstallWindow() {
  delete (globalThis as Record<string, unknown>).window;
}

void WIZARD_STAGE_STORAGE_KEY;
