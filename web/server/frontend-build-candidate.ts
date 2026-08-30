import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateTakodeBuildId, normalizeTakodeBuildId, readTakodeBuildManifest } from "./build-identity.js";

const DEFAULT_TERMINATION_GRACE_MS = 5_000;

export interface FrontendBuildInvocation {
  executable: string;
  args: string[];
  cwd: string;
  candidateDir: string;
  signal?: AbortSignal;
  environment: NodeJS.ProcessEnv;
}

export type FrontendBuildRunner = (invocation: FrontendBuildInvocation) => Promise<number>;
export type FrontendBuildCandidateValidator = (candidateDir: string) => Promise<void>;

export interface CreateFrontendBuildCandidateOptions {
  webRoot: string;
  runtimeRoot: string;
  validate: FrontendBuildCandidateValidator;
  runner?: FrontendBuildRunner;
  signal?: AbortSignal;
  /** Opaque ID shared by this Vite output and the backend process that will serve it. */
  buildId?: string;
  /** Base environment for the Vite child. The caller object is never mutated. */
  environment?: NodeJS.ProcessEnv;
}

export interface ValidatedFrontendBuildCandidate {
  frontendRoot: string;
  buildId: string;
}

function abortFailure(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("Frontend build aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortFailure(signal);
}

/**
 * Runs Vite and, when aborted, does not settle until the owned child has exited.
 * SIGTERM gets a short grace period before SIGKILL escalation so shutdown cannot
 * leave a build writing into a runtime directory that its caller is removing.
 */
async function runFrontendBuild(invocation: FrontendBuildInvocation): Promise<number> {
  throwIfAborted(invocation.signal);

  return await new Promise<number>((resolvePromise, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      stdio: "inherit",
      env: invocation.environment,
    });
    let settled = false;
    let aborted = false;
    let escalationTimer: ReturnType<typeof setTimeout> | undefined;

    const clearAbortState = (): void => {
      if (escalationTimer) clearTimeout(escalationTimer);
      invocation.signal?.removeEventListener("abort", abortBuild);
    };
    const finish = (result: { code: number } | { failure: unknown }): void => {
      if (settled) return;
      settled = true;
      clearAbortState();
      if ("code" in result) resolvePromise(result.code);
      else reject(result.failure);
    };
    const abortBuild = (): void => {
      if (settled || aborted) return;
      aborted = true;
      child.kill("SIGTERM");
      escalationTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, DEFAULT_TERMINATION_GRACE_MS);
      escalationTimer.unref?.();
    };

    child.once("error", (error) => {
      // A spawn error means there is no writer to await. A termination error can arrive while the child is still live,
      // so keep waiting for close (and the SIGKILL escalation) rather than letting caller cleanup race the child.
      if (!aborted) finish({ failure: error });
    });
    child.once("close", (code, signal) => {
      if (aborted && invocation.signal) {
        finish({ failure: abortFailure(invocation.signal) });
        return;
      }
      if (code !== null) {
        finish({ code });
        return;
      }
      finish({ failure: new Error(`Frontend build terminated by signal ${signal ?? "unknown"}`) });
    });

    if (invocation.signal?.aborted) abortBuild();
    else invocation.signal?.addEventListener("abort", abortBuild, { once: true });
  });
}

async function removeFailedCandidate(candidateDir: string, failure: unknown): Promise<never> {
  try {
    await rm(candidateDir, { recursive: true, force: true });
  } catch (cleanupFailure) {
    throw new AggregateError(
      [failure, cleanupFailure],
      `Frontend build failed and candidate cleanup also failed: ${candidateDir}`,
    );
  }
  throw failure;
}

/**
 * Builds a production frontend into a fresh caller-owned runtime directory.
 *
 * The returned directory has passed the caller's validator and remains owned by
 * the caller. Failed candidates are removed without reading or mutating any
 * currently active frontend directory. A custom runner must honor the supplied
 * signal and settle only after any child it owns has exited.
 */
export async function createValidatedFrontendBuildCandidate(
  options: CreateFrontendBuildCandidateOptions,
): Promise<ValidatedFrontendBuildCandidate> {
  const requestedBuildId = options.buildId;
  const buildId = requestedBuildId === undefined ? generateTakodeBuildId() : normalizeTakodeBuildId(requestedBuildId);
  if (!buildId) throw new Error("Invalid Takode frontend build ID");

  const webRoot = resolve(options.webRoot);
  const runtimeRoot = resolve(options.runtimeRoot);
  throwIfAborted(options.signal);
  await mkdir(runtimeRoot, { recursive: true });
  throwIfAborted(options.signal);
  const candidateDir = await mkdtemp(join(runtimeRoot, "frontend-build-"));

  const invocation: FrontendBuildInvocation = {
    executable: resolve(webRoot, "node_modules", ".bin", "vite"),
    args: ["build", "--outDir", candidateDir, "--emptyOutDir"],
    cwd: webRoot,
    candidateDir,
    signal: options.signal,
    environment: {
      ...(options.environment ?? process.env),
      TAKODE_BUILD_ID: buildId,
    },
  };

  try {
    throwIfAborted(options.signal);
    const exitCode = await (options.runner ?? runFrontendBuild)(invocation);
    throwIfAborted(options.signal);
    if (exitCode !== 0) {
      throw new Error(`Frontend build exited with code ${exitCode}`);
    }
    const manifest = await readTakodeBuildManifest(candidateDir);
    if (manifest.buildId !== buildId) {
      throw new Error("Frontend build manifest ID does not match the requested build ID");
    }
    await options.validate(candidateDir);
    throwIfAborted(options.signal);
    return { frontendRoot: candidateDir, buildId };
  } catch (failure) {
    return await removeFailedCandidate(candidateDir, failure);
  }
}
