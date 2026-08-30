import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cleanupOwnedFrontendRuntimeSnapshot,
  getOwnedFrontendRuntimeSnapshotCleanupRoot,
} from "./frontend-runtime-snapshot.js";
import { serializeTakodeBuildManifest, TAKODE_BUILD_MANIFEST_FILENAME } from "./build-identity.js";
import { startProductionServer } from "./production-entry.js";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-production-entry-"));
  tempRoots.push(root);
  return root;
}

async function writeFrontend(root: string, buildId = "build-packaged"): Promise<void> {
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(
    join(root, "index.html"),
    '<link rel="manifest" href="/manifest.json"><script type="module" src="/assets/app.js"></script>',
  );
  await writeFile(join(root, "manifest.json"), '{"name":"Takode"}');
  await writeFile(join(root, TAKODE_BUILD_MANIFEST_FILENAME), serializeTakodeBuildManifest(buildId));
  await writeFile(join(root, "assets", "app.js"), "console.log('snapshot')");
}

async function expectAbsent(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

afterEach(async () => {
  await cleanupOwnedFrontendRuntimeSnapshot();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("startProductionServer", () => {
  it("validates and copies packaged dist before importing the production server", async () => {
    const root = await makeTempRoot();
    const packageRoot = join(root, "package");
    const sourceRoot = join(packageRoot, "dist");
    const runtimeParent = join(root, "runtime", "frontends");
    await writeFrontend(sourceRoot);
    const environment = {
      NODE_ENV: "production",
      PORT: "4567",
      COMPANION_FRONTEND_RUNTIME_DIR: runtimeParent,
    } as NodeJS.ProcessEnv;
    const importServer = vi.fn(async () => {
      const servingRoot = environment.COMPANION_FRONTEND_ROOT;
      expect(servingRoot).toBeTruthy();
      expect(servingRoot).not.toBe(sourceRoot);
      expect(await readFile(join(servingRoot!, "assets", "app.js"), "utf-8")).toBe("console.log('snapshot')");
      expect(getOwnedFrontendRuntimeSnapshotCleanupRoot()).toBe(join(servingRoot!, ".."));
      expect(environment.TAKODE_BUILD_ID).toBe("build-packaged");
    });

    const snapshot = await startProductionServer({
      environment,
      packageRoot,
      cwd: root,
      homeDir: join(root, "home"),
      importServer,
    });

    expect(importServer).toHaveBeenCalledOnce();
    expect(snapshot).not.toBeNull();
    expect(environment.COMPANION_FRONTEND_ROOT).toBe(snapshot!.servingRoot);
    expect(environment.TAKODE_BUILD_ID).toBe("build-packaged");
    expect(snapshot!.cleanupRoot.split("/").at(-1)).toMatch(/^direct-4567-/);
    expect(await readFile(join(sourceRoot, "assets", "app.js"), "utf-8")).toBe("console.log('snapshot')");

    await cleanupOwnedFrontendRuntimeSnapshot();
    await expectAbsent(snapshot!.cleanupRoot);
    expect(await readFile(join(sourceRoot, "assets", "app.js"), "utf-8")).toBe("console.log('snapshot')");
  });

  it("rejects an invalid packaged frontend before importing the server", async () => {
    const root = await makeTempRoot();
    const packageRoot = join(root, "package");
    const sourceRoot = join(packageRoot, "dist");
    const runtimeParent = join(root, "runtime", "frontends");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "index.html"), "<main>missing assets</main>");
    const importServer = vi.fn(async () => undefined);

    await expect(
      startProductionServer({
        environment: {
          NODE_ENV: "production",
          COMPANION_FRONTEND_RUNTIME_DIR: runtimeParent,
        } as NodeJS.ProcessEnv,
        packageRoot,
        cwd: root,
        homeDir: join(root, "home"),
        importServer,
      }),
    ).rejects.toThrow("Production frontend is not ready (index_invalid)");

    expect(importServer).not.toHaveBeenCalled();
    await expectAbsent(runtimeParent);
    expect(getOwnedFrontendRuntimeSnapshotCleanupRoot()).toBeNull();
  });

  it("removes its snapshot and restores the configured source when server import fails", async () => {
    const root = await makeTempRoot();
    const packageRoot = join(root, "package");
    const sourceRoot = join(root, "custom-frontend");
    const runtimeParent = join(root, "runtime", "frontends");
    await writeFrontend(sourceRoot);
    const environment = {
      NODE_ENV: "production",
      COMPANION_FRONTEND_ROOT: sourceRoot,
      COMPANION_FRONTEND_RUNTIME_DIR: runtimeParent,
      TAKODE_BUILD_ID: "build-packaged",
    } as NodeJS.ProcessEnv;
    let adoptedRoot = "";

    await expect(
      startProductionServer({
        environment,
        packageRoot,
        cwd: root,
        homeDir: join(root, "home"),
        importServer: async () => {
          adoptedRoot = getOwnedFrontendRuntimeSnapshotCleanupRoot()!;
          throw new Error("server import failed");
        },
      }),
    ).rejects.toThrow("server import failed");

    expect(environment.COMPANION_FRONTEND_ROOT).toBe(sourceRoot);
    expect(environment.TAKODE_BUILD_ID).toBe("build-packaged");
    expect(getOwnedFrontendRuntimeSnapshotCleanupRoot()).toBeNull();
    await expectAbsent(adoptedRoot);
    expect(await readdir(runtimeParent)).toEqual([]);
  });

  it("rejects a configured backend identity that does not match the packaged frontend", async () => {
    const root = await makeTempRoot();
    const packageRoot = join(root, "package");
    const sourceRoot = join(packageRoot, "dist");
    const runtimeParent = join(root, "runtime", "frontends");
    await writeFrontend(sourceRoot, "build-frontend");
    const importServer = vi.fn(async () => undefined);

    await expect(
      startProductionServer({
        environment: {
          NODE_ENV: "production",
          TAKODE_BUILD_ID: "build-backend",
          COMPANION_FRONTEND_RUNTIME_DIR: runtimeParent,
        } as NodeJS.ProcessEnv,
        packageRoot,
        cwd: root,
        homeDir: join(root, "home"),
        importServer,
      }),
    ).rejects.toThrow("Configured backend build ID does not match");

    expect(importServer).not.toHaveBeenCalled();
    await expectAbsent(runtimeParent);
  });

  it("bypasses snapshots outside production mode", async () => {
    const root = await makeTempRoot();
    const environment = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
    const importServer = vi.fn(async () => undefined);

    const snapshot = await startProductionServer({
      environment,
      packageRoot: join(root, "package"),
      cwd: root,
      homeDir: join(root, "home"),
      importServer,
    });

    expect(snapshot).toBeNull();
    expect(importServer).toHaveBeenCalledOnce();
    expect(environment.COMPANION_FRONTEND_ROOT).toBeUndefined();
    expect(getOwnedFrontendRuntimeSnapshotCleanupRoot()).toBeNull();
  });
});

describe("production startup routing", () => {
  it("routes package and supported CLI foreground starts through the production entry", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf-8")) as {
      scripts: Record<string, string>;
    };
    const cliSource = await readFile(new URL("../bin/cli.ts", import.meta.url), "utf-8");

    expect(packageJson.scripts.start).toContain("server/production-entry.ts");
    expect(cliSource).toContain('await import("../server/production-entry.js")');
    expect(cliSource.match(/await startForegroundServer\(\);/g)).toHaveLength(3);
    expect(cliSource).not.toContain('await import("../server/index.ts")');
  });
});
