import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The browser only reaches the API through Next.js routes (Caddy sends /api/v1/* to the web), so every
// area section the site fetches needs its own proxy route. Health shipped without one on 2026-10-16.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const ROUTES = join(SRC, "app", "api", "v1", "areas", "[id]");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("every area section the site fetches has a Next.js proxy route", () => {
  const sections = new Set<string>();
  for (const file of [...files(join(SRC, "lib")), ...files(join(SRC, "components"))]) {
    const code = readFileSync(file, "utf8");
    if (/\bfetchApi\b/.test(code)) continue;  // server-side modules call the API directly, not through the web
    for (const match of code.matchAll(/`\/api\/v1\/areas\/\$\{[^}]+\}\/([a-z-]+)/g)) sections.add(match[1]);
  }
  assert.ok(sections.has("health") && sections.has("nature"), `found ${[...sections].join(", ")}`);
  const missing = [...sections].filter((section) => !existsSync(join(ROUTES, section, "route.ts")));
  assert.deepEqual(missing, []);
});
