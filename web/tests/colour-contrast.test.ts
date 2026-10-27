import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// UX-64: documented contrast ratios for every audited state. Colours come
// from the real globals.css tokens — the default :root and every
// html[data-ui-theme] block layered over it, composited where translucent —
// so the test fails if any interface theme drifts below a threshold.

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const root = css.match(/:root\s*{([^}]*)}/)?.[1] ?? "";
assert.ok(root.length > 0, ":root block must exist");

type Rgb = [number, number, number];
type Tokens = Map<string, string>;

function declarations(block: string): Tokens {
  const tokens: Tokens = new Map();
  for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens.set(match[1], match[2].trim());
  return tokens;
}

const BASE = declarations(root);
const THEMES: Array<[string, Tokens]> = [
  ["day", BASE],
  ...[...css.matchAll(/:root\[data-ui-theme="([\w-]+)"\]\s*{([^}]*)}/g)].map(
    ([, name, block]): [string, Tokens] => [name, new Map([...BASE, ...declarations(block)])],
  ),
];

function parseColor(value: string, tokens: Tokens): Rgb {
  const hex = value.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  const paper = parseColor(tokens.get("--paper") ?? "#f4f7fa", tokens);
  const over = (rgb: Rgb, alpha: number): Rgb =>
    rgb.map((channel, i) => Math.round(channel * alpha + paper[i] * (1 - alpha))) as Rgb;
  const rgba = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (rgba) return over([Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], Number(rgba[4]));
  const viaToken = value.match(/^rgb\(var\((--[\w-]+)\)\s*\/\s*([\d.]+)\)$/);
  assert.ok(viaToken, `unsupported colour: ${value}`);
  const triple = tokens.get(viaToken[1])?.split(/\s+/).map(Number);
  assert.ok(triple?.length === 3, `${viaToken[1]} must be an "r g b" triple`);
  return over(triple as Rgb, Number(viaToken[2]));
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(foreground: Rgb, background: Rgb): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

// Mirrors the map label halo (map-area-labels.ts); map labels sit on the
// basemap, not on the interface theme.
const HALO: Rgb = [245, 241, 232];
const MAP_LABEL: Rgb = [20, 45, 39];

for (const [theme, tokens] of THEMES) {
  const token = (name: string): Rgb => {
    const value = tokens.get(name);
    assert.ok(value, `${name} must exist (${theme})`);
    return parseColor(value, tokens);
  };

  test(`${theme}: normal and muted text meet AA on paper and panel`, () => {
    for (const [surface, background] of [["paper", token("--paper")], ["panel", token("--panel")], ["surface", token("--surface")]] as const) {
      for (const [text, colour] of [["ink", token("--ink")], ["muted", token("--muted")]] as const) {
        const measured = ratio(colour, background);
        assert.ok(measured >= 4.5, `${text}/${surface} measures ${measured.toFixed(2)}, needs 4.5`);
      }
    }
  });

  test(`${theme}: selected controls keep AA for text`, () => {
    assert.ok(ratio(token("--on-ink"), token("--ink")) >= 4.5, "on-ink text on ink");
    assert.ok(ratio(token("--ink"), token("--chip")) >= 4.5, "ink on chip buttons");
    // Segmented pills (≡ menu): the chosen thumb in ink, the others muted on the chip track.
    assert.ok(ratio(token("--ink"), token("--seg-on")) >= 4.5, "ink on the chosen segment");
    assert.ok(ratio(token("--muted"), token("--chip")) >= 4.5, "muted segments on the chip track");
  });

  test(`${theme}: warnings and focus ring meet their thresholds`, () => {
    assert.ok(ratio(token("--danger"), token("--panel")) >= 4.5, "error text on panel");
    assert.ok(ratio(token("--focus"), token("--paper")) >= 3, "focus ring on paper");
    assert.ok(ratio(token("--muted"), token("--note")) >= 4.5, "muted text on notes");
  });

  // WCAG 1.4.11 / 2.4.13: chips, layer options, search results and the
  // search field draw their ring in --focus over these fills.
  test(`${theme}: the focus ring reads at 3:1 on chips, panels and surfaces`, () => {
    for (const surface of ["--chip", "--panel", "--panel-solid", "--surface", "--paper"]) {
      const measured = ratio(token("--focus"), token(surface));
      assert.ok(measured >= 3, `--focus on ${surface} measures ${measured.toFixed(2)}, needs 3`);
    }
  });

  test(`${theme}: chart colours read at 3:1 on panel and surface`, () => {
    const marks = [...tokens.keys()].filter((name) => name.startsWith("--chart-") && name !== "--chart-track");
    assert.equal(marks.length, 9, "--chart-1..6, --chart-bad, --chart-good, --chart-neutral");
    for (const name of marks) {
      for (const surface of ["--panel", "--surface"]) {
        const measured = ratio(token(name), token(surface));
        assert.ok(measured >= 3, `${name} on ${surface} measures ${measured.toFixed(2)}, needs 3`);
      }
    }
    // The track is decorative (the filled part carries the value), but it
    // must still show against the panel.
    assert.ok(ratio(token("--chart-track"), token("--panel")) >= 1.15, "track visible on panel");
  });

  test(`${theme}: area tag and tile marks (pro, con) read at 3:1, and their tags keep ink text at 4.5:1`, () => {
    for (const name of ["--pro", "--con"]) {
      for (const surface of ["--panel", "--surface"]) {
        const measured = ratio(token(name), token(surface));
        assert.ok(measured >= 3, `${name} on ${surface} measures ${measured.toFixed(2)}, needs 3`);
      }
      // The tag's fill is the mark at 16-18% over the surface; its text is --ink.
      const [mark, surface] = [token(name), token("--surface")];
      const tint = mark.map((channel, i) => Math.round(channel * 0.18 + surface[i] * 0.82)) as [number, number, number];
      assert.ok(ratio(token("--ink"), tint) >= 4.5, `--ink on the ${name} tag`);
    }
  });

  test(`${theme}: the primary action and its running stitch read`, () => {
    assert.ok(ratio(token("--on-primary"), token("--primary")) >= 4.5, "primary button label");
    assert.ok(ratio(token("--stitch"), token("--primary")) >= 3, "stitch on the primary button");
    assert.ok(ratio(token("--stitch-quiet"), token("--surface")) >= 3, "stitch on a quiet button");
  });

  test(`${theme}: field boundaries identify inputs at 3:1`, () => {
    const measured = ratio(token("--field-line"), token("--surface"));
    assert.ok(measured >= 3, `field line on surface measures ${measured.toFixed(2)}, needs 3`);
  });
}

test("map labels meet AA on their halo", () => {
  assert.ok(ratio(MAP_LABEL, HALO) >= 4.5, "map label on halo");
});

test("every interface theme is covered", () => {
  assert.deepEqual(THEMES.map(([name]) => name), ["day", "night"]);
});

test("Auto is the default: no data-ui-theme, Night follows prefers-color-scheme", async () => {
  const { DEFAULT_UI_THEME, UI_THEMES } = await import("../src/lib/ui-themes");
  assert.equal(DEFAULT_UI_THEME, "auto");
  assert.deepEqual(UI_THEMES.map((theme) => theme.id), ["auto", "day", "night"]);
  // The auto-dark block must carry exactly the Night tokens.
  const night = css.match(/:root\[data-ui-theme="night"\]\s*{([^}]*)}/)?.[1] ?? "";
  const auto = css.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root:not\(\[data-ui-theme\]\)\s*{([^}]*)}/)?.[1] ?? "";
  assert.ok(night.length > 0 && auto.length > 0, "both Night blocks exist");
  assert.deepEqual([...declarations(auto)], [...declarations(night)]);
});

test("no low-contrast one-off text colours survive", () => {
  for (const stale of ["#8c9692", "#b7bdb9", "#56635f", "#55615d"]) {
    assert.ok(!css.toLowerCase().includes(stale), `${stale} must use var(--muted)`);
  }
});

test("focus rings use the --focus token, never the translucent accent", () => {
  const layout = readFileSync(new URL("../src/styles/layout.css", import.meta.url), "utf8");
  for (const rule of layout.match(/[^{}]*:focus(?:-visible)?[^{}]*\{[^}]*outline:[^}]*\}/g) ?? []) {
    assert.ok(!/outline:\s*\d+px solid rgb\(var\(--accent-rgb\)/.test(rule), `translucent accent ring: ${rule.trim()}`);
  }
  assert.match(layout, /\.search-results button:focus-visible\s*\{\s*outline: 3px solid var\(--focus\)/);
});
