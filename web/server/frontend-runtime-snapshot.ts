import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export interface FrontendRuntimeParentEnvironment {
  COMPANION_FRONTEND_RUNTIME_DIR?: string;
}

export interface ResolveFrontendRuntimeParentOptions {
  homeDir: string;
  cwd: string;
  environment: FrontendRuntimeParentEnvironment;
}

export function resolveFrontendRuntimeParent(options: ResolveFrontendRuntimeParentOptions): string {
  const configured = options.environment.COMPANION_FRONTEND_RUNTIME_DIR?.trim();
  if (configured) {
    return isAbsolute(configured) ? resolve(configured) : resolve(options.cwd, configured);
  }
  return resolve(options.homeDir, ".companion", "runtime", "frontends");
}

export type FrontendRuntimeSnapshotValidationPhase = "source" | "snapshot";

export type FrontendRuntimeSnapshotValidator = (
  frontendRoot: string,
  phase: FrontendRuntimeSnapshotValidationPhase,
) => Promise<void>;

export type FrontendRuntimeSnapshotCopier = (sourceRoot: string, destinationRoot: string) => Promise<void>;

export interface CreateFrontendRuntimeSnapshotOptions {
  sourceRoot: string;
  runtimeParent: string;
  prefix: string;
  validate: FrontendRuntimeSnapshotValidator;
  copier?: FrontendRuntimeSnapshotCopier;
}

export interface FrontendRuntimeSnapshot {
  servingRoot: string;
  cleanupRoot: string;
}

let ownedRuntimeSnapshotCleanupRoot: string | null = null;

/**
 * Registers the direct-start snapshot that this server process owns.
 *
 * Supervised servers keep ownership in `serve.ts`; direct production entrypoints
 * share this module with `index.ts`, which removes the registered root during
 * graceful shutdown or restart.
 */
export function adoptFrontendRuntimeSnapshot(snapshot: FrontendRuntimeSnapshot): void {
  const cleanupRoot = resolve(snapshot.cleanupRoot);
  if (ownedRuntimeSnapshotCleanupRoot && ownedRuntimeSnapshotCleanupRoot !== cleanupRoot) {
    throw new Error(`A frontend runtime snapshot is already owned: ${ownedRuntimeSnapshotCleanupRoot}`);
  }
  ownedRuntimeSnapshotCleanupRoot = cleanupRoot;
}

export async function cleanupOwnedFrontendRuntimeSnapshot(): Promise<void> {
  const cleanupRoot = ownedRuntimeSnapshotCleanupRoot;
  if (!cleanupRoot) return;

  ownedRuntimeSnapshotCleanupRoot = null;
  try {
    await rm(cleanupRoot, { recursive: true, force: true });
  } catch (error) {
    ownedRuntimeSnapshotCleanupRoot = cleanupRoot;
    throw error;
  }
}

export function getOwnedFrontendRuntimeSnapshotCleanupRoot(): string | null {
  return ownedRuntimeSnapshotCleanupRoot;
}

export interface FrontendServingServer {
  stop(closeActiveConnections?: boolean): Promise<void>;
}

export type FrontendShutdownFailurePhase = "stop" | "cleanup";

export interface StopFrontendServerBeforeCleanupOptions {
  server: FrontendServingServer;
  cleanup?: () => Promise<void>;
  onFailure: (phase: FrontendShutdownFailurePhase, error: unknown) => void;
}

/**
 * Stops HTTP/WebSocket serving before removing a direct-start frontend snapshot.
 *
 * If listener shutdown fails, preserve the snapshot and let process exit close the
 * server rather than reintroducing a live API with missing static assets.
 */
export async function stopFrontendServerBeforeSnapshotCleanup(
  options: StopFrontendServerBeforeCleanupOptions,
): Promise<void> {
  try {
    await options.server.stop(true);
  } catch (error) {
    options.onFailure("stop", error);
    return;
  }

  try {
    await (options.cleanup ?? cleanupOwnedFrontendRuntimeSnapshot)();
  } catch (error) {
    options.onFailure("cleanup", error);
  }
}

function validatePrefix(prefix: string): void {
  if (!prefix || prefix === "." || prefix === ".." || prefix.includes("/") || prefix.includes("\\")) {
    throw new Error("Frontend runtime snapshot prefix must be a non-empty path segment");
  }
}

async function copyFrontend(sourceRoot: string, destinationRoot: string): Promise<void> {
  await cp(sourceRoot, destinationRoot, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    force: false,
  });
}

async function removeFailedSnapshot(cleanupRoot: string, failure: unknown): Promise<never> {
  try {
    await rm(cleanupRoot, { recursive: true, force: true });
  } catch (cleanupFailure) {
    throw new AggregateError(
      [failure, cleanupFailure],
      `Frontend runtime snapshot failed and cleanup also failed: ${cleanupRoot}`,
    );
  }
  throw failure;
}

/**
 * Copies a validated frontend into a unique app-owned runtime snapshot.
 *
 * The caller owns the returned cleanup root and may remove it only after no
 * server is using the serving root. The source tree is never mutated.
 */
export async function createValidatedFrontendRuntimeSnapshot(
  options: CreateFrontendRuntimeSnapshotOptions,
): Promise<FrontendRuntimeSnapshot> {
  validatePrefix(options.prefix);
  const sourceRoot = resolve(options.sourceRoot);
  const runtimeParent = resolve(options.runtimeParent);

  await options.validate(sourceRoot, "source");
  await mkdir(runtimeParent, { recursive: true });

  const cleanupRoot = await mkdtemp(join(runtimeParent, options.prefix));
  const servingRoot = join(cleanupRoot, "dist");

  try {
    await (options.copier ?? copyFrontend)(sourceRoot, servingRoot);
    await options.validate(servingRoot, "snapshot");
    return { servingRoot, cleanupRoot };
  } catch (failure) {
    return await removeFailedSnapshot(cleanupRoot, failure);
  }
}
