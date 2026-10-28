import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomesHere } from "../src/components/homes-here";
import type { GeographyId } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { analyticsMode, automatedBrowser, coarseView, deviceClass, isEuTimeZone, pagePath, sharedKind, TEAM_STORAGE_KEY, teamBrowser, trafficSource } from "../src/lib/usage";
import { layerUsage, zoneUsage } from "../src/lib/usage-layers";
import { CUSTOM_PRESETS } from "../src/lib/custom-presets";

const ORIGIN = "https://getcloseknit.com";

test("analytics are off by choice or browser signal, without an id in EU time zones, else counted", () => {
  const base = { stored: null, gpc: false, dnt: false, timeZone: "Europe/London" };
  assert.equal(analyticsMode(base), "counted");
  assert.equal(analyticsMode({ ...base, stored: "off" }), "off");
  assert.equal(analyticsMode({ ...base, gpc: true }), "off");
  assert.equal(analyticsMode({ ...base, dnt: true }), "off");
  assert.equal(analyticsMode({ ...base, timeZone: "Europe/Paris" }), "anonymous");
  assert.equal(analyticsMode({ ...base, timeZone: undefined }), "counted");
});

test("the UK and Crown dependencies are not EU time zones; Dublin, Madeira and Oslo are", () => {
  for (const zone of ["Europe/London", "Europe/Jersey", "Europe/Guernsey", "Europe/Isle_of_Man", "America/New_York"]) {
    assert.equal(isEuTimeZone(zone), false, zone);
  }
  for (const zone of ["Europe/Dublin", "Atlantic/Madeira", "Europe/Oslo", "Europe/Berlin"]) {
    assert.equal(isEuTimeZone(zone), true, zone);
  }
});

test("page paths never point at a home or a full postcode", () => {
  assert.equal(pagePath("/property/100023336956"), "/property/:id");
  assert.equal(pagePath("/postcode/E8%203AA"), "/postcode/:code");
  assert.equal(pagePath("/postcode/E8%203AA/homes"), "/postcode/:code/homes");
  assert.equal(pagePath("/area/lsoa/E01000001?x=1#profile=v1.abc"), "/area/lsoa/E01000001");
  assert.equal(pagePath(""), "/");
});

test("a visit's source is an invite, a utm_source or the referring site, never a full URL", () => {
  assert.equal(trafficSource("", "?invite=abc123", ORIGIN), "invite");
  assert.equal(trafficSource("https://claude.ai/chat/123", "", ORIGIN), "claude");
  assert.equal(trafficSource("https://www.google.co.uk/search?q=hackney", "", ORIGIN), "google");
  assert.equal(trafficSource("https://news.example.org/story/1", "", ORIGIN), "news.example.org");
  assert.equal(trafficSource("", "?utm_source=Newsletter<script>", ORIGIN), "newsletterscript");
  assert.equal(trafficSource(`${ORIGIN}/area/lsoa/E01000001`, "", ORIGIN), null);
  assert.equal(trafficSource(`${ORIGIN}/?invite=abc123`, "", ORIGIN), "invite");
  assert.equal(trafficSource("not a url", "", ORIGIN), null);
});

test("device class is by width only", () => {
  assert.deepEqual([375, 800, 1440].map(deviceClass), ["mobile", "tablet", "desktop"]);
});

const AREA = "uk:lsoa:E01001234" as GeographyId;

test("homes here filters the portals by the search and offers the other districts", () => {
  const html = renderToStaticMarkup(createElement(HomesHere,
    { geographyId: AREA, from: "shortlist", outcodes: ["E8", "E5"], profile: DEFAULT_PROFILE }));
  assert.match(html, /Homes for sale here/);
  assert.match(html, /Up to £650k · 2\+ beds/);
  assert.match(html, /property-for-sale\/E8\.html\?maxPrice=650000&amp;minBedrooms=2/);
  assert.match(html, /aria-label="Postcode district"/);
  assert.match(html, /house-prices\/e8\.html/);
});

test("homes here without a search leaves the portals open and offers buy or rent", () => {
  const html = renderToStaticMarkup(createElement(HomesHere,
    { geographyId: AREA, from: "area_page", outcodes: ["N16"], profile: null }));
  assert.match(html, /Any price · any size/);
  assert.match(html, /aria-label="Buy or rent"/);
  assert.match(html, /property-for-sale\/N16\.html"/);
  assert.doesNotMatch(html, /Postcode district/);
});

test("homes here renders nothing without a postcode district", () => {
  assert.equal(renderToStaticMarkup(createElement(HomesHere, { geographyId: AREA, from: "area_page", outcodes: [], profile: null })), "");
});

test("a shared link is known by its kind, never its contents", () => {
  assert.equal(sharedKind("#profile=v1.abc"), "search");
  assert.equal(sharedKind("#shortlist=v1.abc"), "shortlist");
  assert.equal(sharedKind("#brief=xyz"), "brief");
  assert.equal(sharedKind("#area-card-price"), null);
  assert.equal(sharedKind(""), null);
});

test("map views are coarse: zoom to a half step, the centre to two decimals", () => {
  assert.deepEqual(coarseView(13.37, 51.54321, -0.05678), { zoom: 13.5, lat: 51.54, lng: -0.06 });
});

test("a layer is named as a metric, My match, a preset by its slug, or the reader's own criterion", () => {
  assert.deepEqual(layerUsage("crime", null), { name: "crime", props: { layer: "crime" } });
  const preset = CUSTOM_PRESETS[0];
  const fromPreset = layerUsage(`custom:${preset.criterion.id}`, preset.criterion);
  assert.equal(fromPreset.name, `custom:${preset.slug}`);
  assert.equal(fromPreset.props.custom, "preset");
  const own = { ...preset.criterion, sets: { a: preset.criterion.sets.b ?? preset.criterion.sets.a } };
  assert.equal(layerUsage(`custom:${own.id}`, own).name, "custom:own");
});

test("a drawn zone is kept as its corner count and coarse centre, a station zone by its name", () => {
  const drawn = zoneUsage("add", { kind: "polygon", points: [[51.50, -0.10], [51.52, -0.10], [51.52, -0.08]] }, 1);
  assert.deepEqual(drawn, { action: "add", kind: "polygon", zones: 1, corners: 3, lat: 51.51, lng: -0.09 });
  assert.equal(zoneUsage("remove", { kind: "station", stationId: "940GZZLUHAI", maxWalkMinutes: 10, label: "Highbury & Islington" }, 0).place,
    "Highbury & Islington");
});

test("?team=1 marks this browser as the team's until ?team=0", () => {
  const store = new Map<string, string>();
  const localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key) };
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage };
  try {
    assert.equal(teamBrowser(""), false);
    assert.equal(teamBrowser("?team=1&layer=crime"), true);
    assert.equal(store.get(TEAM_STORAGE_KEY), "1");
    assert.equal(teamBrowser("?layer=crime"), true, "remembered on later pages");
    assert.equal(teamBrowser("?team=0"), false);
    assert.equal(teamBrowser(""), false);
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
});

test("a browser driven by automation (navigator.webdriver) is told apart", () => {
  assert.equal(automatedBrowser(), false);
  Object.defineProperty(globalThis.navigator, "webdriver", { value: true, configurable: true });
  try {
    assert.equal(automatedBrowser(), true);
  } finally {
    delete (globalThis.navigator as { webdriver?: boolean }).webdriver;
  }
});
