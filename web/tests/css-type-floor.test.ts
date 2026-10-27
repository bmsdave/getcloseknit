import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// #15: a 12px type floor (DESIGN.md › Type). Every font size in every
// stylesheet under src/ resolves to at least 12px (.75rem). Chart SVG text is
// drawn in its viewBox's units and may sit at 11px; nothing goes lower.

const src = new URL("../src/", import.meta.url).pathname;
const sheets = (readdirSync(src, { recursive: true }) as string[])
  .filter((file) => file.endsWith(".css"))
  .map((file) => ({ file, css: readFileSync(join(src, file), "utf8") }));
const globals = sheets.find((sheet) => sheet.file === join("app", "globals.css"))?.css ?? "";
const root = globals.match(/:root\s*{([^}]*)}/)?.[1] ?? "";
const tokens = new Map([...root.matchAll(/(--fs-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const FLOOR = 12;
const SVG_FLOOR = 11;
// Selectors that style SVG <text>/<tspan> (charts, guide diagrams).
const SVG_TEXT = /(^|[\s,>+~(])(text|tspan)\b|chart-ring__(value|max)|chart-rings__(ring-label|north|number)|\.gd-|market-axis|market-row-label/;
const SIZE = /var\(--fs-[\w-]+(?:,\s*[^)]+)?\)|clamp\([^)]*\)|-?\d*\.?\d+(?:px|rem|em|%)/;

// The smallest size a value can render at, in px (relative em/% as a ratio).
function smallest(value: string): { px?: number; ratio?: number; error?: string } | null {
  const size = value.match(SIZE)?.[0];
  if (!size) return null; // inherit, smaller, a bare var(--x) …
  const fs = size.match(/^var\((--fs-[\w-]+)(?:,\s*([^)]+))?\)$/);
  if (fs) {
    const token = tokens.get(fs[1]);
    if (!token) return { error: `unknown type token ${fs[1]}` };
    return smallest(token);
  }
  if (size.startsWith("clamp(")) return smallest(size.slice(6));
  const n = Number.parseFloat(size);
  if (size.endsWith("rem")) return { px: n * 16 };
  if (size.endsWith("px")) return { px: n };
  return { ratio: size.endsWith("%") ? n / 100 : n };
}

function violations(file: string, css: string): string[] {
  const bad: string[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of clean.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().replace(/\s+/g, " ");
    const floor = SVG_TEXT.test(selector) ? SVG_FLOOR : FLOOR;
    for (const decl of rule[2].matchAll(/(?:^|;)\s*(font-size|font)\s*:\s*([^;]+)/g)) {
      const size = smallest(decl[2]);
      if (!size) continue;
      const where = `${file}: ${selector.slice(0, 60)} { ${decl[1]}: ${decl[2].trim()} }`;
      if (size.error) bad.push(`${where} — ${size.error}`);
      else if (size.px !== undefined && size.px < floor) bad.push(`${where} — ${size.px}px < ${floor}px`);
      else if (size.ratio !== undefined && size.ratio < 0.75) bad.push(`${where} — relative size under .75em`);
    }
  }
  return bad;
}

test("the contract type tokens are defined in rem on :root", () => {
  assert.deepEqual(Object.fromEntries(tokens), {
    "--fs-2xs": ".75rem", "--fs-xs": ".8125rem", "--fs-sm": ".875rem", "--fs-md": "1rem",
    "--fs-lg": "1.125rem", "--fs-xl": "1.375rem", "--fs-2xl": "1.75rem", "--fs-3xl": "2.25rem",
  });
});

test("radius and spacing tokens are defined on :root", () => {
  for (const name of ["--radius-sm", "--radius-md", "--radius-lg", "--radius-pill"]) assert.match(root, new RegExp(`${name}:`));
  for (let step = 1; step <= 8; step++) assert.match(root, new RegExp(`--space-${step}: ${step * 4}px;`));
});

test("no stylesheet sets text below 12px (chart SVG text below 11px)", () => {
  assert.ok(sheets.length > 20, "expected to scan every stylesheet under src/");
  assert.deepEqual(sheets.flatMap(({ file, css }) => violations(file, css)), []);
});

test("the floor check catches small px, rem, clamp, shorthand and unknown tokens", () => {
  const sample = `.a { font-size: 11px; } .b { font: 800 10px/1 var(--font-sans); } .c { font-size: .6rem; }
    .d { font-size: clamp(10px, 2vw, 20px); } .e { font-size: var(--fs-tiny); } .f { font-size: .7em; }
    .ok { font-size: var(--fs-2xs); font: inherit; } .chart text { font-size: 11px; } .chart tspan { font-size: 10px; }`;
  assert.equal(violations("sample.css", sample).length, 7);
});
