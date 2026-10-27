import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collisionSource } from "../src/lib/map-collisions";
import { cycleSource } from "../src/lib/map-cycle-lanes";
import { placeSource } from "../src/lib/map-place-layers";
import { propertySource } from "../src/lib/map-property-layers";
import { saleSource } from "../src/lib/map-sale-layers";
import { canopySource, greenStreetSource, treeSource } from "../src/lib/map-street-trees";
import { mapRelease, schoolPointsPath, setMapRelease, withRelease } from "../src/lib/release-url";

// GET /api/v1/schools/points answers "Cache-Control: public, max-age=3600" (area boxes a day, overlay
// tiles an hour or a day). Without the release in the URL, browsers kept the old release's points for an
// hour after a deploy (no Ofsted badges or ribbons). The release id is the cache key.

test("a release-scoped URL carries the release, so a new release is a new URL", () => {
  assert.equal(schoolPointsPath("official-2026-06"), "/api/v1/schools/points?release=official-2026-06");
  assert.notEqual(schoolPointsPath("official-2026-06"), schoolPointsPath("official-2026-07"));
  // The same release keeps the same URL: its long cache still holds.
  assert.equal(schoolPointsPath("official-2026-06"), schoolPointsPath("official-2026-06"));
  assert.equal(withRelease("/x?a=1", "r 1"), "/x?a=1&release=r%201");
  // No release known (a bare test render): the URL is left as it was.
  assert.equal(withRelease("/api/v1/schools/points", null), "/api/v1/schools/points");
  assert.equal(withRelease("/api/v1/schools/points", ""), "/api/v1/schools/points");
});

test("every overlay tile template carries the release and keeps its {z}/{x}/{y}", () => {
  const release = "official-2026-06";
  const origin = "https://example.test";
  const sources = { collisionSource, cycleSource, placeSource, propertySource, saleSource, treeSource, greenStreetSource, canopySource };
  for (const [name, source] of Object.entries(sources)) {
    const [tiles] = source(origin, release).tiles!;
    assert.match(tiles, /^https:\/\/example\.test\/api\/v1\/tiles\/[a-z-]+\/\{z\}\/\{x\}\/\{y\}\.(pbf|png)\?release=official-2026-06$/, name);
  }
});

test("the map's helpers read the release the map shows", () => {
  const map = {};
  assert.equal(mapRelease(map), null);
  setMapRelease(map, "official-2026-06");
  assert.equal(mapRelease(map), "official-2026-06");
  setMapRelease(map, "official-2026-07");
  assert.equal(mapRelease(map), "official-2026-07");
});

/** Every .ts/.tsx file under a folder. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("no client code fetches the long-cached map JSON or tiles without the release", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const client = [...sources(join(root, "components")), ...sources(join(root, "lib"))];
  for (const path of client) {
    const text = readFileSync(path, "utf8");
    // A bare literal path (the API route handlers under src/app proxy it and are not scanned).
    assert.doesNotMatch(text, /fetch\(\s*["'`]\/api\/v1\/(schools\/points|areas\/boxes)/i, path);
    assert.doesNotMatch(text, /tiles: \[`\$\{origin\}\/api\/v1\/tiles\//, path);
  }
});
