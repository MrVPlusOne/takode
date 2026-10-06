import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBackendStartup, findOutdatedDependencies } from "./backend-startup-check.js";

// Each test builds a disposable fake web root: a package.json manifest, a
// node_modules tree with hand-written package manifests, and a server/index.ts
// entry. Nothing touches the real checkout's node_modules.
describe("backend startup check", () => {
  let webRoot: string;

  beforeEach(async () => {
    webRoot = await mkdtemp(join(tmpdir(), "takode-backend-startup-check-"));
  });

  afterEach(async () => {
    await rm(webRoot, { recursive: true, force: true });
  });

  async function writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(join(webRoot, path)), { recursive: true });
    await writeFile(join(webRoot, path), JSON.stringify(value));
  }

  async function installPackage(name: string, version: string): Promise<void> {
    await writeJson(`node_modules/${name}/package.json`, { name, version, main: "index.js" });
    await writeFile(join(webRoot, "node_modules", name, "index.js"), "module.exports = { value: 1 };\n");
  }

  async function writeEntry(source: string): Promise<void> {
    await mkdir(join(webRoot, "server"), { recursive: true });
    await writeFile(join(webRoot, "server", "index.ts"), source);
  }

  it("reports missing and version-drifted direct dependencies, including dev and scoped ones", async () => {
    // Mirrors the incident: a commit adds dependencies to the manifest without reinstalling.
    await writeJson("package.json", {
      dependencies: { hono: "4.2.0", "web-push": "3.6.7", ranged: "^1.0.0" },
      devDependencies: { "@types/web-push": "3.6.4" },
    });
    await installPackage("hono", "4.1.0");
    await installPackage("ranged", "1.4.2");

    const outdated = await findOutdatedDependencies(webRoot);

    // Non-exact specs are only checked for presence, so the ranged package is accepted.
    expect(outdated.sort()).toEqual([
      "@types/web-push is not installed",
      "hono is 4.1.0, expected 4.2.0",
      "web-push is not installed",
    ]);
    await expect(checkBackendStartup(webRoot)).rejects.toThrow(
      /^Dependencies are out of date \(.*web-push is not installed.*\)\. Run `bun install --cwd web --frozen-lockfile`, then restart again\.$/,
    );
  });

  it("passes when dependencies match and the backend import graph resolves", async () => {
    await writeJson("package.json", { dependencies: { "fake-dep": "1.0.0" } });
    await installPackage("fake-dep", "1.0.0");
    await writeEntry('import dep from "fake-dep";\nimport { helper } from "./helper.js";\nconsole.log(dep, helper);\n');
    await writeFile(join(webRoot, "server", "helper.ts"), "export const helper = 1;\n");

    await expect(findOutdatedDependencies(webRoot)).resolves.toEqual([]);
    await expect(checkBackendStartup(webRoot)).resolves.toBeUndefined();
  });

  it("fails with Bun's resolution error when a backend import cannot load, without executing the entry", async () => {
    // Dependencies are in sync, but the backend imports a package that is not installed at all.
    // The entry would also throw if executed, proving the check only resolves modules.
    await writeJson("package.json", { dependencies: {} });
    await writeEntry('import "undeclared-package";\nthrow new Error("entry executed");\n');

    const failure = checkBackendStartup(webRoot);

    await expect(failure).rejects.toThrow(/^The backend code on disk cannot load:\n/);
    await expect(failure).rejects.toThrow(/undeclared-package/);
    await expect(failure).rejects.not.toThrow(/entry executed/);
  });
});
