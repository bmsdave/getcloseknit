import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CollisionPanel } from "../src/components/collision-panel";
import {
  COLLISION_LIST_ZOOM, COLLISION_YEARS, DEFAULT_COLLISION_VIEW, ROAD_USERS, SEVERITIES, STATS19_URL, collisionFilter, collisionGlyph,
  collisionHeatFilter, collisionHeatIntensity, collisionHeatWeight, collisionIconId, collisionIconMarkup, collisionLayers,
  collisionPointFilter, collisionPopup, collisionSelectionShare, streetOnlyFilters, toggleIn, withCollisionsOn,
} from "../src/lib/map-collisions";
import { collisionsFromQuery } from "../src/lib/map-setup";
import { MAP_OVERLAYS } from "../src/lib/map-topics";

test("everyone, every severity and year by default; children narrow every zoom", () => {
  assert.deepEqual(collisionFilter(DEFAULT_COLLISION_VIEW), ["all",
    ["in", ["get", "road_user"], ["literal", ROAD_USERS.map((user) => user.id)]],
    ["in", ["get", "severity"], ["literal", [1, 2, 3]]]]);
  const kids = collisionFilter({ ...DEFAULT_COLLISION_VIEW, children: true, users: ["pedestrian"], severities: [1, 2] });
  assert.deepEqual(kids, ["all", ["==", ["get", "child"], true],
    ["in", ["get", "road_user"], ["literal", ["pedestrian"]]], ["in", ["get", "severity"], ["literal", [1, 2]]]]);
});

test("year and light filter the street dots only", () => {
  const view = { ...DEFAULT_COLLISION_VIEW, years: [2025], light: "dark" as const };
  const point = collisionPointFilter(view) as unknown[];
  assert.deepEqual(point.slice(2), [["in", ["get", "year"], ["literal", [2025]]], ["==", ["get", "dark"], true]]);
  const [heat, hits, bursts] = collisionLayers(view);
  assert.equal(heat.type, "heatmap");
  // No year or light at heat zoom, and no severity: the grid cells count each severity (n1 / n2 / n3).
  assert.deepEqual((heat as { filter: unknown }).filter, collisionHeatFilter(view));
  assert.deepEqual(collisionHeatFilter(DEFAULT_COLLISION_VIEW), ["all", ["in", ["get", "road_user"], ["literal", ROAD_USERS.map((user) => user.id)]]]);
  assert.equal(hits.type, "circle");
  assert.equal(bursts.type, "symbol");
  assert.deepEqual((bursts as { filter: unknown }).filter, collisionPointFilter(view));
  assert.equal(streetOnlyFilters(view), true);
  assert.equal(streetOnlyFilters(DEFAULT_COLLISION_VIEW), false);
});

test("a narrower selection gets a stronger heatmap so it never fades to nothing", () => {
  assert.ok(Math.abs(collisionSelectionShare(DEFAULT_COLLISION_VIEW) - 1) < 0.01);
  const kids = { ...DEFAULT_COLLISION_VIEW, children: true };
  assert.ok(Math.abs(collisionSelectionShare(kids) - 0.059) < 0.002);
  const atZoom14 = (view: typeof DEFAULT_COLLISION_VIEW) => (collisionHeatIntensity(view) as unknown[])[6] as number;
  assert.ok(atZoom14(kids) > 3 * atZoom14(DEFAULT_COLLISION_VIEW));
  const killed = { ...DEFAULT_COLLISION_VIEW, severities: [1], users: ["pedestrian" as const] };  // the floor keeps a tiny share from exploding
  assert.equal(atZoom14(killed), atZoom14({ ...killed, children: true }));
});

test("Task 5: one continuous heat, weighted by severity, normalised by zoom, gone by 14.5", () => {
  assert.deepEqual(SEVERITIES.map((severity) => severity.weight), [10, 3, 1]);
  // n1 / n2 / n3 on grid cells, or one casualty's severity at street zoom.
  const weight = collisionHeatWeight(DEFAULT_COLLISION_VIEW) as unknown[];
  assert.equal(weight[0], "+");
  assert.deepEqual(weight[1], ["*", 10, ["coalesce", ["get", "n1"], ["case", ["==", ["get", "severity"], 1], ["coalesce", ["get", "n"], 1], 0]]]);
  // The severity filter keeps working on the heat: an unpicked severity weighs nothing.
  assert.deepEqual(collisionHeatWeight({ ...DEFAULT_COLLISION_VIEW, severities: [1] }), (weight as unknown[])[1]);
  assert.equal(collisionHeatWeight({ ...DEFAULT_COLLISION_VIEW, severities: [] }), 0);
  // Four times per zoom level: a casualty's share of the screen shrinks four times per level.
  const intensity = collisionHeatIntensity(DEFAULT_COLLISION_VIEW) as unknown[];
  assert.deepEqual(intensity[1], ["exponential", 4]);
  assert.ok(Math.abs((intensity[6] as number) / (intensity[4] as number) - 4 ** 4) < 1e-9);
  const [heat] = collisionLayers(DEFAULT_COLLISION_VIEW);
  const paint = (heat as unknown as { paint: Record<string, unknown[]> }).paint;
  // Radius ≥ 1.6 × the grid's 4 px spacing at every zoom; max opacity 0.75, 0 at 14.5.
  assert.deepEqual(paint["heatmap-radius"].slice(3), [10, 12, 12, 14, 13, 16, 14, 18]);
  assert.deepEqual(paint["heatmap-opacity"].slice(3), [14, 0.75, 14.5, 0]);
});

test("Task 4: bursts (variant C) filled in the severity colour with the road user in white, no white core", () => {
  assert.deepEqual(["pedestrian", "cyclist", "escooter", "motorcycle", "car", "bus", "goods", "other"].map(collisionGlyph),
    ["walk", "bike", "bike", "moto", "car", "car", "car", "car"]);
  assert.equal(collisionIconId(1, "walk"), "collision-1-walk");
  const fatal = collisionIconMarkup(1, "walk");
  assert.match(fatal, /fill="#e2453c" stroke="#22252c" stroke-width="1\.6"/);  // fatal: a dark outline
  assert.match(collisionIconMarkup(3, "car"), /fill="#f6c445" stroke="#ffffff"/);
  assert.doesNotMatch(collisionIconMarkup(3, "car"), /<circle cx="12" cy="12" r="7\.2" fill="#ffffff"/);
  assert.deepEqual(SEVERITIES.map((severity) => severity.px), [24, 20, 16]);  // severity is size too, never colour alone
  const [, hits, bursts] = collisionLayers(DEFAULT_COLLISION_VIEW);
  assert.equal((hits as { paint: Record<string, unknown> }).paint["circle-radius"], 16);  // a 32 px tap target
  const layout = (bursts as { layout: Record<string, unknown> }).layout;
  // Bursts give way to caps and stations placed before them; they never hide labels or each other.
  assert.equal(layout["icon-allow-overlap"], false);
  assert.equal(layout["icon-ignore-placement"], true);
});

test("toggling adds and removes one value", () => {
  assert.deepEqual(toggleIn([2021, 2022], 2022), [2021]);
  assert.deepEqual(toggleIn([2021], 2025), [2021, 2025]);
  assert.equal(COLLISION_YEARS.length, 5);
});

test("the overlay is listed and its panel keys severity and says when year applies", () => {
  assert.ok(MAP_OVERLAYS.some((overlay) => overlay.id === "collisions" && overlay.label === "Road collisions"));
  const render = (zoom: number, view = DEFAULT_COLLISION_VIEW) =>
    renderToStaticMarkup(createElement(CollisionPanel, { view, zoom, onChange: () => undefined }));
  const html = render(11);
  assert.match(html, /Children only \(0–15\)/);
  assert.match(html, /E-scooter/);
  assert.match(html, /Fatal/);
  assert.doesNotMatch(html, /Killed/);
  assert.match(html, /never the date, time or sex/);
  assert.doesNotMatch(html, /Year and light apply/);
  assert.match(render(11, { ...DEFAULT_COLLISION_VIEW, light: "dark" }), /Year and light apply when you zoom in to streets/);
  assert.doesNotMatch(render(14, { ...DEFAULT_COLLISION_VIEW, light: "dark" }), /Year and light apply/);
});

test("each filter list has All · None; an empty one is marked (the map toast asks for at least one)", () => {
  const render = (view: typeof DEFAULT_COLLISION_VIEW) =>
    renderToStaticMarkup(createElement(CollisionPanel, { view, zoom: 14, onChange: () => undefined }));
  const all = render(DEFAULT_COLLISION_VIEW);
  for (const group of ["users", "severity", "year"]) {
    assert.match(all, new RegExp(`data-testid="collision-${group}-all"[^>]*disabled`));
    assert.doesNotMatch(all, new RegExp(`data-testid="collision-${group}-none"[^>]*disabled`));
  }
  assert.doesNotMatch(all, /Pick at least one/);
  const none = render({ ...DEFAULT_COLLISION_VIEW, users: [] });
  assert.match(none, /aria-label="Who was hurt" data-empty="true"/);
  assert.equal((none.match(/data-empty/g) ?? []).length, 1);
  // Nothing picked draws nothing: the filter matches no casualty.
  assert.deepEqual((collisionFilter({ ...DEFAULT_COLLISION_VIEW, users: [] }) as unknown[])[1], ["in", ["get", "road_user"], ["literal", []]]);
});

test("the popup reads one casualty, or a stack with Zoom in until street level", () => {
  const one = collisionPopup([{ severity: 2, year: 2023, road_user: "pedestrian", child: true, dark: true }], 15);
  assert.deepEqual(one, { kind: "one", record: { severity: 2, label: "Serious", year: 2023, who: "Pedestrian · child 0–15", dark: true } });
  const car = collisionPopup([{ severity: 3, year: 2024, road_user: "car", child: false, dark: false }], 15);
  assert.equal(car?.kind === "one" && car.record.who, "In a car");
  const stack = [{ severity: 3, year: 2022, road_user: "cyclist" }, { severity: 1, year: 2021, road_user: "pedestrian" }];
  assert.deepEqual(collisionPopup(stack, 14), { kind: "many", count: 2, zoomIn: true, records: [] });
  const close = collisionPopup(stack, COLLISION_LIST_ZOOM);
  assert.equal(close?.kind, "many");
  // Worst first; the words are STATS19's own (Fatal, not Killed).
  assert.deepEqual(close?.kind === "many" && close.records.map((record) => record.label), ["Fatal", "Slight"]);
  assert.equal(collisionPopup([{ severity: 9 }], 15), null);
  assert.equal(collisionPopup([], 15), null);
  assert.match(STATS19_URL, /^https:\/\/www\.gov\.uk\/.*road-safety-open-data$/);
});

test("a link turns the overlay on with ?collisions=on, and nothing else does", () => {
  assert.deepEqual(collisionsFromQuery("?collisions=on"), DEFAULT_COLLISION_VIEW);
  assert.equal(collisionsFromQuery("?selected=uk%3Alsoa%3AE01000001"), null);
  assert.equal(collisionsFromQuery("?collisions=off"), null);
  assert.deepEqual(collisionsFromQuery(withCollisionsOn("/?layer=crime").split("?")[1]), DEFAULT_COLLISION_VIEW);
  assert.equal(withCollisionsOn("/?selected=uk%3Alsoa%3AE01000001&layer=crime"), "/?selected=uk%3Alsoa%3AE01000001&layer=crime&collisions=on");
});
