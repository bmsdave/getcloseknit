import assert from "node:assert/strict";
import test from "node:test";

import { mobileRow } from "../src/lib/area-mobile";
import { offenceLabel } from "../src/lib/area-safety";
import { isDeepLink } from "../src/lib/intro-boot";
import { schoolFeatures, schoolPointFromProperties, schoolPopupView } from "../src/lib/map-school-layer";
import { preserveDiagnosticsQuery } from "../src/lib/map-state";
import { ratingModel } from "../src/lib/rating";
import {
  clampPanelWidth, PANEL_DEFAULT, PANEL_MAP_ROOM, PANEL_MAX, PANEL_MIN, PANEL_WIDTH_BOOT, PANEL_WIDTH_KEY, readPanelWidth, writePanelWidth,
} from "../src/lib/panel-width";
import { schoolParam, schoolUrnFromHref } from "../src/lib/school-card";

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

const throwing = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
};

test("the panel is wider than the old 380px by default and kept within its limits", () => {
  assert.ok(PANEL_DEFAULT > 380);
  assert.equal(clampPanelWidth(100), PANEL_MIN);
  assert.equal(clampPanelWidth(5000), PANEL_MAX);
  assert.equal(clampPanelWidth(512.6), 513);
  assert.equal(clampPanelWidth(Number.NaN), PANEL_DEFAULT);
});

test("a narrow window leaves the map its room, but never squeezes the panel under the minimum", () => {
  assert.equal(clampPanelWidth(PANEL_MAX, 1100), 1100 - PANEL_MAP_ROOM);
  assert.equal(clampPanelWidth(PANEL_MAX, 1920), PANEL_MAX);
  assert.equal(clampPanelWidth(PANEL_MAX, 700), PANEL_MIN);
  assert.equal(clampPanelWidth(Number.NaN, 760), PANEL_MIN);
});

test("the width is remembered per browser, clamped on read, and the default clears it", () => {
  const store = memoryStore();
  assert.equal(readPanelWidth(store), null);
  writePanelWidth(600, store);
  assert.equal(store.data.get(PANEL_WIDTH_KEY), "600");
  assert.equal(readPanelWidth(store), 600);
  writePanelWidth(9999, store);
  assert.equal(readPanelWidth(store), PANEL_MAX);
  assert.equal(readPanelWidth(memoryStore({ [PANEL_WIDTH_KEY]: "12" })), PANEL_MIN);
  assert.equal(readPanelWidth(memoryStore({ [PANEL_WIDTH_KEY]: "wide" })), null);
  writePanelWidth(null, store);
  assert.equal(store.data.has(PANEL_WIDTH_KEY), false);
  writePanelWidth(PANEL_DEFAULT, store);
  assert.equal(store.data.has(PANEL_WIDTH_KEY), false);
});

test("blocked storage never throws: the panel falls back to its default", () => {
  assert.equal(readPanelWidth(throwing), null);
  assert.doesNotThrow(() => writePanelWidth(600, throwing));
  assert.equal(readPanelWidth(null), null);
});

test("the boot script applies the stored width, clamped, before first paint", () => {
  const run = (stored: string | null, throws = false) => {
    const set: Record<string, string> = {};
    const localStorage = { getItem: () => { if (throws) throw new Error("blocked"); return stored; } };
    const document = { documentElement: { style: { setProperty: (name: string, value: string) => { set[name] = value; } } } };
    new Function("localStorage", "document", PANEL_WIDTH_BOOT)(localStorage, document);
    return set["--dock-w"] ?? null;
  };
  assert.equal(run("600"), "600px");
  assert.equal(run("9999"), `${PANEL_MAX}px`);
  assert.equal(run("10"), `${PANEL_MIN}px`);
  assert.equal(run(null), null);
  assert.equal(run("nope"), null);
  assert.equal(run("600", true), null);
});

test("?school=<urn> opens a school in the panel: read, kept by the map's rewrites, and a deep link", () => {
  assert.equal(schoolParam("?selected=uk%3Alsoa%3AE01005090&school=105448"), "105448");
  assert.equal(schoolParam("?school=../x"), null);
  assert.equal(new URLSearchParams(preserveDiagnosticsQuery("layer=crime", "?layer=price&school=105448")).get("school"), "105448");
  assert.equal(preserveDiagnosticsQuery("layer=crime", "?school=bad"), "layer=crime");
  assert.equal(isDeepLink("?school=105448", ""), true);
});

test("a school link inside the panel names its URN; other links do not", () => {
  const origin = "https://getcloseknit.com";
  assert.equal(schoolUrnFromHref("/school/105448?from=uk%3Alsoa%3AE01005090", origin), "105448");
  assert.equal(schoolUrnFromHref("https://getcloseknit.com/school/105448/", origin), "105448");
  assert.equal(schoolUrnFromHref("https://example.com/school/105448", origin), null);
  assert.equal(schoolUrnFromHref("/school/105448/homes", origin), null);
  assert.equal(schoolUrnFromHref("/area/lsoa/E01005090", origin), null);
});

test("a tapped school cap keeps its region: its card says “in North West”, never London", () => {
  const point = {
    urn: "105448", name: "Northern Primary", phase: "primary", latitude: 53.4, longitude: -2.27, kind: "state" as const,
    regionRank: 3, regionPool: 1689, rankScope: { code: "E12000002", name: "North West" },
  };
  const tapped = schoolPointFromProperties(schoolFeatures([point]).features[0].properties as Record<string, unknown>, [point.longitude, point.latitude]);
  assert.deepEqual(tapped?.rankScope, point.rankScope);
  assert.equal(schoolPopupView(tapped!).position, "#3 of 1,689 in North West");
  const london = { ...point, rankScope: undefined };
  const inLondon = schoolPointFromProperties(schoolFeatures([london]).features[0].properties as Record<string, unknown>, [0, 51.5]);
  assert.equal(schoolPopupView(inLondon!).position, "#3 of 1,689 in London");
});

test("a school's lowest band names its region, not London", () => {
  assert.equal(ratingModel(5, true, undefined, "North West").band, "Well below North West");
  assert.equal(ratingModel(5, true).band, "Well below London");
  assert.equal(ratingModel(95, true, undefined, "North West").band, "Top 10%");
});

test("an offence type from the police API reads as words", () => {
  assert.equal(offenceLabel("anti-social-behaviour"), "Anti-social behaviour");
  assert.equal(offenceLabel("other-theft"), "Other theft");
  assert.equal(offenceLabel("Violence and sexual offences"), "Violence and sexual offences");
});

test("outside London the mobile row compares with the region's local authorities", () => {
  const mobile = { available: true, value: { borough: { name: "Manchester" }, indoor4gAll: { share: 0.999, regionPercentile: 99 }, outdoor5gAny: { share: 1 } } };
  assert.match(mobileRow(mobile as never, "North West")!.value, /above 99% of local authorities in North West/);
  assert.match(mobileRow(mobile as never)!.value, /above 99% of boroughs/);
});
