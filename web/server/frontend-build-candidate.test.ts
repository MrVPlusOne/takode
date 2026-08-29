import { afterEach, describe, expect, it, vi } from "vitest";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  createValidatedFrontendBuildCandidate,
  type FrontendBuildInvocation,
  type FrontendBuildRunner,
} from "./frontend-build-candidate.js";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-frontend-build-"));
  tempRoots.push(root);
  return root;
}

async function writeActiveSnapshot(activeDir: string): Promise<{ index: Buffer; asset: Buffer }> {
  await mkdir(join(activeDir, "assets"), { recursive: true });
  const index = Buffer.from("known-good-index\n", "utf8");
  const asset = Buffer.from([0, 1, 2, 3, 255]);
  await writeFile(join(activeDir, "index.html"), index);
  await writeFile(join(activeDir, "assets", "app.bin"), asset);
  return { index, asset };
}

async function expectActiveSnapshot(activeDir: string, expected: { index: Buffer; asset: Buffer }): Promise<void> {
  expect(await readFile(join(activeDir, "index.html"))).toEqual(expected.index);
  expect(await readFile(join(activeDir, "assets", "app.bin"))).toEqual(expected.asset);
}

async function waitForStartedCandidate(runtimeRoot: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const entries = await readdir(runtimeRoot).catch(() => []);
    for (const entry of entries) {
      const candidateDir = join(runtimeRoot, entry);
      try {
        await access(join(candidateDir, "started"));
        return candidateDir;
      } catch {
        // The child-written marker is the deterministic gate; keep waiting until the build has installed its handler.
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error("Timed out waiting for the frontend build child to start");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createValidatedFrontendBuildCandidate", () => {
  it("removes a partial failed candidate while preserving the active snapshot byte-for-byte", async () => {
    // This models the outage edge case: Vite has begun writing output and then fails. The active frontend must never be
    // the build target, so the healthy server keeps serving the exact previous bytes.
    const root = await makeTempRoot();
    const webRoot = join(root, "web");
    const runtimeRoot = join(root, "runtime");
    const activeDir = join(root, "active-frontend");
    await mkdir(webRoot, { recursive: true });
    const activeSnapshot = await writeActiveSnapshot(activeDir);
    let invocation: FrontendBuildInvocation | undefined;
    const runner: FrontendBuildRunner = vi.fn(async (nextInvocation) => {
      invocation = nextInvocation;
      await writeFile(join(nextInvocation.candidateDir, "index.html"), "partial-output");
      return 1;
    });
    const validate = vi.fn(async () => {});

    await expect(createValidatedFrontendBuildCandidate({ webRoot, runtimeRoot, runner, validate })).rejects.toThrow(
      "Frontend build exited with code 1",
    );

    expect(validate).not.toHaveBeenCalled();
    expect(invocation).toBeDefined();
    expect(invocation?.executable).toBe(join(webRoot, "node_modules", ".bin", "vite"));
    expect(invocation?.args).toEqual(["build", "--outDir", invocation?.candidateDir, "--emptyOutDir"]);
    expect(invocation?.candidateDir).not.toBe(activeDir);
    await expect(access(invocation!.candidateDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expectActiveSnapshot(activeDir, activeSnapshot);
    expect(await readdir(runtimeRoot)).toEqual([]);
  });

  it("removes output rejected by validation without touching the active snapshot", async () => {
    const root = await makeTempRoot();
    const webRoot = join(root, "web");
    const runtimeRoot = join(root, "runtime");
    const activeDir = join(root, "active-frontend");
    await mkdir(webRoot, { recursive: true });
    const activeSnapshot = await writeActiveSnapshot(activeDir);
    let candidateDir = "";
    const runner: FrontendBuildRunner = async (invocation) => {
      candidateDir = invocation.candidateDir;
      await writeFile(join(candidateDir, "index.html"), "invalid-output");
      return 0;
    };

    await expect(
      createValidatedFrontendBuildCandidate({
        webRoot,
        runtimeRoot,
        runner,
        validate: async () => {
          throw new Error("candidate is missing required assets");
        },
      }),
    ).rejects.toThrow("candidate is missing required assets");

    await expect(access(candidateDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expectActiveSnapshot(activeDir, activeSnapshot);
  });

  it("returns a distinct candidate only after validation succeeds", async () => {
    // A successful build remains isolated until its complete candidate has passed validation; promotion is a separate
    // caller-owned operation, so this helper cannot overwrite the frontend currently serving users.
    const root = await makeTempRoot();
    const webRoot = join(root, "web");
    const runtimeRoot = join(root, "runtime");
    const activeDir = join(root, "active-frontend");
    await mkdir(webRoot, { recursive: true });
    const activeSnapshot = await writeActiveSnapshot(activeDir);
    const runner: FrontendBuildRunner = async (invocation) => {
      await mkdir(join(invocation.candidateDir, "assets"), { recursive: true });
      await writeFile(join(invocation.candidateDir, "index.html"), "candidate-index");
      await writeFile(join(invocation.candidateDir, "assets", "app.js"), "candidate-asset");
      return 0;
    };
    const validate = vi.fn(async (candidateDir: string) => {
      expect(await readFile(join(candidateDir, "index.html"), "utf8")).toBe("candidate-index");
      expect(await readFile(join(candidateDir, "assets", "app.js"), "utf8")).toBe("candidate-asset");
    });

    const candidateDir = await createValidatedFrontendBuildCandidate({ webRoot, runtimeRoot, runner, validate });

    expect(validate).toHaveBeenCalledOnce();
    expect(candidateDir).not.toBe(activeDir);
    expect(relative(runtimeRoot, candidateDir)).not.toMatch(/^\.\./);
    expect(await readFile(join(candidateDir, "index.html"), "utf8")).toBe("candidate-index");
    await expectActiveSnapshot(activeDir, activeSnapshot);
  });

  it("aborts and awaits the Vite child before removing its candidate", async () => {
    // Shutdown must not remove the runtime tree while Vite can still write into it. This executable delays its exit
    // after SIGTERM and leaves an outside marker, proving candidate cleanup happened only after the child stopped.
    const root = await makeTempRoot();
    const webRoot = join(root, "web");
    const runtimeRoot = join(root, "runtime");
    const vitePath = join(webRoot, "node_modules", ".bin", "vite");
    await mkdir(join(webRoot, "node_modules", ".bin"), { recursive: true });
    await writeFile(
      vitePath,
      `#!${process.execPath}\n` +
        `const { writeFileSync } = require("node:fs");\n` +
        `const args = process.argv.slice(2);\n` +
        `const outDir = args[args.indexOf("--outDir") + 1];\n` +
        `process.on("SIGTERM", () => {\n` +
        `  setTimeout(() => {\n` +
        `    writeFileSync(outDir + ".stopped", "stopped");\n` +
        `    process.exit(0);\n` +
        `  }, 100);\n` +
        `});\n` +
        `writeFileSync(outDir + "/started", "started");\n` +
        `setInterval(() => {}, 1000);\n`,
    );
    await chmod(vitePath, 0o755);

    const abortController = new AbortController();
    const validate = vi.fn(async () => {});
    const build = createValidatedFrontendBuildCandidate({
      webRoot,
      runtimeRoot,
      validate,
      signal: abortController.signal,
    });
    const candidateDir = await waitForStartedCandidate(runtimeRoot);
    const shutdownReason = new Error("test wrapper shutdown");

    abortController.abort(shutdownReason);

    await expect(build).rejects.toBe(shutdownReason);
    expect(validate).not.toHaveBeenCalled();
    expect(await readFile(`${candidateDir}.stopped`, "utf8")).toBe("stopped");
    await expect(access(candidateDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
