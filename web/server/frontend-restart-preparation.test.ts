import { afterEach, describe, expect, it, vi } from "vitest";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeTakodeBuildManifest } from "./build-identity.js";
import type {
  CreateFrontendBuildCandidateOptions,
  ValidatedFrontendBuildCandidate,
} from "./frontend-build-candidate.js";
import {
  FRONTEND_RESTART_HANDOFF_FILENAME,
  consumeFrontendRestartHandoff,
  createProductionFrontendRestartPreparer,
} from "./frontend-restart-preparation.js";

const tempRoots: string[] = [];

async function makeRuntime(): Promise<{ root: string; runtimeRoot: string; webRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "takode-restart-preparation-"));
  tempRoots.push(root);
  const runtimeRoot = join(root, "runtime");
  const webRoot = join(root, "web");
  await Promise.all([mkdir(runtimeRoot), mkdir(webRoot)]);
  return { root, runtimeRoot, webRoot };
}

async function writeCandidate(
  runtimeRoot: string,
  suffix: string,
  buildId: string,
): Promise<ValidatedFrontendBuildCandidate> {
  const frontendRoot = join(runtimeRoot, `frontend-build-${suffix}`);
  await mkdir(join(frontendRoot, "assets"), { recursive: true });
  await Promise.all([
    writeFile(join(frontendRoot, "index.html"), `<script src="/assets/app.js"></script>`),
    writeFile(join(frontendRoot, "assets", "app.js"), "console.log('ready')"),
    writeFile(join(frontendRoot, "takode-build.json"), serializeTakodeBuildManifest(buildId)),
  ]);
  return { frontendRoot, buildId };
}

function candidateBuilder(candidate: ValidatedFrontendBuildCandidate) {
  return vi.fn(async (options: CreateFrontendBuildCandidateOptions) => {
    await options.validate(candidate.frontendRoot);
    return candidate;
  });
}

async function waitForCandidateMarker(runtimeRoot: string, marker: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    for (const entry of await readdir(runtimeRoot)) {
      if (!entry.startsWith("frontend-build-")) continue;
      const candidateRoot = join(runtimeRoot, entry);
      try {
        await access(join(candidateRoot, marker));
        return candidateRoot;
      } catch {
        // The child-owned marker is the deterministic synchronization point.
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Timed out waiting for candidate marker: ${marker}`);
}

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
  }
  throw new Error(`Timed out waiting for path: ${path}`);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("production frontend restart preparation", () => {
  it("keeps a validated candidate private until restart preparation publishes it", async () => {
    // The current server remains authoritative while the candidate is built. Only the final publish creates the
    // supervisor-visible handoff, so a failed session-preparation step can discard the build without restarting.
    const { runtimeRoot, webRoot } = await makeRuntime();
    const candidate = await writeCandidate(runtimeRoot, "next", "build-next");
    const validate = vi.fn(async () => {});
    const environment = { NODE_ENV: "production", SENTINEL: "preserved" } as NodeJS.ProcessEnv;
    const buildCandidate = candidateBuilder(candidate);
    const controller = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      environment,
      validate,
      buildCandidate,
    });

    const prepared = await controller.prepare();

    await expect(access(join(runtimeRoot, FRONTEND_RESTART_HANDOFF_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(buildCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ webRoot, runtimeRoot, environment, validate }),
    );
    expect(prepared).toMatchObject(candidate);

    await prepared.publish();
    const handoff = JSON.parse(await readFile(join(runtimeRoot, FRONTEND_RESTART_HANDOFF_FILENAME), "utf-8"));
    expect(handoff).toEqual({ version: 1, candidateName: "frontend-build-next", buildId: "build-next" });

    const consumeValidate = vi.fn(async () => {});
    await expect(consumeFrontendRestartHandoff({ runtimeRoot, validate: consumeValidate })).resolves.toEqual(candidate);
    expect(consumeValidate).toHaveBeenCalledWith(candidate.frontendRoot);
    await expect(access(join(runtimeRoot, FRONTEND_RESTART_HANDOFF_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("discards an unpublished candidate without creating a handoff", async () => {
    const { runtimeRoot, webRoot } = await makeRuntime();
    const candidate = await writeCandidate(runtimeRoot, "discard", "build-discard");
    const controller = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      validate: async () => {},
      buildCandidate: candidateBuilder(candidate),
    });

    const prepared = await controller.prepare();
    await prepared.discard();
    await prepared.discard();

    await expect(access(candidate.frontendRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(runtimeRoot, FRONTEND_RESTART_HANDOFF_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a builder result outside the supervised runtime root without deleting it", async () => {
    // A handoff path is never trusted just because a builder returned it. Refusing to delete the outside directory also
    // prevents an unsafe cleanup path from turning a malformed handoff into durable-data loss.
    const { root, runtimeRoot, webRoot } = await makeRuntime();
    const outside = await writeCandidate(root, "outside", "build-outside");
    const controller = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      validate: async () => {},
      buildCandidate: candidateBuilder(outside),
    });

    await expect(controller.prepare()).rejects.toThrow("outside the supervised runtime root");
    await access(outside.frontendRoot);
    expect(await readdir(runtimeRoot)).toEqual([]);
  });

  it("rejects traversal in a consumed handoff before touching an outside candidate", async () => {
    const { root, runtimeRoot } = await makeRuntime();
    const outside = await writeCandidate(root, "outside", "build-outside");
    await writeFile(
      join(runtimeRoot, FRONTEND_RESTART_HANDOFF_FILENAME),
      JSON.stringify({ version: 1, candidateName: "../frontend-build-outside", buildId: "build-outside" }),
    );

    await expect(consumeFrontendRestartHandoff({ runtimeRoot, validate: async () => {} })).rejects.toThrow(
      "invalid candidate name",
    );
    await access(outside.frontendRoot);
  });

  it("rejects a handoff whose candidate manifest changed after publication", async () => {
    const { runtimeRoot, webRoot } = await makeRuntime();
    const candidate = await writeCandidate(runtimeRoot, "tampered", "build-original");
    const controller = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      validate: async () => {},
      buildCandidate: candidateBuilder(candidate),
    });
    const prepared = await controller.prepare();
    await prepared.publish();
    await writeFile(join(candidate.frontendRoot, "takode-build.json"), serializeTakodeBuildManifest("build-tampered"));

    await expect(consumeFrontendRestartHandoff({ runtimeRoot, validate: async () => {} })).rejects.toThrow(
      "manifest does not match",
    );
  });

  it("rejects concurrent preparations and shuts down the in-flight operation once", async () => {
    const { runtimeRoot, webRoot } = await makeRuntime();
    let markStarted!: () => void;
    const started = new Promise<void>((resolvePromise) => {
      markStarted = resolvePromise;
    });
    const buildCandidate = vi.fn(
      async (options: CreateFrontendBuildCandidateOptions): Promise<ValidatedFrontendBuildCandidate> => {
        markStarted();
        return await new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        });
      },
    );
    const controller = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      validate: async () => {},
      buildCandidate,
    });
    const firstResult = controller.prepare().then(
      () => null,
      (error) => error,
    );
    await started;

    await expect(controller.prepare()).rejects.toThrow("already being prepared");
    const shutdownReason = new Error("test shutdown");
    await controller.cancelAndWait(shutdownReason);

    expect(await firstResult).toBe(shutdownReason);
    expect(buildCandidate).toHaveBeenCalledOnce();
    await expect(controller.prepare()).rejects.toThrow("shutting down");
  });

  it("reports cleanup failure without wedging later restart preparation", async () => {
    const { runtimeRoot, webRoot } = await makeRuntime();
    const first = await writeCandidate(runtimeRoot, "cleanup-fails", "build-cleanup-fails");
    const second = await writeCandidate(runtimeRoot, "cleanup-retry", "build-cleanup-retry");
    const candidates = [first, second];
    const buildCandidate = vi.fn(async (options: CreateFrontendBuildCandidateOptions) => {
      const candidate = candidates.shift();
      if (!candidate) throw new Error("unexpected build");
      await options.validate(candidate.frontendRoot);
      return candidate;
    });
    const removeCandidate = vi
      .fn<(frontendRoot: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary cleanup failure"))
      .mockImplementation(async (frontendRoot) => rm(frontendRoot, { recursive: true, force: true }));
    const controller = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      validate: async () => {},
      buildCandidate,
      removeCandidate,
    });

    const firstPrepared = await controller.prepare();
    await expect(firstPrepared.discard()).rejects.toThrow("temporary cleanup failure");

    const secondPrepared = await controller.prepare();
    expect(secondPrepared.frontendRoot).toBe(second.frontendRoot);
    await secondPrepared.discard();
    expect(buildCandidate).toHaveBeenCalledTimes(2);
  });

  it("waits for an in-flight handoff publication instead of discarding its candidate", async () => {
    const { runtimeRoot, webRoot } = await makeRuntime();
    const candidate = await writeCandidate(runtimeRoot, "publishing", "build-publishing");
    let markPublishing!: () => void;
    const publishing = new Promise<void>((resolvePromise) => {
      markPublishing = resolvePromise;
    });
    let releasePublication!: () => void;
    const publicationRelease = new Promise<void>((resolvePromise) => {
      releasePublication = resolvePromise;
    });
    const publishHandoff = vi.fn(async () => {
      markPublishing();
      await publicationRelease;
    });
    const controller = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      validate: async () => {},
      buildCandidate: candidateBuilder(candidate),
      publishHandoff,
    });
    const prepared = await controller.prepare();
    const publish = prepared.publish();
    await publishing;
    let shutdownSettled = false;
    const shutdown = controller.cancelAndWait(new Error("shutdown during publication")).then(() => {
      shutdownSettled = true;
    });

    await Promise.resolve();
    expect(shutdownSettled).toBe(false);
    await access(candidate.frontendRoot);

    releasePublication();
    await Promise.all([publish, shutdown]);

    expect(publishHandoff).toHaveBeenCalledOnce();
    await access(candidate.frontendRoot);
  });

  it("aborts and awaits the owned Vite child before shutdown can continue", async () => {
    // The supervisor may remove the whole runtime root after its backend exits. This proves the backend shutdown hook waits
    // until the nested Vite child acknowledges SIGTERM, stops writing, exits, and has its partial candidate removed.
    const { runtimeRoot, webRoot } = await makeRuntime();
    const vitePath = join(webRoot, "node_modules", ".bin", "vite");
    await mkdir(join(webRoot, "node_modules", ".bin"), { recursive: true });
    await writeFile(
      vitePath,
      `#!${process.execPath}\n` +
        `const { existsSync, writeFileSync } = require("node:fs");\n` +
        `const args = process.argv.slice(2);\n` +
        `const outDir = args[args.indexOf("--outDir") + 1];\n` +
        `process.on("SIGTERM", () => {\n` +
        `  writeFileSync(outDir + ".stopping", "stopping");\n` +
        `  const timer = setInterval(() => {\n` +
        `    if (!existsSync(outDir + ".release")) return;\n` +
        `    clearInterval(timer);\n` +
        `    writeFileSync(outDir + ".stopped", "stopped");\n` +
        `    process.exit(0);\n` +
        `  }, 10);\n` +
        `});\n` +
        `writeFileSync(outDir + "/started", "started");\n` +
        `setInterval(() => {}, 1000);\n`,
    );
    await chmod(vitePath, 0o755);
    const controller = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      validate: async () => {},
    });
    const preparationResult = controller.prepare().then(
      () => null,
      (error) => error,
    );
    const candidateRoot = await waitForCandidateMarker(runtimeRoot, "started");
    const shutdownReason = new Error("supervisor shutdown");
    let shutdownSettled = false;
    const shutdown = controller.cancelAndWait(shutdownReason).then(() => {
      shutdownSettled = true;
    });

    await waitForPath(`${candidateRoot}.stopping`);
    expect(shutdownSettled).toBe(false);
    await access(candidateRoot);

    await writeFile(`${candidateRoot}.release`, "release");
    await shutdown;

    expect(await preparationResult).toBe(shutdownReason);
    expect(await readFile(`${candidateRoot}.stopped`, "utf-8")).toBe("stopped");
    await expect(access(candidateRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite an already published handoff", async () => {
    const { runtimeRoot, webRoot } = await makeRuntime();
    const first = await writeCandidate(runtimeRoot, "first", "build-first");
    const second = await writeCandidate(runtimeRoot, "second", "build-second");
    const firstController = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      validate: async () => {},
      buildCandidate: candidateBuilder(first),
    });
    const secondController = createProductionFrontendRestartPreparer({
      webRoot,
      runtimeRoot,
      validate: async () => {},
      buildCandidate: candidateBuilder(second),
    });
    const firstPrepared = await firstController.prepare();
    const secondPrepared = await secondController.prepare();

    await firstPrepared.publish();
    await expect(secondPrepared.publish()).rejects.toThrow("already pending");
    await expect(access(second.frontendRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(consumeFrontendRestartHandoff({ runtimeRoot, validate: async () => {} })).resolves.toEqual(first);
  });
});
