import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// MapLibre's worker goes to public/maplibre/<version>/ (lib/map-core.ts MAPLIBRE_WORKER_URL): a path per version is
// served immutable (next.config.ts), so a returning visitor's map starts without revalidating it (perf/layer-load).
const require = createRequire(import.meta.url);
const packageJson = require.resolve("maplibre-gl/package.json");
const { version } = JSON.parse(readFileSync(packageJson, "utf8"));
const distribution = join(dirname(packageJson), "dist");
const root = join(process.cwd(), "public", "maplibre");
const destination = join(root, version);

rmSync(root, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(distribution, filename), join(destination, filename));
}

// The pmtiles protocol inside MapLibre's workers (lib/map-core.ts AREA_TILES_WORKER_URL): the library's browser bundle
// and its registration as one module, so a worker reads an area tile archive's ranges itself, off the main thread.
// Named by the library's version: the folder is MapLibre's.
const pmtilesPackage = require.resolve("pmtiles/package.json");
const pmtiles = JSON.parse(readFileSync(pmtilesPackage, "utf8")).version;
writeFileSync(join(destination, `area-tiles-${pmtiles}.mjs`),
  `${readFileSync(join(dirname(pmtilesPackage), "dist", "pmtiles.js"), "utf8").replace(/\/\/# sourceMappingURL=.*\s*$/, "")}\n`
  + "self.addProtocol(\"pmtiles\", new pmtiles.Protocol({ metadata: false }).tile);\n");
