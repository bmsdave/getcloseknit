import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const tablePath = join(
  webDir,
  "..",
  "docs",
  "ux-remediation-2026-09-06",
  "baseline-failures-ux-66.md",
);
const tasksDir = join(webDir, "..", "docs", "ux-remediation-2026-09-06", "tasks");

const EXPECTED_FAILURES: Array<{ spec: string; line: number; title: string }> = [
  { spec: "e2e/api-contracts.spec.ts", line: 3, title: "v1 endpoints expose versioned public contracts" },
  { spec: "e2e/api-contracts.spec.ts", line: 94, title: "school and forecast evidence remain sourced and non-probabilistic" },
  { spec: "e2e/decision-brief.spec.ts", line: 87, title: "selects candidates, previews a sourced brief, toggles private fields, and exports readable markdown" },
  { spec: "e2e/decision-brief.spec.ts", line: 154, title: "an unavailable comparison is stated explicitly and an empty brief is refused" },
  { spec: "e2e/explorer.spec.ts", line: 202, title: "operates rent, a place, schools and explicit sharing" },
  { spec: "e2e/explorer.spec.ts", line: 237, title: "sharing a profile survives clipboard denial" },
  { spec: "e2e/noise-context.spec.ts", line: 20, title: "a corridor gap never renders as a quietness guarantee" },
  { spec: "e2e/official-geography.spec.ts", line: 9, title: "official code search selects the area and keeps it on reload" },
  { spec: "e2e/planning-context.spec.ts", line: 45, title: "stale and unverified entries fail honestly, and empty searches name the covered dataset" },
  { spec: "e2e/rendering.spec.ts", line: 9, title: "MapLibre worker loads analytics geometry" },
  { spec: "e2e/rendering.spec.ts", line: 30, title: "style updates stay within the 10 ms p95 frame-work budget" },
  { spec: "e2e/rendering.spec.ts", line: 86, title: "desktop overview is visually stable" },
];

const VALID_CATEGORIES = new Set([
  "product regression",
  "intentional contract change",
  "brittle locator",
  "stale fixture",
  "environment/setup failure",
]);

interface ClassificationRow {
  spec: string;
  line: number;
  title: string;
  category: string;
  evidence: string;
  owner: string;
}

function tableRows(markdown: string): ClassificationRow[] {
  const lines = markdown.split("\n").filter((line) => line.startsWith("|"));
  assert.ok(lines.length >= 3, "classification table has a header, separator, and data rows");
  const data = lines.slice(2);
  return data.map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, 7, `table row keeps all seven columns: ${line}`);
    const match = /^(.+):(\d+)$/.exec(cells[1]);
    assert.ok(match, `spec cell names a file and line: ${cells[1]}`);
    return {
      spec: match[1],
      line: Number(match[2]),
      title: cells[2],
      category: cells[3],
      evidence: cells[5],
      owner: cells[6],
    };
  });
}

function taskIds(): Set<string> {
  const ids = new Set<string>();
  for (const entry of readdirSync(tasksDir)) {
    const match = /^(\d+)-/.exec(entry);
    if (match) ids.add(`UX-${Number(match[1])}`);
  }
  return ids;
}

function loadRows(): ClassificationRow[] {
  return tableRows(readFileSync(tablePath, "utf8"));
}

test("classification table covers exactly the 12 observed baseline failures", () => {
  const rows = loadRows();
  assert.equal(rows.length, 12, "table holds one row per observed failure");
  const observed = new Set(rows.map((row) => `${row.spec}:${row.line} ${row.title}`));
  for (const failure of EXPECTED_FAILURES) {
    assert.ok(
      observed.has(`${failure.spec}:${failure.line} ${failure.title}`),
      `table covers ${failure.spec}:${failure.line} ${failure.title}`,
    );
    const specLines = readFileSync(join(webDir, failure.spec), "utf8").split("\n");
    const declaration = specLines[failure.line - 1] ?? "";
    assert.match(declaration, /test(\.skip)?\(/, "spec line points at a test declaration");
    assert.ok(
      declaration.includes(failure.title),
      `spec line carries the tabulated title: ${failure.spec}:${failure.line}`,
    );
  }
});

test("every row carries a valid failure category", () => {
  for (const row of loadRows()) {
    assert.ok(
      VALID_CATEGORIES.has(row.category),
      `${row.spec}:${row.line} uses a known category, got: ${row.category}`,
    );
  }
});

// Run artifacts are git-ignored, so a fresh checkout only checks that each row
// names a Playwright artifact path inside this repository's web/test-results.
test("every row cites a run artifact path", () => {
  for (const row of loadRows()) {
    const candidates = row.evidence.split(";").map((part) => part.trim()).filter(Boolean);
    assert.ok(candidates.length > 0, `${row.spec}:${row.line} names at least one evidence path`);
    assert.ok(
      candidates.some((candidate) => candidate.replace(/`/g, "").startsWith("web/test-results/")),
      `${row.spec}:${row.line} cites a web/test-results/ artifact`,
    );
  }
});

test("every owning task exists in the task pack", () => {
  const ids = taskIds();
  assert.ok(ids.has("UX-66"), "task pack scan finds task files");
  for (const row of loadRows()) {
    const match = /UX-(\d+)/.exec(row.owner);
    assert.ok(match, `${row.spec}:${row.line} names an owning UX task`);
    assert.ok(ids.has(`UX-${Number(match[1])}`), `${row.spec}:${row.line} owner exists: ${row.owner}`);
  }
});
