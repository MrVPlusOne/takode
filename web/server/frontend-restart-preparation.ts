import { randomUUID } from "node:crypto";
import { link, lstat, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { normalizeTakodeBuildId, readTakodeBuildManifest } from "./build-identity.js";
import {
  createValidatedFrontendBuildCandidate,
  type CreateFrontendBuildCandidateOptions,
  type ValidatedFrontendBuildCandidate,
} from "./frontend-build-candidate.js";

export const COMPANION_FRONTEND_RUNTIME_ROOT_ENV = "COMPANION_FRONTEND_RUNTIME_ROOT";
export const FRONTEND_RESTART_HANDOFF_FILENAME = "frontend-restart-handoff.json";

const FRONTEND_RESTART_HANDOFF_VERSION = 1;
const FRONTEND_BUILD_CANDIDATE_PREFIX = "frontend-build-";
const MAX_HANDOFF_BYTES = 4 * 1024;

interface FrontendRestartHandoffRecord {
  version: typeof FRONTEND_RESTART_HANDOFF_VERSION;
  candidateName: string;
  buildId: string;
}

export interface PreparedFrontendRestart {
  frontendRoot: string;
  buildId: string;
  publish(): Promise<void>;
  discard(): Promise<void>;
}

export interface ProductionFrontendRestartController {
  prepare(): Promise<PreparedFrontendRestart>;
  cancelAndWait(reason?: unknown): Promise<void>;
}

export interface CreateProductionFrontendRestartPreparerOptions {
  webRoot: string;
  runtimeRoot: string;
  environment?: NodeJS.ProcessEnv;
  validate: (frontendRoot: string) => Promise<void>;
  buildCandidate?: (options: CreateFrontendBuildCandidateOptions) => Promise<ValidatedFrontendBuildCandidate>;
  publishHandoff?: (runtimeRoot: string, candidate: ValidatedFrontendBuildCandidate) => Promise<void>;
  removeCandidate?: (frontendRoot: string) => Promise<void>;
}

export interface ConsumeFrontendRestartHandoffOptions {
  runtimeRoot: string;
  validate: (frontendRoot: string) => Promise<void>;
}

function handoffPath(runtimeRoot: string): string {
  return join(resolve(runtimeRoot), FRONTEND_RESTART_HANDOFF_FILENAME);
}

function validateCandidateName(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith(FRONTEND_BUILD_CANDIDATE_PREFIX)) {
    throw new Error("Frontend restart handoff has an invalid candidate name");
  }
  if (basename(value) !== value || value === "." || value === "..") {
    throw new Error("Frontend restart handoff candidate must be a direct runtime child");
  }
  return value;
}

async function validateOwnedCandidate(runtimeRoot: string, frontendRoot: string): Promise<string> {
  const resolvedRuntimeRoot = resolve(runtimeRoot);
  const resolvedFrontendRoot = resolve(frontendRoot);
  const candidateName = validateCandidateName(basename(resolvedFrontendRoot));
  if (dirname(resolvedFrontendRoot) !== resolvedRuntimeRoot) {
    throw new Error("Frontend restart candidate is outside the supervised runtime root");
  }

  const [runtimeRealPath, candidateState] = await Promise.all([
    realpath(resolvedRuntimeRoot),
    lstat(resolvedFrontendRoot),
  ]);
  if (!candidateState.isDirectory() || candidateState.isSymbolicLink()) {
    throw new Error("Frontend restart candidate must be a real directory");
  }
  const candidateRealPath = await realpath(resolvedFrontendRoot);
  if (dirname(candidateRealPath) !== runtimeRealPath) {
    throw new Error("Frontend restart candidate resolves outside the supervised runtime root");
  }
  return candidateName;
}

function parseHandoff(source: string): FrontendRestartHandoffRecord {
  if (Buffer.byteLength(source, "utf-8") > MAX_HANDOFF_BYTES) {
    throw new Error("Frontend restart handoff is too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Frontend restart handoff is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Frontend restart handoff must be an object");
  }

  const record = parsed as { version?: unknown; candidateName?: unknown; buildId?: unknown };
  const buildId = normalizeTakodeBuildId(record.buildId);
  if (record.version !== FRONTEND_RESTART_HANDOFF_VERSION || !buildId) {
    throw new Error("Frontend restart handoff has an unsupported shape");
  }
  return {
    version: FRONTEND_RESTART_HANDOFF_VERSION,
    candidateName: validateCandidateName(record.candidateName),
    buildId,
  };
}

async function removeOwnedCandidate(frontendRoot: string): Promise<void> {
  await rm(frontendRoot, { recursive: true, force: true });
}

async function publishFrontendRestartHandoff(
  runtimeRoot: string,
  candidate: ValidatedFrontendBuildCandidate,
): Promise<void> {
  const resolvedRuntimeRoot = resolve(runtimeRoot);
  const candidateName = await validateOwnedCandidate(resolvedRuntimeRoot, candidate.frontendRoot);
  const buildId = normalizeTakodeBuildId(candidate.buildId);
  if (!buildId) throw new Error("Frontend restart candidate has an invalid build ID");

  const manifest = await readTakodeBuildManifest(candidate.frontendRoot);
  if (manifest.buildId !== buildId) {
    throw new Error("Frontend restart candidate manifest does not match its build ID");
  }

  const targetPath = handoffPath(resolvedRuntimeRoot);
  const temporaryPath = join(resolvedRuntimeRoot, `.${FRONTEND_RESTART_HANDOFF_FILENAME}.${randomUUID()}.tmp`);
  const record: FrontendRestartHandoffRecord = {
    version: FRONTEND_RESTART_HANDOFF_VERSION,
    candidateName,
    buildId,
  };

  try {
    await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, { encoding: "utf-8", flag: "wx", mode: 0o600 });
    // A same-directory hard link publishes the complete file atomically without
    // overwriting an earlier handoff from another request or process.
    await link(temporaryPath, targetPath);
  } catch (error) {
    const publicationError =
      (error as NodeJS.ErrnoException).code === "EEXIST"
        ? new Error("A frontend restart handoff is already pending")
        : error;
    try {
      await unlink(temporaryPath);
    } catch (cleanupError: unknown) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new AggregateError(
          [publicationError, cleanupError],
          "Frontend restart handoff publication and cleanup failed",
        );
      }
    }
    throw publicationError;
  }
  // The handoff link is already durable and complete; a leftover private temp
  // name is harmless and must not turn a successful publication into failure.
  await unlink(temporaryPath).catch(() => undefined);
}

/**
 * Owns production restart builds performed by the live backend process. Only one
 * candidate may exist at a time, and shutdown aborts and awaits its build before
 * the supervisor is allowed to remove the runtime root.
 */
export function createProductionFrontendRestartPreparer(
  options: CreateProductionFrontendRestartPreparerOptions,
): ProductionFrontendRestartController {
  if (!isAbsolute(options.runtimeRoot)) {
    throw new Error("Supervised frontend runtime root must be absolute");
  }
  const runtimeRoot = resolve(options.runtimeRoot);
  const webRoot = resolve(options.webRoot);
  const buildCandidate = options.buildCandidate ?? createValidatedFrontendBuildCandidate;
  const publishHandoff = options.publishHandoff ?? publishFrontendRestartHandoff;
  const removeCandidate = options.removeCandidate ?? removeOwnedCandidate;
  let shuttingDown = false;
  let inFlight: { controller: AbortController; promise: Promise<PreparedFrontendRestart> } | null = null;
  let heldCandidate: PreparedFrontendRestart | null = null;
  let candidateSettlement: Promise<void> | null = null;

  const prepare = (): Promise<PreparedFrontendRestart> => {
    if (shuttingDown) {
      return Promise.reject(new Error("Frontend restart preparation is shutting down"));
    }
    if (inFlight || heldCandidate) {
      return Promise.reject(new Error("A frontend restart candidate is already being prepared"));
    }

    const controller = new AbortController();
    const promise = (async (): Promise<PreparedFrontendRestart> => {
      const candidate = await buildCandidate({
        webRoot,
        runtimeRoot,
        environment: options.environment,
        signal: controller.signal,
        validate: options.validate,
      });
      await validateOwnedCandidate(runtimeRoot, candidate.frontendRoot);
      if (controller.signal.aborted) {
        await removeCandidate(candidate.frontendRoot);
        throw controller.signal.reason ?? new Error("Frontend restart preparation was aborted");
      }

      let state: "prepared" | "publishing" | "discarding" | "published" | "discarded" = "prepared";
      let prepared: PreparedFrontendRestart;
      const release = (): void => {
        if (heldCandidate === prepared) heldCandidate = null;
      };
      const trackSettlement = (operation: Promise<void>): Promise<void> => {
        candidateSettlement = operation;
        void operation.then(
          () => {
            if (candidateSettlement === operation) candidateSettlement = null;
          },
          () => {
            if (candidateSettlement === operation) candidateSettlement = null;
          },
        );
        return operation;
      };
      prepared = {
        ...candidate,
        publish(): Promise<void> {
          if (state !== "prepared") {
            return Promise.reject(new Error(`Frontend restart candidate cannot be published from ${state} state`));
          }
          state = "publishing";
          return trackSettlement(
            (async () => {
              try {
                await publishHandoff(runtimeRoot, candidate);
                state = "published";
                release();
              } catch (error) {
                state = "discarding";
                try {
                  await removeCandidate(candidate.frontendRoot);
                } catch (cleanupError) {
                  throw new AggregateError([error, cleanupError], "Frontend restart publication and cleanup failed");
                } finally {
                  // A failed cleanup may leave an unreferenced runtime child for
                  // supervisor cleanup, but it must not wedge future restarts.
                  state = "discarded";
                  release();
                }
                throw error;
              }
            })(),
          );
        },
        discard(): Promise<void> {
          if (state === "discarded") return Promise.resolve();
          if (state !== "prepared") {
            return Promise.reject(new Error(`Frontend restart candidate cannot be discarded from ${state} state`));
          }
          state = "discarding";
          return trackSettlement(
            removeCandidate(candidate.frontendRoot).finally(() => {
              // Cleanup errors are reported to the caller, but the abandoned
              // candidate is no longer eligible for publication.
              state = "discarded";
              release();
            }),
          );
        },
      };
      heldCandidate = prepared;
      return prepared;
    })();

    const active = { controller, promise };
    inFlight = active;
    void promise.then(
      () => {
        if (inFlight === active) inFlight = null;
      },
      () => {
        if (inFlight === active) inFlight = null;
      },
    );
    return promise;
  };

  return {
    prepare,
    async cancelAndWait(reason: unknown = new Error("Server is shutting down")): Promise<void> {
      shuttingDown = true;
      const active = inFlight;
      if (active) {
        active.controller.abort(reason);
        await active.promise.catch(() => undefined);
      }
      if (candidateSettlement) {
        await candidateSettlement.catch(() => undefined);
      }
      if (heldCandidate) {
        await heldCandidate.discard();
      }
    },
  };
}

/** Atomically claims and validates the candidate prepared by the exiting server. */
export async function consumeFrontendRestartHandoff(
  options: ConsumeFrontendRestartHandoffOptions,
): Promise<ValidatedFrontendBuildCandidate> {
  if (!isAbsolute(options.runtimeRoot)) {
    throw new Error("Supervised frontend runtime root must be absolute");
  }
  const runtimeRoot = resolve(options.runtimeRoot);
  const sourcePath = handoffPath(runtimeRoot);
  const claimedPath = join(runtimeRoot, `.${FRONTEND_RESTART_HANDOFF_FILENAME}.${randomUUID()}.claimed`);

  await rename(sourcePath, claimedPath);
  try {
    const record = parseHandoff(await readFile(claimedPath, "utf-8"));
    const frontendRoot = join(runtimeRoot, record.candidateName);
    await validateOwnedCandidate(runtimeRoot, frontendRoot);
    const manifest = await readTakodeBuildManifest(frontendRoot);
    if (manifest.buildId !== record.buildId) {
      throw new Error("Prepared frontend manifest does not match the restart handoff");
    }
    await options.validate(frontendRoot);
    return { frontendRoot, buildId: record.buildId };
  } finally {
    await unlink(claimedPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
