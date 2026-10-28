import assert from "node:assert/strict";
import test from "node:test";

import {
  activeViewPackPaths, chunkRegion, coverageCamera, DEMO_COVERAGE, ENGLAND_MIN_ZOOM, fetchMapCoverage, loadedMapCoverage, LONDON_COVERAGE,
  LONDON_REGION, setViewScope, viewScopeName, viewScopeWords,
  londonPiece, NEIGHBOURHOOD_ZOOM, pieceBoxesPath, piecePackPath, piecesKey, resetMapCoverage, setActiveView, shapePieces,
  viewPackPaths, viewPieces, viewScopeFromAreas, viewScopeIsEngland, LAD_ZOOM, WIDE_ZOOM, type Bbox, type MapCoverage,
} from "../src/lib/map-coverage";
import { LONDON_BOUNDS, MIN_MAP_ZOOM } from "../src/lib/map-state";
import { METRIC_IDS, type MetricCoverage, type MetricId } from "../src/lib/contracts";
import { londonOnlyLayers, MAP_OVERLAYS, metricRegions, piecesWithValues } from "../src/lib/map-topics";
import { DETAIL_LAYER_IDS } from "../src/lib/nature-layers";
import { createSplitPackCache, isPiecePackPath } from "../src/lib/timeline-playback";

const ENGLAND: MapCoverage = {
  coverage: "england",
  productReleaseId: "rel-1",
  bounds: [[-6.45, 49.86], [1.77, 55.82]],
  regions: [
    { id: "E12000002", name: "North West", bbox: [-3.64, 52.94, -1.9, 55.19] },
    { id: LONDON_REGION, name: "London", bbox: [-0.52, 51.28, 0.34, 51.7] },
    { id: "E12000008", name: "South East", bbox: [-1.96, 50.57, 1.45, 52.2] },
  ],
  chunks: [
    { id: LONDON_REGION, region: LONDON_REGION, bbox: [-0.52, 51.28, 0.34, 51.7], areas: 4994 },
    { id: "E07000207", region: "E12000008", bbox: [-0.48, 51.3, -0.25, 51.42], areas: 80 }, // Elmbridge, next to London
    { id: "E08000003", region: "E12000002", bbox: [-2.32, 53.34, -2.15, 53.55], areas: 295 }, // Manchester
  ],
};
const LONDON_VIEW: Bbox = [-0.62, 51.32, 0.37, 51.7];
const MANCHESTER_VIEW: Bbox = [-2.3, 53.4, -2.2, 53.5];

test("the London map (flag off, or before the coverage answers) is one piece: London whole, its own areas", () => {
  for (const zoom of [9, 11, 15]) {
    assert.deepEqual(viewPieces(LONDON_COVERAGE, "real", "lsoa", LONDON_VIEW, zoom), [londonPiece("lsoa")]);
  }
  assert.deepEqual(viewPieces(ENGLAND, "demo", "lsoa", LONDON_VIEW, 11), [{ chunk: null, carrier: "lsoa", rolledUp: false }]);
  assert.deepEqual(coverageCamera(LONDON_COVERAGE), { bounds: LONDON_BOUNDS, minZoom: MIN_MAP_ZOOM });
});

test("England zoomed out is its LADs, then every region as MSOAs (medians of their LSOAs), then LSOAs", () => {
  const england: Bbox = [-6, 49.9, 1.7, 55.8];
  assert.deepEqual(viewPieces(ENGLAND, "real", "lsoa", england, LAD_ZOOM - 0.1), [{ chunk: null, carrier: "lad", rolledUp: true }]);
  assert.deepEqual(viewPieces(ENGLAND, "real", "msoa", england, LAD_ZOOM - 0.1), [{ chunk: null, carrier: "lad", rolledUp: true }]);
  const pieces = viewPieces(ENGLAND, "real", "lsoa", england, WIDE_ZOOM - 1);
  assert.deepEqual(pieces, ENGLAND.regions.map((region) => ({ chunk: region.id, carrier: "msoa", rolledUp: true })));
  assert.ok(viewPieces(ENGLAND, "real", "lsoa", england, WIDE_ZOOM).every((entry) => entry.carrier === "lsoa"));
  assert.equal(piecePackPath("/api/v1/value-packs/crime/2026-06", { chunk: null, carrier: "lad", rolledUp: true }, "r1"),
    "/api/v1/value-packs/crime/2026-06?level=lad&format=compact&v=r1");
  assert.equal(coverageCamera(ENGLAND).minZoom, ENGLAND_MIN_ZOOM);
});

test("the England map's pan bounds leave room for all of England at its widest zoom, on a laptop and a phone", () => {
  // MapLibre never shows past maxBounds: bounds the size of England's box held 1440x900 near zoom 7.
  const [[west, south], [east, north]] = coverageCamera(ENGLAND).bounds;
  const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  for (const [width, height] of [[1440, 900], [375, 812]]) {
    const world = 512 * 2 ** ENGLAND_MIN_ZOOM;
    assert.ok((east - west) / 360 * world >= width, `${width} px wide fits at zoom ${ENGLAND_MIN_ZOOM}`);
    assert.ok((mercatorY(north) - mercatorY(south)) / (2 * Math.PI) * world >= height, `${height} px high fits`);
  }
  assert.ok(west < -6.45 && east > 1.77 && south < 49.86 && north > 55.82, "England's box stays inside");
});

test("a view's ranks are in London, its one region, or England across regions", () => {
  assert.equal(viewScopeName(LONDON_COVERAGE, MANCHESTER_VIEW), "London");
  assert.equal(viewScopeName(ENGLAND, MANCHESTER_VIEW), "North West");
  assert.equal(viewScopeName(ENGLAND, [-0.2, 51.45, -0.05, 51.55]), "London");
  assert.equal(viewScopeName(ENGLAND, LONDON_VIEW), null, "London and Elmbridge: two regions");
  assert.equal(viewScopeName(ENGLAND, [-5, 50, -4.9, 50.1]), "London", "the sea keeps London's words");
  // An older API without each chunk's region: never a wrong name.
  const unnamed = { ...ENGLAND, chunks: ENGLAND.chunks.map(({ region: _region, ...chunk }) => chunk) };
  assert.equal(viewScopeName(unnamed, MANCHESTER_VIEW), null);
  setViewScope(null);
  assert.equal(viewScopeWords(), "England");
  assert.equal(viewScopeIsEngland(), true, "a view across regions is coloured by rank in England");
  setViewScope("North West");
  assert.equal(viewScopeWords(), "North West");
  assert.equal(viewScopeIsEngland(), false);
  resetMapCoverage();
  assert.equal(viewScopeWords(), "London");
});

test("a view the LAD boxes put across regions is one region's when every area it shows is", () => {
  // Elmbridge's box reaches into this London view, but none of its areas does.
  const view: Bbox = [-0.45, 51.42, -0.3, 51.5];
  assert.equal(viewScopeName(ENGLAND, view), null);
  const london = { region: LONDON_REGION, bbox: [-0.44, 51.43, -0.4, 51.47] as Bbox };
  const elmbridge = { region: "E12000008", bbox: [-0.4, 51.35, -0.3, 51.41] as Bbox };
  assert.equal(viewScopeFromAreas(ENGLAND, view, [london, elmbridge]), "London");
  assert.equal(viewScopeFromAreas(ENGLAND, view, [london, { ...elmbridge, bbox: [-0.4, 51.4, -0.3, 51.45] }]), null);
  // A sliver of Surrey in a corner (under a tenth of the view) keeps London's scale.
  assert.equal(viewScopeFromAreas(ENGLAND, view, [{ region: LONDON_REGION, bbox: [-0.45, 51.42, -0.3, 51.5] },
    { ...elmbridge, bbox: [-0.45, 51.4, -0.44, 51.43] }]), "London");
  assert.equal(viewScopeFromAreas(ENGLAND, view, []), null, "nothing painted yet: England's scale, as the boxes say");
  assert.equal(viewScopeFromAreas(ENGLAND, MANCHESTER_VIEW, []), "North West");
  assert.equal(chunkRegion(ENGLAND, "E07000207"), "E12000008");
  assert.equal(chunkRegion(ENGLAND, LONDON_REGION), LONDON_REGION);
  assert.equal(chunkRegion(ENGLAND, null), null);
});

test("from zoom 6.5 each region in view is MSOAs, from 9 the layer's own areas, London like any other region", () => {
  const view: Bbox = [-1, 51, 0.5, 52];
  assert.deepEqual(viewPieces(ENGLAND, "real", "lsoa", view, 6.5).map((entry) => [entry.chunk, entry.carrier, entry.rolledUp]),
    [[LONDON_REGION, "msoa", true], ["E12000008", "msoa", true]]);
  assert.deepEqual(viewPieces(ENGLAND, "real", "lsoa", view, 9.2).map((entry) => [entry.chunk, entry.carrier, entry.rolledUp]),
    [[LONDON_REGION, "lsoa", false], ["E12000008", "lsoa", false]]);
  // An MSOA layer is not rolled up to itself.
  assert.deepEqual(viewPieces(ENGLAND, "real", "msoa", view, 6.5)[1], { chunk: "E12000008", carrier: "msoa", rolledUp: false });
});

test("one map: at every zoom London and its neighbours load the same level", () => {
  // All of England's LADs below 6.5: London's with every other's, one piece.
  for (const zoom of [5.5, 6]) assert.deepEqual(viewPieces(ENGLAND, "real", "lsoa", LONDON_VIEW, zoom), [{ chunk: null, carrier: "lad", rolledUp: true }]);
  for (const zoom of [6.5, 6.9, 7, 8, 8.5, 9, 9.4, 9.5, 10, 11, 13]) {
    const pieces = viewPieces(ENGLAND, "real", "lsoa", LONDON_VIEW, zoom);
    assert.ok(pieces.some((entry) => entry.chunk === LONDON_REGION), `London in view at ${zoom}`);
    assert.ok(pieces.length > 1, `its neighbours too at ${zoom}`);
    assert.equal(new Set(pieces.map((entry) => `${entry.carrier}|${entry.rolledUp}`)).size, 1, `one level at ${zoom}`);
  }
});

test("zoomed in, London is still its one piece and elsewhere one piece per LAD in view", () => {
  const london = viewPieces(ENGLAND, "real", "lsoa", LONDON_VIEW, 11);
  assert.deepEqual(london.map((entry) => entry.chunk), [LONDON_REGION, "E07000207"]);
  assert.ok(london.every((entry) => entry.carrier === "lsoa" && !entry.rolledUp));
  assert.deepEqual(viewPieces(ENGLAND, "real", "lsoa", MANCHESTER_VIEW, NEIGHBOURHOOD_ZOOM).map((entry) => entry.chunk), ["E08000003"]);
  assert.equal(piecesKey(viewPieces(ENGLAND, "real", "lsoa", [-5, 50, -4.9, 50.1], 12)), "none", "the sea: nothing to load");
});

test("a borough layer is one piece at every zoom, the same piece: a zoom never repaints it", () => {
  const keys = [6, 9, 12].map((zoom) => piecesKey(viewPieces(ENGLAND, "real", "lad", LONDON_VIEW, zoom)));
  assert.deepEqual(keys, ["*:lad:", "*:lad:", "*:lad:"]);
});

test("piece URLs: the London map keeps its URL, every chunk names its release (London's too)", () => {
  const base = "/api/v1/value-packs/crime/2026-06?mode=real&release=live";
  assert.equal(piecePackPath(base, { chunk: null, carrier: "lsoa", rolledUp: false }, "rel-1"), base);
  assert.equal(piecePackPath(base, londonPiece("lsoa"), "rel-1"), `${base}&chunk=${LONDON_REGION}&format=compact&v=rel-1`);
  assert.equal(piecePackPath(base, { chunk: null, carrier: "lad", rolledUp: true }, "rel-1"), `${base}&level=lad&format=compact&v=rel-1`);
  assert.equal(piecePackPath(base, { chunk: "E08000003", carrier: "lsoa", rolledUp: false }, "rel-1"), `${base}&chunk=E08000003&format=compact&v=rel-1`);
  // The shapes are area tiles: a piece's own request is its box index.
  assert.equal(pieceBoxesPath(londonPiece("lsoa"), "live", null), `/api/v1/areas/boxes?carrier=lsoa&chunk=${LONDON_REGION}&release=live`);
  assert.equal(pieceBoxesPath({ chunk: "E12000008", carrier: "msoa", rolledUp: true }, "live", "rel-1"),
    "/api/v1/areas/boxes?carrier=msoa&chunk=E12000008&v=rel-1&release=live");
});

test("packs: London whole on its own, the other pieces of a level in one request (sorted, 64 at most)", () => {
  const base = "/api/v1/value-packs/crime/2026-06?mode=real";
  const lad = (chunk: string) => ({ chunk, carrier: "lsoa" as const, rolledUp: false });
  assert.deepEqual(viewPackPaths(base, [londonPiece("lsoa"), lad("E08000003"), lad("E07000207")], "rel-1"),
    [`${base}&chunk=${LONDON_REGION}&format=compact&v=rel-1`, `${base}&chunk=E07000207%2CE08000003&format=compact&v=rel-1`]);
  const many = Array.from({ length: 70 }, (_, index) => lad(`E0700${String(index).padStart(4, "0")}`));
  assert.equal(viewPackPaths(base, many, "rel-1").length, 2);
  const regions = viewPieces(ENGLAND, "real", "lsoa", [-1, 51, 0.5, 52], 6.5);
  assert.deepEqual(viewPackPaths(base, regions, "rel-1"),
    [`${base}&chunk=${LONDON_REGION}&level=msoa&format=compact&v=rel-1`, `${base}&chunk=E12000008&level=msoa&format=compact&v=rel-1`]);
  assert.deepEqual(viewPackPaths(base, [], "rel-1"), []);
});

test("a selected wider area's box: the LAD itself, or the pieces in view holding its kind", () => {
  assert.deepEqual(shapePieces(ENGLAND, "real", "uk:lad:E08000003", MANCHESTER_VIEW), [{ chunk: "E08000003", carrier: "lad", rolledUp: false }]);
  assert.deepEqual(shapePieces(ENGLAND, "real", "uk:msoa:E02000001", LONDON_VIEW)?.map((entry) => entry.chunk), [LONDON_REGION, "E12000008"]);
  assert.deepEqual(shapePieces(LONDON_COVERAGE, "real", "uk:msoa:E02000001", LONDON_VIEW), [londonPiece("msoa")]);
  assert.equal(shapePieces(ENGLAND, "demo", "uk:msoa:E02000001", LONDON_VIEW), undefined);
});

test("a failed coverage rejects, is never London's, and is asked again; an answer is fetched once per release", async () => {
  resetMapCoverage();
  let calls = 0;
  const broken = (async () => { calls++; return new Response("nope", { status: 500 }); }) as typeof fetch;
  await assert.rejects(fetchMapCoverage("real", "live", broken), /map coverage unavailable \(HTTP 500\)/);
  const garbage = (async () => { calls++; return Response.json({ coverage: "mars" }); }) as typeof fetch;
  await assert.rejects(fetchMapCoverage("real", "live", garbage), /map coverage unavailable/);
  assert.equal(calls, 2, "a failure is not kept for the release");
  assert.equal(loadedMapCoverage(), LONDON_COVERAGE, "nothing is published on a failure");
  const england = (async () => { calls++; return Response.json({ schemaVersion: "map-coverage.v1", ...ENGLAND }); }) as typeof fetch;
  assert.equal((await fetchMapCoverage("real", "live", england)).coverage, "england", "the retry reaches England");
  assert.equal((await fetchMapCoverage("real", "live", broken)).coverage, "england", "an answer is kept for the release");
  assert.equal(calls, 3);
  assert.equal(loadedMapCoverage().coverage, "england");
  // Demo data: London's map, its fixture areas drawn from tiles of their own.
  assert.equal(await fetchMapCoverage("demo", "next", england), DEMO_COVERAGE);
  assert.equal(DEMO_COVERAGE.coverage, "london");
  assert.match(DEMO_COVERAGE.areaTiles?.url ?? "", /^\/api\/v1\/tiles\/areas\/a0-0{12}\/\{kind\}/);
  resetMapCoverage();
});

test("the timeline prefetches the map's pieces, London's one piece before the map has a view", () => {
  resetMapCoverage();
  const base = "/api/v1/value-packs/price-per-square-metre/2026-05?mode=real&release=live";
  assert.deepEqual(activeViewPackPaths(base), [`${base}&chunk=${LONDON_REGION}&format=compact`]);
  setActiveView([londonPiece("lsoa"), { chunk: "E07000207", carrier: "lsoa", rolledUp: false }], "rel-1");
  assert.deepEqual(activeViewPackPaths(base), [`${base}&chunk=${LONDON_REGION}&format=compact&v=rel-1`, `${base}&chunk=E07000207&format=compact&v=rel-1`]);
  resetMapCoverage();
});

test("England's small pieces have their own pack cache: twenty LADs never push out the timeline's months", async () => {
  assert.equal(isPiecePackPath("/api/v1/value-packs/crime/2026-06?mode=real&release=live"), false);
  assert.equal(isPiecePackPath(`/api/v1/value-packs/crime/2026-06?mode=real&chunk=${LONDON_REGION}`), false);
  assert.equal(isPiecePackPath("/api/v1/value-packs/crime/2026-06?mode=real&chunk=E08000003&v=rel-1"), true);
  assert.equal(isPiecePackPath("/api/v1/value-packs/crime/2026-06?mode=real&level=lad&v=rel-1"), true);
  const loads: string[] = [];
  const cache = createSplitPackCache(async (path) => { loads.push(path); return path; });
  const london = `/p?chunk=${LONDON_REGION}`;
  await cache.get(london);
  for (let lad = 0; lad < 40; lad++) await cache.get(`/p?chunk=E0800${String(lad).padStart(4, "0")}`);
  await cache.get(london);
  assert.equal(loads.filter((path) => path === london).length, 1, "London whole is still held");
});

const LONDON_SCOPE = "uk:region:E12000007";
const englandWide: MetricCoverage[] = [
  { scopeId: "uk:country:GB", share: 0.99 }, { scopeId: "uk:nation:E92000001", share: 0.99 },
  { scopeId: "uk:region:E12000002", share: 1 }, { scopeId: LONDON_SCOPE, share: 0.98 },
];
const londonAlone: MetricCoverage[] = [
  { scopeId: "uk:country:GB", share: 0.15 }, { scopeId: "uk:nation:E92000001", share: 0.15 }, { scopeId: LONDON_SCOPE, share: 0.97 },
];

test("London only comes from the release's coverage: a metric whose one region with values is London", () => {
  const only = londonOnlyLayers([
    { id: "air-no2", coverage: englandWide }, // the hand-written list said London; England is loaded
    { id: "short-lets-per-1000", coverage: londonAlone },
    { id: "nature-score", coverage: londonAlone },
    { id: "student-share", coverage: [{ scopeId: "uk:region:E12000002", share: 1 }] },
    { id: "crime" }, // an older API: no coverage, no claim
  ]);
  // Green streets and Green cover are drawn over Green & trees' areas, from the same trees and canopy.
  assert.deepEqual([...only].sort(), ["canopy", "green-streets", "nature-score", "short-lets-per-1000"]);
  assert.deepEqual([...londonOnlyLayers([{ id: "nature-score", coverage: englandWide }])], []);
});

test("no hand-written coverage: with no catalog, or every metric across England, nothing is London only", () => {
  assert.equal(londonOnlyLayers(null).size, 0);
  const everyMetric = METRIC_IDS.map((id: MetricId) => ({ id, coverage: englandWide }));
  assert.equal(londonOnlyLayers(everyMetric).size, 0, "a list of layers marked London whatever the data says");
  // Only Show's overlays, which are no metrics (the catalog has no coverage for them), say it on their own.
  const layers = new Set<string>([...METRIC_IDS, ...DETAIL_LAYER_IDS]);
  for (const overlay of MAP_OVERLAYS) {
    if ("londonOnly" in overlay) assert.ok(!layers.has(overlay.id), `${overlay.id} is a layer: its coverage comes from the catalog`);
  }
  assert.deepEqual(MAP_OVERLAYS.filter((overlay) => "londonOnly" in overlay).map((overlay) => overlay.id), ["stations", "cycle-lanes", "trees"]);
});

test("a metric's regions decide which pieces are asked for: London's HMOs send nothing over Manchester", () => {
  assert.deepEqual([...metricRegions({ coverage: londonAlone }) ?? []], ["E12000007"]);
  assert.deepEqual([...metricRegions({ coverage: englandWide }) ?? []].sort(), ["E12000002", "E12000007"]);
  // No region rows (demo, an older API): every piece is asked for.
  assert.equal(metricRegions({}), null);
  assert.equal(metricRegions({ coverage: [{ scopeId: "uk:country:GB", share: 1 }] }), null);
});

test("pieces outside a metric's regions are never asked for: a London start, or Manchester, on London's HMOs", () => {
  const pieces = [{ chunk: LONDON_REGION }, { chunk: "E07000207" }, { chunk: "E08000003" }, { chunk: "E99999999" }, { chunk: null }];
  assert.deepEqual(piecesWithValues(pieces, { coverage: londonAlone }, ENGLAND).map((piece) => piece.chunk),
    [LONDON_REGION, "E99999999", null], "unknown regions are kept");
  assert.equal(piecesWithValues(pieces, { coverage: englandWide }, ENGLAND).length, 4, "North West and London: Elmbridge (South East) left out");
  // No catalog coverage or no map coverage yet: every piece.
  assert.equal(piecesWithValues(pieces, {}, ENGLAND).length, 5);
  assert.equal(piecesWithValues(pieces, { coverage: londonAlone }, null).length, 5);
});
