#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFrontendAvailability } from "./frontend-availability.js";
import { normalizeTakodeBuildId, readTakodeBuildManifest } from "./build-identity.js";
import {
  adoptFrontendRuntimeSnapshot,
  cleanupOwnedFrontendRuntimeSnapshot,
  createValidatedFrontendRuntimeSnapshot,
  resolveFrontendRuntimeParent,
  type FrontendRuntimeSnapshot,
  type FrontendRuntimeParentEnvironment,
} from "./frontend-runtime-snapshot.js";

export interface StartProductionServerOptions {
  environment?: FrontendRuntimeParentEnvironment & NodeJS.ProcessEnv;
  packageRoot?: string;
  cwd?: string;
  homeDir?: string;
  importServer?: () => Promise<unknown>;
}

function frontendSnapshotPrefix(environment: NodeJS.ProcessEnv): string {
  const portLabel = (environment.PORT || "default").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `direct-${portLabel}-`;
}

async function validateProductionFrontend(frontendRoot: string): Promise<void> {
  const availability = await checkFrontendAvailability({ required: true, frontendRoot });
  if (!availability.ready) {
    throw new Error(`Production frontend is not ready (${availability.reason})`);
  }
}

/**
 * Starts the server through a validated copy of its packaged frontend.
 *
 * Copying before importing the server keeps direct CLI, package-script, and
 * service starts independent from later mutation or cleanup of packaged `dist`.
 * The server shutdown path removes the adopted snapshot after state is flushed.
 */
export async function startProductionServer(
  options: StartProductionServerOptions = {},
): Promise<FrontendRuntimeSnapshot | null> {
  const environment = options.environment ?? process.env;
  environment.NODE_ENV ||= "production";
  const importServer = options.importServer ?? (() => import("./index.js"));

  if (environment.NODE_ENV !== "production") {
    await importServer();
    return null;
  }

  const modulePackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const packageRoot = resolve(options.packageRoot ?? environment.__COMPANION_PACKAGE_ROOT ?? modulePackageRoot);
  const sourceRoot = resolve(packageRoot, environment.COMPANION_FRONTEND_ROOT?.trim() || "dist");
  const runtimeParent = resolveFrontendRuntimeParent({
    homeDir: options.homeDir ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    environment: {
      COMPANION_FRONTEND_RUNTIME_DIR: environment.COMPANION_FRONTEND_RUNTIME_DIR,
    },
  });
  const previousFrontendRoot = environment.COMPANION_FRONTEND_ROOT;
  const previousBuildId = environment.TAKODE_BUILD_ID;
  await validateProductionFrontend(sourceRoot);
  const sourceBuildId = (await readTakodeBuildManifest(sourceRoot)).buildId;
  if (previousBuildId !== undefined && normalizeTakodeBuildId(previousBuildId) !== sourceBuildId) {
    throw new Error("Configured backend build ID does not match the packaged frontend build");
  }

  const snapshot = await createValidatedFrontendRuntimeSnapshot({
    sourceRoot,
    runtimeParent,
    prefix: frontendSnapshotPrefix(environment),
    validate: async (frontendRoot) => {
      await validateProductionFrontend(frontendRoot);
      const manifest = await readTakodeBuildManifest(frontendRoot);
      if (manifest.buildId !== sourceBuildId) {
        throw new Error("Copied frontend build ID does not match the packaged frontend build");
      }
    },
  });

  let adopted = false;
  try {
    adoptFrontendRuntimeSnapshot(snapshot);
    adopted = true;
    environment.COMPANION_FRONTEND_ROOT = snapshot.servingRoot;
    environment.TAKODE_BUILD_ID = sourceBuildId;
    await importServer();
    return snapshot;
  } catch (failure) {
    if (previousFrontendRoot === undefined) {
      delete environment.COMPANION_FRONTEND_ROOT;
    } else {
      environment.COMPANION_FRONTEND_ROOT = previousFrontendRoot;
    }
    if (previousBuildId === undefined) {
      delete environment.TAKODE_BUILD_ID;
    } else {
      environment.TAKODE_BUILD_ID = previousBuildId;
    }

    try {
      if (adopted) {
        await cleanupOwnedFrontendRuntimeSnapshot();
      } else {
        await rm(snapshot.cleanupRoot, { recursive: true, force: true });
      }
    } catch (cleanupFailure) {
      throw new AggregateError([failure, cleanupFailure], "Server startup failed and frontend cleanup also failed");
    }
    throw failure;
  }
}

if (import.meta.main) {
  await startProductionServer().catch((error) => {
    console.error("[production-entry] Failed to start Takode:", error);
    process.exit(1);
  });
}
