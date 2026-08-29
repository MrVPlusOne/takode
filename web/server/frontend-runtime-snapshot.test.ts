import { afterEach, describe, expect, it, vi } from "vitest";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  createValidatedFrontendRuntimeSnapshot,
  resolveFrontendRuntimeParent,
  stopFrontendServerBeforeSnapshotCleanup,
  type FrontendRuntimeSnapshotCopier,
  type FrontendRuntimeSnapshotValidator,
} from "./frontend-runtime-snapshot.js";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-frontend-runtime-"));
  tempRoots.push(root);
  return root;
}

async function writeFrontend(root: string): Promise<void> {
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), '<script type="module" src="/assets/app.js"></script>');
  await writeFile(join(root, "manifest.json"), "{}");
  await writeFile(join(root, "assets", "app.js"), Buffer.from([0, 1, 2, 3, 255]));
}

async function snapshotFiles(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else {
        snapshot[relative(root, absolutePath)] = (await readFile(absolutePath)).toString("base64");
      }
    }
  }

  await visit(root);
  return snapshot;
}

async function expectAbsent(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

function validatingFrontend(): FrontendRuntimeSnapshotValidator {
  return async (root) => {
    await access(join(root, "index.html"));
    await access(join(root, "manifest.json"));
    await access(join(root, "assets", "app.js"));
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveFrontendRuntimeParent", () => {
  it("resolves the app-owned default from the explicit home directory", () => {
    expect(
      resolveFrontendRuntimeParent({
        homeDir: "/Users/tester",
        cwd: "/workspace/takode",
        environment: {},
      }),
    ).toBe("/Users/tester/.companion/runtime/frontends");
  });

  it("honors absolute and cwd-relative environment overrides while ignoring blank values", () => {
    const common = { homeDir: "/Users/tester", cwd: "/workspace/takode" };

    expect(
      resolveFrontendRuntimeParent({
        ...common,
        environment: { COMPANION_FRONTEND_RUNTIME_DIR: "/var/lib/takode/frontends" },
      }),
    ).toBe("/var/lib/takode/frontends");
    expect(
      resolveFrontendRuntimeParent({
        ...common,
        environment: { COMPANION_FRONTEND_RUNTIME_DIR: "runtime/frontends" },
      }),
    ).toBe("/workspace/takode/runtime/frontends");
    expect(
      resolveFrontendRuntimeParent({
        ...common,
        environment: { COMPANION_FRONTEND_RUNTIME_DIR: "   " },
      }),
    ).toBe("/Users/tester/.companion/runtime/frontends");
  });
});

describe("createValidatedFrontendRuntimeSnapshot", () => {
  it("returns a distinct validated serving root and caller-owned cleanup root", async () => {
    const root = await makeTempRoot();
    const sourceRoot = join(root, "web", "dist");
    const runtimeParent = join(root, "runtime", "frontends");
    await writeFrontend(sourceRoot);
    const sourceBefore = await snapshotFiles(sourceRoot);
    const validate = vi.fn(validatingFrontend());

    const snapshot = await createValidatedFrontendRuntimeSnapshot({
      sourceRoot,
      runtimeParent,
      prefix: "direct-3456-",
      validate,
    });

    expect(validate.mock.calls.map((call) => call[1])).toEqual(["source", "snapshot"]);
    expect(snapshot.servingRoot).toBe(join(snapshot.cleanupRoot, "dist"));
    expect(dirname(snapshot.cleanupRoot)).toBe(runtimeParent);
    expect(snapshot.cleanupRoot.split("/").at(-1)).toMatch(/^direct-3456-/);
    expect((await lstat(snapshot.servingRoot)).isDirectory()).toBe(true);
    expect((await lstat(snapshot.servingRoot)).isSymbolicLink()).toBe(false);
    expect(await snapshotFiles(snapshot.servingRoot)).toEqual(sourceBefore);
    expect(await snapshotFiles(sourceRoot)).toEqual(sourceBefore);
  });

  it("does not create or copy a candidate when source validation fails", async () => {
    const root = await makeTempRoot();
    const sourceRoot = join(root, "web", "dist");
    const runtimeParent = join(root, "runtime", "frontends");
    await writeFrontend(sourceRoot);
    const sourceBefore = await snapshotFiles(sourceRoot);
    const copier = vi.fn<FrontendRuntimeSnapshotCopier>();

    await expect(
      createValidatedFrontendRuntimeSnapshot({
        sourceRoot,
        runtimeParent,
        prefix: "direct-3456-",
        copier,
        validate: async (_frontendRoot, phase) => {
          expect(phase).toBe("source");
          throw new Error("source dist is invalid");
        },
      }),
    ).rejects.toThrow("source dist is invalid");

    expect(copier).not.toHaveBeenCalled();
    await expectAbsent(runtimeParent);
    expect(await snapshotFiles(sourceRoot)).toEqual(sourceBefore);
  });

  it("removes only its partial candidate when copying fails", async () => {
    // Direct-start protection must not trade a missing web/dist for a partially copied runtime tree. A failed copy owns
    // only its fresh candidate, while the validated source remains byte-identical for diagnosis or retry.
    const root = await makeTempRoot();
    const sourceRoot = join(root, "web", "dist");
    const runtimeParent = join(root, "runtime", "frontends");
    await writeFrontend(sourceRoot);
    const sourceBefore = await snapshotFiles(sourceRoot);
    let cleanupRoot = "";
    const copier: FrontendRuntimeSnapshotCopier = async (_source, destination) => {
      cleanupRoot = dirname(destination);
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, "index.html"), "partial");
      throw new Error("copy interrupted");
    };

    await expect(
      createValidatedFrontendRuntimeSnapshot({
        sourceRoot,
        runtimeParent,
        prefix: "direct-3456-",
        copier,
        validate: validatingFrontend(),
      }),
    ).rejects.toThrow("copy interrupted");

    await expectAbsent(cleanupRoot);
    expect(await readdir(runtimeParent)).toEqual([]);
    expect(await snapshotFiles(sourceRoot)).toEqual(sourceBefore);
  });

  it("removes a fully copied candidate rejected by snapshot validation", async () => {
    const root = await makeTempRoot();
    const sourceRoot = join(root, "web", "dist");
    const runtimeParent = join(root, "runtime", "frontends");
    await writeFrontend(sourceRoot);
    const sourceBefore = await snapshotFiles(sourceRoot);
    let copiedRoot = "";

    await expect(
      createValidatedFrontendRuntimeSnapshot({
        sourceRoot,
        runtimeParent,
        prefix: "direct-3456-",
        validate: async (frontendRoot, phase) => {
          await validatingFrontend()(frontendRoot, phase);
          if (phase === "snapshot") {
            copiedRoot = dirname(frontendRoot);
            throw new Error("copied snapshot is invalid");
          }
        },
      }),
    ).rejects.toThrow("copied snapshot is invalid");

    await expectAbsent(copiedRoot);
    expect(await readdir(runtimeParent)).toEqual([]);
    expect(await snapshotFiles(sourceRoot)).toEqual(sourceBefore);
  });
});

describe("stopFrontendServerBeforeSnapshotCleanup", () => {
  it("stops active serving before deleting the owned frontend", async () => {
    // The outage contract requires the API listener to close before its static tree disappears.
    const order: string[] = [];
    const server = {
      stop: vi.fn(async (closeActiveConnections?: boolean) => {
        expect(closeActiveConnections).toBe(true);
        order.push("stop");
      }),
    };
    const cleanup = vi.fn(async () => {
      order.push("cleanup");
    });
    const onFailure = vi.fn();

    await stopFrontendServerBeforeSnapshotCleanup({ server, cleanup, onFailure });

    expect(order).toEqual(["stop", "cleanup"]);
    expect(server.stop).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("preserves the snapshot when listener shutdown fails", async () => {
    // Process exit will still close the listener, but deleting first would recreate health-200/static-404 split-brain.
    const stopFailure = new Error("listener would not stop");
    const cleanup = vi.fn(async () => undefined);
    const onFailure = vi.fn();

    await stopFrontendServerBeforeSnapshotCleanup({
      server: { stop: vi.fn(async () => Promise.reject(stopFailure)) },
      cleanup,
      onFailure,
    });

    expect(cleanup).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith("stop", stopFailure);
  });
});
