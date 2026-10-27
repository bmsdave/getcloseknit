import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface BaselineAttempt {
  status: string;
}

export interface BaselineCase {
  results?: BaselineAttempt[];
}

export interface BaselineSpec {
  title: string;
  file: string;
  line: number;
  column?: number;
  id?: string;
  ok?: boolean;
  tests?: BaselineCase[];
}

export interface BaselineSuite {
  title: string;
  file: string;
  column?: number;
  line?: number;
  specs?: BaselineSpec[];
  suites?: BaselineSuite[];
}

export interface BaselineStats {
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
}

export interface BaselineReport {
  suites: BaselineSuite[];
  stats: BaselineStats;
  errors: Array<{ message?: string }>;
}

export type BaselineVerdict = "pass" | "existing-failures" | "setup-failure";

export interface BaselineSummary {
  verdict: BaselineVerdict;
  discovered: number;
  passed: number;
  failed: number;
  failures: string[];
  reason: string;
}

export interface BaselineVersions {
  commit: string;
  node: string;
  npm: string;
  platform: string;
  playwright: string;
  next: string;
}

const UNEXPECTED = new Set(["failed", "timedOut", "interrupted"]);

export function documentedRunScripts(readme: string): string[] {
  const webSection = readme.slice(readme.indexOf("## Web"));
  const block = webSection.slice(webSection.indexOf("```sh"), webSection.indexOf("```", 4));
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("npm run "))
    .map((line) => line.slice("npm run ".length).split(/\s/)[0] as string);
}

export function classifyBaselineReport(report: BaselineReport): BaselineSummary {
  const discovered = totalOf(report.stats);
  if (discovered === 0) {
    return emptySummary("setup-failure", noTestsReason(report.errors[0]?.message));
  }
  const failures = collectFailures(report.suites, []);
  if (failures.length > 0) {
    return {
      verdict: "existing-failures",
      discovered,
      passed: report.stats.expected,
      failed: report.stats.unexpected,
      failures,
      reason: existingFailuresReason(report),
    };
  }
  if (report.errors.length > 0) {
    return emptySummary("setup-failure", `runner error: ${stripAnsi(report.errors[0]?.message ?? "unknown")}`);
  }
  return {
    verdict: "pass",
    discovered,
    passed: report.stats.expected,
    failed: 0,
    failures: [],
    reason: "every executed test passed",
  };
}

function noTestsReason(firstError?: string): string {
  const base = "no tests executed: server, browsers, or discovery failed";
  return firstError === undefined ? base : `${base}; runner error: ${stripAnsi(firstError)}`;
}

function existingFailuresReason(report: BaselineReport): string {
  const base = `${report.stats.unexpected} failing test(s) against a running server`;
  const firstError = report.errors[0]?.message;
  return firstError === undefined ? base : `${base}; runner note: ${stripAnsi(firstError)}`;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function emptySummary(verdict: BaselineVerdict, reason: string): BaselineSummary {
  return { verdict, discovered: 0, passed: 0, failed: 0, failures: [], reason };
}

function totalOf(stats: BaselineStats): number {
  return stats.expected + stats.unexpected + stats.flaky + stats.skipped;
}

function collectFailures(suites: BaselineSuite[] | undefined, found: string[]): string[] {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      const failed = (spec.tests ?? []).some((testCase) =>
        (testCase.results ?? []).some((run) => UNEXPECTED.has(run.status)),
      );
      if (failed) {
        found.push(`${spec.file}:${spec.line} ${spec.title}`);
      }
    }
    collectFailures(suite.suites, found);
  }
  return found;
}

export function recordVersions(webDir: string): BaselineVersions {
  return {
    commit: runCapture(webDir, "git", ["rev-parse", "HEAD"]),
    node: process.version,
    npm: runCapture(webDir, "npm", ["--version"]),
    platform: `${process.platform}-${process.arch}`,
    playwright: installedVersion(webDir, "@playwright/test"),
    next: installedVersion(webDir, "next"),
  };
}

function runCapture(webDir: string, command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { cwd: webDir, encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

function installedVersion(webDir: string, name: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(webDir, "node_modules", name, "package.json"), "utf8")) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return "not-installed";
  }
}

export async function runBaseline(webDir: string, outDir: string): Promise<BaselineSummary> {
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "report.json");
  const output = await spawnE2E(webDir, reportPath);
  writeFileSync(join(outDir, "baseline.log"), output);
  const summary = classifyBaselineOutput(reportPath, output);
  writeFileSync(
    join(outDir, "summary.json"),
    `${JSON.stringify({ versions: recordVersions(webDir), summary }, null, 2)}\n`,
  );
  return summary;
}

function classifyBaselineOutput(reportPath: string, output: string): BaselineSummary {
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as BaselineReport;
    return classifyBaselineReport(report);
  } catch {
    return emptySummary("setup-failure", `no parseable report; runner tail: ${output.trim().slice(-500)}`);
  }
}

function spawnE2E(webDir: string, reportPath: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["playwright", "test", "--workers=1", "--max-failures=12", "--reporter=line,json"],
      {
        cwd: webDir,
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output += String(chunk);
    });
    child.on("close", () => resolve(output));
  });
}

function printSummary(summary: BaselineSummary): void {
  console.log(`verdict: ${summary.verdict}`);
  console.log(`discovered: ${summary.discovered} passed: ${summary.passed} failed: ${summary.failed}`);
  console.log(`reason: ${summary.reason}`);
  for (const failure of summary.failures) {
    console.log(`failing: ${failure}`);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const webDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const summary = await runBaseline(webDir, join(webDir, "test-results", "baseline-ux-01"));
  printSummary(summary);
  process.exit(summary.verdict === "setup-failure" ? 1 : 0);
}
