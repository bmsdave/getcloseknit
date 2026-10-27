import assert from "node:assert/strict";
import test from "node:test";

import { configLoader, FALLBACK_CONFIG, parseConfig, resolveMode } from "../src/mode";
import {
  DEFAULT_SETTINGS, firstRunDue, loadSettings, normalise, saveSettings, SETTINGS_KEY, settingsArea, type Area,
} from "../src/settings";

function memoryArea(fail = false): Area & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key) => {
      if (fail) throw new Error("sync off");
      return key in data ? { [key]: data[key] } : {};
    },
    set: async (items) => {
      if (fail) throw new Error("sync off");
      Object.assign(data, items);
    },
  };
}

test("defaults: on the page everywhere but SpareRoom; sending on, demand off, analytics on", async () => {
  const settings = await loadSettings(memoryArea());
  assert.deepEqual(settings.portals, {
    rightmove: "inline", zoopla: "inline", onthemarket: "inline", spareroom: "side-panel", openrent: "inline",
  });
  assert.equal(settings.sendListing, true);
  assert.equal(settings.demandStats, false);
  assert.equal(settings.analytics, true);
  assert.deepEqual(settings.buyer, { depositPct: 10, ratePct: 4.5, years: 30, firstTime: false, additionalHome: false });
});

test("stored choices win; malformed values keep their default", () => {
  const settings = normalise({ portals: { zoopla: "side-panel", rightmove: "sideways" }, sendListing: false, analytics: "no",
    buyer: { depositPct: 25, ratePct: 99, years: 25, firstTime: true } });
  assert.equal(settings.portals.zoopla, "side-panel");
  assert.equal(settings.portals.rightmove, "inline");
  assert.equal(settings.sendListing, false);
  assert.equal(settings.analytics, true);
  assert.deepEqual(settings.buyer, { depositPct: 25, ratePct: 4.5, years: 25, firstTime: true, additionalHome: false });
});

test("settings go to sync, and to local when sync refuses", async () => {
  const sync = memoryArea();
  const local = memoryArea();
  await saveSettings(settingsArea({ sync, local }), { ...DEFAULT_SETTINGS, demandStats: true });
  assert.equal((sync.data[SETTINGS_KEY] as { demandStats: boolean }).demandStats, true);
  assert.equal(local.data[SETTINGS_KEY], undefined);

  const broken = memoryArea(true);
  const area = settingsArea({ sync: broken, local });
  await saveSettings(area, { ...DEFAULT_SETTINGS, analytics: false });
  assert.equal((local.data[SETTINGS_KEY] as unknown as { analytics: boolean }).analytics, false);
  assert.equal((await loadSettings(area)).analytics, false);
  // No sync at all (older Safari): local.
  assert.equal(settingsArea({ local }), local);
});

test("the first-run screen opens on install and on updates from before 0.4.0 only", () => {
  assert.equal(firstRunDue("install"), true);
  assert.equal(firstRunDue("update", "0.3.1"), true);
  assert.equal(firstRunDue("update", "0.4.0"), false);
  assert.equal(firstRunDue("update", "0.4.1"), false);
  assert.equal(firstRunDue("update", "1.0"), false);
  assert.equal(firstRunDue("chrome_update", "0.3.1"), false);
});

test("mode: server off wins, server side-panel overrides the page, server inline follows the user", () => {
  assert.equal(resolveMode("off", "inline", true), "off");
  assert.equal(resolveMode("off", "side-panel", true), "off");
  assert.equal(resolveMode("side-panel", "inline", true), "side-panel");
  assert.equal(resolveMode("side-panel", "side-panel", true), "side-panel");
  assert.equal(resolveMode("inline", "inline", true), "inline");
  assert.equal(resolveMode("inline", "side-panel", true), "side-panel");
  // Safari: no side panel, so the floating side card instead.
  assert.equal(resolveMode("side-panel", "inline", false), "side-card");
  assert.equal(resolveMode("inline", "side-panel", false), "side-card");
  assert.equal(resolveMode("inline", "inline", false), "inline");
});

test("config: unknown or missing portals keep the fallback (inline, SpareRoom in the side panel)", () => {
  const config = parseConfig({ v: 1, portals: { rightmove: { mode: "off" }, zoopla: { mode: "banana" } }, notice: "Paused" });
  assert.equal(config.portals.rightmove.mode, "off");
  assert.equal(config.portals.zoopla.mode, "inline");
  assert.equal(config.portals.spareroom.mode, "side-panel");
  assert.equal(config.notice, "Paused");
  assert.deepEqual(parseConfig(null), FALLBACK_CONFIG);
});

test("config is fetched once per 5 minutes; an unreachable server gives the fallback", async () => {
  let now = 0;
  let calls = 0;
  const ok = async () => {
    calls += 1;
    return new Response(JSON.stringify({ v: 1, portals: { zoopla: { mode: "off" } }, notice: "" }));
  };
  const load = configLoader("https://example.test", ok, () => now);
  assert.equal((await load()).portals.zoopla.mode, "off");
  now = 4 * 60 * 1000;
  await load();
  assert.equal(calls, 1);
  now = 6 * 60 * 1000;
  await load();
  assert.equal(calls, 2);

  const down = configLoader("https://example.test", async () => { throw new Error("offline"); });
  assert.deepEqual(await down(), FALLBACK_CONFIG);
  const failing = configLoader("https://example.test", async () => new Response("no", { status: 503 }));
  assert.deepEqual(await failing(), FALLBACK_CONFIG);
});
