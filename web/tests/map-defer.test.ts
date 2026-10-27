import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { INTRO_BOOT_ATTRIBUTE, INTRO_BOOT_SCRIPT, INTRO_DISMISSED_KEY, isDeepLink } from "../src/lib/intro-boot";
import { compactDataStatus, describePublicDataStatus } from "../src/lib/map-state";
import { PROFILE_STORAGE_KEY } from "../src/lib/profile-state";
import { SAVED_SHORTLISTS_KEY } from "../src/lib/saved-shortlists";

// Proposal #28: MapLibre and its sheets load with the map, not with every page.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("only the map modules import MapLibre itself, and the explorer loads them on demand", () => {
  const importers = sources(SRC)
    .filter((path) => /^import (?!type)[^;]*from "maplibre-gl"/m.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(SRC.length + 1))
    .sort();
  // street-trees-map.ts is area-map's own (Street trees, Green streets): it loads with the map and uses only the type.
  assert.deepEqual(importers, ["components/area-map.tsx", "components/home-mini-map-canvas.tsx", "components/match/match-overlays.tsx", "components/my-places-overlay.tsx", "components/ranking-top.tsx", "components/saved-overlay.tsx"]);
  // The home page's mini map: its canvas loads after the page, never on the server.
  assert.match(read("components/home-mini-map.tsx"), /dynamic\(\(\) => import\("\.\/home-mini-map-canvas"\)[^\n]*\{ ssr: false \}/);
  assert.doesNotMatch(read("components/home-page.tsx"), /home-mini-map-canvas/);
  assert.doesNotMatch(read("components/close-knit.tsx"), /street-trees-map/);
  const explorer = read("components/close-knit.tsx");
  for (const module of ["area-map", "match/match-overlays", "match/zone-draw", "my-places-overlay", "ranking-top", "saved-overlay"]) {
    assert.doesNotMatch(explorer, new RegExp(`^import [^;]* from "\\./${module}";`, "m"), `${module} is imported statically`);
    assert.match(explorer, new RegExp(`dynamic\\(\\(\\) => import\\("\\./${module}"\\)[^\\n]*\\{ ssr: false[ ,]`));
  }
});

test("the map's sheets come with the map; the guide's and the tools' with their routes", () => {
  const root = read("app/layout.tsx");
  for (const sheet of ["maplibre-gl.css", "map-knit.css", "guide.css", "tools.css"]) assert.ok(!root.includes(sheet), `${sheet} is still global`);
  const map = read("components/area-map.tsx");
  // MapLibre's own sheet first, so the knitted markers and attribution override it.
  assert.ok(map.indexOf('import "maplibre-gl/dist/maplibre-gl.css";') < map.indexOf('import "../styles/map-knit.css";'));
  assert.match(read("app/tools/layout.tsx"), /import "\.\.\/\.\.\/styles\/tools\.css";/);
  assert.match(read("app/about/layout.tsx"), /import "\.\.\/\.\.\/styles\/tools\.css";/);
  assert.match(read("app/guide/layout.tsx"), /import "\.\.\/\.\.\/styles\/guide\.css";/);
});

test("the footer shows 'Demo data' and keeps the rest of the warning for screen readers", () => {
  const demo = describePublicDataStatus({ mode: "demo", connection: "online" })!;
  assert.deepEqual(compactDataStatus(demo), { shown: "Demo data", hidden: " · not for decisions" });
  const offline = describePublicDataStatus({ mode: "demo", connection: "offline" })!;
  assert.deepEqual(compactDataStatus(offline), { shown: "Offline · Demo data", hidden: " · not for decisions" });
  assert.deepEqual(compactDataStatus("Offline"), { shown: "Offline", hidden: "" });
  for (const status of [demo, offline]) {
    const { shown, hidden } = compactDataStatus(status);
    assert.equal(shown + hidden, status);
  }
});

/** Runs the inline intro script against a fake page; true when it hides the server-rendered card. */
function bootHides(search: string, hash: string, stored: Record<string, string> = {}, storageThrows = false): boolean {
  const attributes = new Map<string, string>();
  const storage = { getItem: (key: string) => { if (storageThrows) throw new Error("denied"); return stored[key] ?? null; } };
  const document = { documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) } };
  new Function("location", "localStorage", "document", "URLSearchParams", INTRO_BOOT_SCRIPT)(
    { search, hash }, storage, document, URLSearchParams,
  );
  return attributes.get(INTRO_BOOT_ATTRIBUTE) === "hide";
}

test("the intro boot script hides the card wherever the intro would not show", () => {
  const links: [string, string][] = [
    ["", ""], ["?layer=price-per-square-metre", ""], ["?layer=crime", ""], ["?selected=uk:lsoa:E01000001", ""],
    ["?places=1", ""], ["?find=like&area=x", ""], ["?find=budget&price=1", ""], ["?layer=price-per-square-metre&rank=most-expensive", ""], ["?find=other", ""], ["?zoom=12.9", ""], ["?zoom=13", ""],
    ["?zoom=abc", ""], ["", "#profile=v2.abc"], ["", "#shortlist=abc"],
  ];
  for (const [search, hash] of links) assert.equal(bootHides(search, hash), isDeepLink(search, hash), `${search}${hash}`);
  assert.equal(bootHides("", "", { [INTRO_DISMISSED_KEY]: "1" }), true);
  assert.equal(bootHides("", "", { [SAVED_SHORTLISTS_KEY]: "[]" }), true);
  assert.equal(bootHides("", "", { [PROFILE_STORAGE_KEY]: "{}" }), true);
  // Blocked storage: the card shows, as useIntroCard decides then.
  assert.equal(bootHides("", "", {}, true), false);
});
