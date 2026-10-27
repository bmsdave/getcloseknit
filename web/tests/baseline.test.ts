import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyBaselineReport,
  documentedRunScripts,
} from "../scripts/capture-baseline";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(webDir, "..", "README.md"), "utf8");
const packageJson = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

test("a clean checkout documents only runnable commands", () => {
  assert.ok(readme.includes("npm ci"), "locked install stays documented");
  for (const script of documentedRunScripts(readme)) {
    assert.ok(packageJson.scripts[script], `documented command is runnable: npm run ${script}`);
  }
});

test("a run that executes nothing is a setup failure, not a product failure", () => {
  const summary = classifyBaselineReport({ suites: [], stats: zeroStats(), errors: [] });
  assert.equal(summary.verdict, "setup-failure");
});

test("a runner error is a setup failure even when suites exist", () => {
  const summary = classifyBaselineReport({
    suites: [],
    stats: zeroStats(),
    errors: [{ message: "Executable doesn't exist at /browsers/chromium" }],
  });
  assert.equal(summary.verdict, "setup-failure");
});

test("failing specs are existing failures with evidence paths", () => {
  const summary = classifyBaselineReport({
    suites: [
      {
        title: "explorer",
        file: "e2e/explorer.spec.ts",
        specs: [
          {
            title: "search selects an area",
            file: "e2e/explorer.spec.ts",
            line: 15,
            tests: [{ results: [{ status: "failed" }] }],
          },
        ],
        suites: [],
      },
    ],
    stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
    errors: [],
  });
  assert.equal(summary.verdict, "existing-failures");
  assert.deepEqual(summary.failures, ["e2e/explorer.spec.ts:15 search selects an area"]);
});

test("failing specs with a runner early-stop error are existing failures, not a setup failure", () => {
  const summary = classifyBaselineReport({
    suites: [
      {
        title: "explorer",
        file: "e2e/explorer.spec.ts",
        specs: [
          {
            title: "search selects an area",
            file: "e2e/explorer.spec.ts",
            line: 15,
            tests: [{ results: [{ status: "failed" }] }],
          },
        ],
        suites: [],
      },
    ],
    stats: { expected: 40, unexpected: 12, flaky: 0, skipped: 92 },
    errors: [{ message: "Testing stopped early after \u001b[31m12\u001b[0m maximum allowed failures." }],
  });
  assert.equal(summary.verdict, "existing-failures");
  assert.deepEqual(summary.failures, ["e2e/explorer.spec.ts:15 search selects an area"]);
  assert.ok(!summary.reason.includes("\u001b"), "early-stop note carries no raw ANSI escapes");
});

test("a real-shaped file suite without a suites key is existing failures", () => {
  const summary = classifyBaselineReport({
    suites: [
      {
        title: "api-contracts.spec.ts",
        file: "e2e/api-contracts.spec.ts",
        column: 0,
        line: 0,
        specs: [
          {
            title: "rejects unknown areas",
            file: "e2e/api-contracts.spec.ts",
            line: 12,
            column: 0,
            id: "abc123",
            ok: false,
            tests: [{ results: [{ status: "failed" }] }],
          },
        ],
      },
    ],
    stats: { expected: 40, unexpected: 12, flaky: 0, skipped: 92 },
    errors: [{ message: "Testing stopped early after 12 maximum allowed failures." }],
  });
  assert.equal(summary.verdict, "existing-failures");
  assert.deepEqual(summary.failures, ["e2e/api-contracts.spec.ts:12 rejects unknown areas"]);
});

test("a green run passes", () => {
  const summary = classifyBaselineReport({
    suites: [
      {
        title: "explorer",
        file: "e2e/explorer.spec.ts",
        specs: [
          {
            title: "search selects an area",
            file: "e2e/explorer.spec.ts",
            line: 15,
            tests: [{ results: [{ status: "passed" }] }],
          },
        ],
        suites: [],
      },
    ],
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
    errors: [],
  });
  assert.equal(summary.verdict, "pass");
});

function zeroStats() {
  return { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
}
