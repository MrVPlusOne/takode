import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { landingGateEnv, landingMachineConfigPath, loadLandingMachineEnv } from "./landing-machine-config.js";

describe("per-machine landing gate environment", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    // A disposable stand-in for ~/.companion/landing.json; the real home is never read.
    dir = await mkdtemp(join(tmpdir(), "landing-machine-config-"));
    path = join(dir, "landing.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lives at ~/.companion/landing.json", () => {
    expect(landingMachineConfigPath("/home/someone")).toBe(join("/home/someone", ".companion", "landing.json"));
  });

  it("keeps the machine's own environment when nothing is configured", async () => {
    expect(await loadLandingMachineEnv(path)).toEqual({});
    const lines: string[] = [];
    const env = await landingGateEnv((line) => lines.push(line), path);
    expect(env.PATH).toBe(process.env.PATH);
    expect(lines).toEqual([]);
  });

  it("overrides the process environment with the configured variables and logs only their names", async () => {
    // The motivating case: a machine-wide registry mirror lags releases, so gate installs use another registry.
    await writeFile(
      path,
      JSON.stringify({ env: { NPM_CONFIG_REGISTRY: "https://registry.example.test/", PATH: "/custom/bin" } }),
    );
    const lines: string[] = [];
    const env = await landingGateEnv((line) => lines.push(line), path);
    expect(env.NPM_CONFIG_REGISTRY).toBe("https://registry.example.test/");
    expect(env.PATH).toBe("/custom/bin");
    expect(lines).toEqual([`Gate commands use NPM_CONFIG_REGISTRY, PATH from ${path}.`]);
    expect(lines.join("")).not.toContain("registry.example.test");
  });

  it("rejects malformed configuration instead of silently ignoring it", async () => {
    await writeFile(path, "{ not json");
    await expect(loadLandingMachineEnv(path)).rejects.toThrow("not valid JSON");
    await writeFile(path, JSON.stringify({ env: ["NPM_CONFIG_REGISTRY"] }));
    await expect(loadLandingMachineEnv(path)).rejects.toThrow('"env" must be an object');
    await writeFile(path, JSON.stringify({ env: { "BAD-NAME": "x" } }));
    await expect(loadLandingMachineEnv(path)).rejects.toThrow("not a valid variable name");
    await writeFile(path, JSON.stringify({ env: { PORT: 3000 } }));
    await expect(loadLandingMachineEnv(path)).rejects.toThrow("must be a string");
  });
});
