import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseGateConfig, probeFails, runGate, type GateRunOptions, type LandingGateConfig } from "./landing-gate.js";

/**
 * A stand-in for Vitest that honors the flags the gate adds: it reads
 * fake-tests.json in its working directory ({ file: { test: "pass" | "fail" |
 * "flaky" | "fails-twice" } }), runs only the positional files when given, writes
 * a Vitest-shaped JSON report to --outputFile and exits 1 on failures. "flaky"
 * fails the first run and "fails-twice" the first two; `{"__crash__": true}`
 * exits without a report, like a runner that could not start.
 */
const FAKE_VITEST = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const output = args.find((a) => a.startsWith("--outputFile="))?.slice("--outputFile=".length);
const only = args.filter((a) => !a.startsWith("-"));
const spec = JSON.parse(readFileSync("fake-tests.json", "utf8"));
if (spec.__crash__) { console.error("runner crashed before reporting"); process.exit(1); }
const testResults = [];
let failed = 0;
for (const [file, tests] of Object.entries(spec)) {
  if (only.length && !only.includes(file)) continue;
  const assertionResults = Object.entries(tests).map(([name, kind]) => {
    let status = kind === "fail" ? "failed" : "passed";
    if (kind === "flaky" || kind === "fails-twice") {
      const marker = join(process.cwd(), ".runs-" + file + "-" + name);
      const runs = existsSync(marker) ? readFileSync(marker, "utf8").length : 0;
      status = runs < (kind === "flaky" ? 1 : 2) ? "failed" : "passed";
      writeFileSync(marker, "x".repeat(runs + 1));
    }
    if (status === "failed") failed++;
    return { fullName: name, status };
  });
  testResults.push({ name: join(process.cwd(), file), status: assertionResults.some((t) => t.status === "failed") ? "failed" : "passed", assertionResults });
}
writeFileSync(output, JSON.stringify({ success: failed === 0, testResults }));
console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
`;

describe("landing gate rerun-and-compare", () => {
  let root: string;
  let candidate: string;
  let baseline: string;
  let config: LandingGateConfig;
  const lines: string[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "landing-gate-"));
    candidate = join(root, "candidate");
    baseline = join(root, "baseline");
    for (const dir of [candidate, baseline]) {
      await mkdir(dir);
      await writeFile(join(dir, "fake-vitest.mjs"), FAKE_VITEST);
      await writeFile(join(dir, "lint.sh"), "cat lint-output.txt; test ! -s lint-output.txt\n");
      await writeFile(join(dir, "lint-output.txt"), "");
    }
    config = parseGateConfig(
      JSON.stringify({
        version: 1,
        steps: [
          { name: "lint", run: ["sh", "lint.sh"] },
          { name: "tests", kind: "vitest", run: [process.execPath, "fake-vitest.mjs"] },
        ],
      }),
    );
    lines.length = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const tests = (dir: string, spec: Record<string, Record<string, string>>) =>
    writeFile(join(dir, "fake-tests.json"), JSON.stringify(spec));
  const options = (): GateRunOptions => ({
    dir: candidate,
    config,
    log: (line) => lines.push(line),
    baselineDir: async () => baseline,
  });

  it("passes a clean tree and reports flaky tests that pass on rerun", async () => {
    await tests(candidate, { "a.test.ts": { one: "pass", two: "flaky" }, "b.test.ts": { three: "pass" } });
    const result = await runGate(options());
    expect(result.ok).toBe(true);
    expect(result.flaky).toEqual(["a.test.ts > two"]);
    expect(result.preexisting).toEqual([]);
  });

  it("does not blame failures that also happen on the baseline", async () => {
    // Environment-only failures (for example the DevBox's known failing tests) fail on both trees.
    await tests(candidate, { "env.test.ts": { owner: "fail" }, "a.test.ts": { one: "pass" } });
    await tests(baseline, { "env.test.ts": { owner: "fail" }, "a.test.ts": { one: "pass" } });
    const result = await runGate(options());
    expect(result.ok).toBe(true);
    expect(result.preexisting).toEqual(["env.test.ts > owner"]);
  });

  it("fails on a new failure and returns a probe limited to the failing file", async () => {
    await tests(candidate, { "env.test.ts": { owner: "fail" }, "a.test.ts": { one: "fail", two: "pass" } });
    await tests(baseline, { "env.test.ts": { owner: "fail" }, "a.test.ts": { one: "pass", two: "pass" } });
    const result = await runGate(options());
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("tests");
    expect(result.newFailures).toEqual(["a.test.ts > one"]);
    expect(result.preexisting).toEqual(["env.test.ts > owner"]);
    expect(result.probe?.files).toEqual(["a.test.ts"]);
    // The baseline does not show the failure; the candidate still does.
    expect(await probeFails(baseline, result.probe!, options())).toBe(false);
    expect(await probeFails(candidate, result.probe!, options())).toBe(true);
  });

  it("does not blame a test that fails twice here but passes on the base and then here", async () => {
    // Load flakiness can fail a test twice in a row; one more run of just its file decides.
    await tests(candidate, { "a.test.ts": { slow: "fails-twice" } });
    await tests(baseline, { "a.test.ts": { slow: "pass" } });
    const result = await runGate(options());
    expect(result.ok).toBe(true);
    expect(result.flaky).toEqual(["a.test.ts > slow"]);
  });

  it("fails when the test runner produces no report, even if the baseline breaks the same way", async () => {
    await tests(candidate, { __crash__: true } as never);
    await tests(baseline, { __crash__: true } as never);
    const result = await runGate(options());
    expect(result.ok).toBe(false);
    expect(result.newFailures).toEqual(["tests (no test report)"]);
    expect(result.excerpt).toContain("runner crashed before reporting");
  });

  it("compares a failing command step's output with the baseline's", async () => {
    await tests(candidate, { "a.test.ts": { one: "pass" } });
    await writeFile(join(candidate, "lint-output.txt"), "src/old.ts:12 error: bad\n");
    await writeFile(join(baseline, "lint-output.txt"), "src/old.ts:10 error: bad\n");
    const same = await runGate(options());
    expect(same.ok).toBe(true);
    expect(same.preexisting).toEqual(["lint (same failure output on the baseline)"]);

    await writeFile(join(candidate, "lint-output.txt"), "src/old.ts:12 error: bad\nsrc/new.ts:3 error: worse\n");
    const fresh = await runGate(options());
    expect(fresh.ok).toBe(false);
    expect(fresh.failedStep).toBe("lint");
    expect(fresh.excerpt).toContain("src/new.ts:3 error: worse");
  });

  it("rejects a malformed gate declaration", () => {
    expect(() => parseGateConfig(JSON.stringify({ version: 1, steps: [] }))).toThrow("at least one step");
    expect(() => parseGateConfig(JSON.stringify({ version: 1, steps: [{ name: "x", run: [] }] }))).toThrow(
      "run command",
    );
  });
});
