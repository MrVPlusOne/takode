#!/usr/bin/env bun
/**
 * Production server wrapper with restart support.
 *
 * Builds each frontend into a fresh runtime snapshot, then starts the server
 * against that immutable directory. Source-checkout `web/dist` cleanup or an
 * interrupted later build therefore cannot remove the frontend currently being
 * served. Restart builds complete while the current pair remains live; a failed
 * preparation leaves that pair untouched.
 *
 * Usage: bun serve.ts          (or: bun run serve)
 */
import { spawn } from "bun";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TAKODE_BUILD_ID_ENV } from "./server/build-identity.js";
import { checkFrontendAvailability } from "./server/frontend-availability.js";
import {
  createValidatedFrontendBuildCandidate,
  type ValidatedFrontendBuildCandidate,
} from "./server/frontend-build-candidate.js";
import {
  COMPANION_FRONTEND_RUNTIME_ROOT_ENV,
  consumeFrontendRestartHandoff,
} from "./server/frontend-restart-preparation.js";
import { DEPENDENCY_INSTALL_COMMAND, findOutdatedDependencies } from "./server/backend-startup-check.js";
import { DEFAULT_PORT_PROD, RESTART_EXIT_CODE } from "./server/constants.js";
import { appendServerLogEntry } from "./server/server-logger.js";
import { waitForBackendShutdown } from "./server/supervised-backend-shutdown.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(__dirname);
const bunExec = process.execPath;
const autoInstall = process.env.TAKODE_AUTO_INSTALL === "1";
const port = Number(process.env.PORT) || DEFAULT_PORT_PROD;

let shuttingDown = false;
let serverProc: ReturnType<typeof spawn> | null = null;
let installProc: ReturnType<typeof spawn> | null = null;
let buildAbortController: AbortController | null = null;
let buildOperation: Promise<ValidatedFrontendBuildCandidate> | null = null;
let runtimeRoot: string | null = null;
let shutdownOperation: Promise<never> | null = null;

// The backend may need its own 5s grace window to terminate an in-flight Vite
// child before it can finish shutdown, so the supervisor must wait longer.
const CHILD_TERMINATION_GRACE_MS = 15_000;
const STDERR_TAIL_CHARS = 8_000;
// A crashed backend's grandchildren may still hold its stderr pipe open, so the
// exit record waits only briefly for trailing output.
const STDERR_DRAIN_MS = 1_000;

async function ensureDependencies(): Promise<boolean> {
  if (shuttingDown) return false;
  const outdated = await findOutdatedDependencies(webDir);
  if (outdated.length === 0) return true;

  if (!autoInstall) {
    console.error(
      [
        "\x1b[31m[serve] Local web dependencies are out of date.\x1b[0m",
        ...outdated.map((problem) => `  ${problem}`),
        "",
        "Run from the repository root:",
        `  ${DEPENDENCY_INSTALL_COMMAND}`,
        "",
        "Or opt into explicit frozen auto-install:",
        "  cd web && TAKODE_AUTO_INSTALL=1 bun --no-install run serve",
      ].join("\n"),
    );
    return false;
  }

  console.log("\x1b[36m[serve] Installing dependencies with frozen lockfile...\x1b[0m");
  const install = spawn([bunExec, "install", "--frozen-lockfile"], {
    cwd: webDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  installProc = install;
  try {
    const code = await install.exited;
    if (shuttingDown) return false;
    if (code !== 0) {
      console.error(`\x1b[31m[serve] Install failed (exit ${code})\x1b[0m`);
      return false;
    }
    return true;
  } finally {
    if (installProc === install) installProc = null;
  }
}

async function buildFrontendSnapshot(): Promise<ValidatedFrontendBuildCandidate | null> {
  if (!(await ensureDependencies())) return null;
  if (shuttingDown) return null;
  if (!runtimeRoot) throw new Error("Frontend runtime root is not initialized");

  console.log("\x1b[36m[serve] Building isolated frontend snapshot...\x1b[0m");
  const abortController = new AbortController();
  buildAbortController = abortController;
  const operation = createValidatedFrontendBuildCandidate({
    webRoot: webDir,
    runtimeRoot,
    signal: abortController.signal,
    validate: async (frontendRoot) => {
      const availability = await checkFrontendAvailability({ required: true, frontendRoot });
      if (!availability.ready) {
        throw new Error(`Frontend candidate is not ready (${availability.reason})`);
      }
    },
  });
  buildOperation = operation;
  try {
    const candidateDir = await operation;
    console.log("\x1b[32m[serve] Frontend snapshot ready\x1b[0m");
    return candidateDir;
  } catch (error) {
    if (!shuttingDown) {
      console.error(
        `\x1b[31m[serve] Frontend build failed: ${error instanceof Error ? error.message : String(error)}\x1b[0m`,
      );
    }
    return null;
  } finally {
    if (buildAbortController === abortController) buildAbortController = null;
    if (buildOperation === operation) buildOperation = null;
  }
}

/** Forwards the backend's stderr unchanged while keeping its tail for the exit record. */
function forwardStderr(stream: ReadableStream<Uint8Array>): { tail: string; done: Promise<void> } {
  const state = { tail: "", done: Promise.resolve() };
  const decoder = new TextDecoder();
  state.done = (async () => {
    for await (const chunk of stream) {
      process.stderr.write(chunk);
      state.tail = (state.tail + decoder.decode(chunk, { stream: true })).slice(-STDERR_TAIL_CHARS);
    }
  })().catch((error) => console.error("[serve] Lost backend stderr:", error));
  return state;
}

/** Records an unexpected backend exit in the server log, where it survives the supervisor and the terminal. */
async function recordBackendExit(code: number | null, stderr: { tail: string; done: Promise<void> }): Promise<void> {
  await Promise.race([stderr.done, new Promise((resolvePromise) => setTimeout(resolvePromise, STDERR_DRAIN_MS))]);
  await appendServerLogEntry(port, {
    level: "error",
    component: "supervisor",
    message: `Backend exited with code ${code}; the production supervisor is stopping`,
    meta: { exitCode: code, stderrTail: stderr.tail },
  }).catch((error) => console.error("[serve] Failed to record the backend exit in the server log:", error));
}

async function removeRuntimeRoot(): Promise<void> {
  if (!runtimeRoot) return;
  const root = runtimeRoot;
  runtimeRoot = null;
  await rm(root, { recursive: true, force: true }).catch((error) => {
    console.error(`[serve] Failed to remove runtime frontend snapshots at ${root}:`, error);
  });
}

async function waitForExitOrTimeout(exited: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs);
    void exited.then(
      () => {
        clearTimeout(timer);
        resolvePromise(true);
      },
      () => {
        clearTimeout(timer);
        resolvePromise(true);
      },
    );
  });
}

async function terminateBunChild(child: ReturnType<typeof spawn>): Promise<void> {
  const exited = child.exited.catch(() => undefined);
  child.kill("SIGTERM");
  if (!(await waitForExitOrTimeout(exited, CHILD_TERMINATION_GRACE_MS))) {
    child.kill("SIGKILL");
  }
  await exited;
}

function requestShutdown(code: number): Promise<never> {
  if (shutdownOperation) return shutdownOperation;
  shuttingDown = true;
  shutdownOperation = (async (): Promise<never> => {
    const activeServer = serverProc;
    const activeInstall = installProc;
    const activeBuild = buildOperation;
    buildAbortController?.abort(new Error("Production server wrapper is shutting down"));

    await Promise.all([
      activeServer
        ? waitForBackendShutdown(activeServer, (message) => console.warn(`[serve] ${message}`))
        : Promise.resolve(),
      activeInstall ? terminateBunChild(activeInstall) : Promise.resolve(),
      activeBuild?.catch(() => undefined) ?? Promise.resolve(),
    ]);
    await removeRuntimeRoot();
    process.exit(code);
  })();
  return shutdownOperation;
}

async function run(): Promise<void> {
  const portLabel = (process.env.PORT || "default").replace(/[^a-zA-Z0-9_-]/g, "-");
  const runtimeParent = resolve(
    process.env.COMPANION_FRONTEND_RUNTIME_DIR?.trim() || join(homedir(), ".companion", "runtime", "frontends"),
  );
  await mkdir(runtimeParent, { recursive: true });
  runtimeRoot = await mkdtemp(join(runtimeParent, `serve-${portLabel}-`));
  const supervisedRuntimeRoot = runtimeRoot;

  let activeFrontend = await buildFrontendSnapshot();
  if (!activeFrontend) {
    if (shuttingDown) return;
    await requestShutdown(1);
  }

  while (true) {
    if (shuttingDown) return;
    console.log("\x1b[36m[serve] Starting server with validated frontend snapshot...\x1b[0m");
    const proc = spawn([bunExec, "--no-install", "server/index.ts"], {
      cwd: webDir,
      stdout: "inherit",
      stderr: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        COMPANION_SUPERVISED: "1",
        COMPANION_FRONTEND_ROOT: activeFrontend.frontendRoot,
        [COMPANION_FRONTEND_RUNTIME_ROOT_ENV]: supervisedRuntimeRoot,
        [TAKODE_BUILD_ID_ENV]: activeFrontend.buildId,
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "32",
      },
    });
    serverProc = proc;
    const stderr = forwardStderr(proc.stderr);
    const code = await proc.exited;
    serverProc = null;

    if (shuttingDown) return;

    // There is no previous backend to fall back to, and restarting the same
    // code would only repeat the failure, so an unexpected exit stops the
    // supervisor after recording why.
    if (code !== RESTART_EXIT_CODE) {
      console.log(`\x1b[31m[serve] Server exited with code ${code}, stopping.\x1b[0m`);
      await recordBackendExit(code, stderr);
      await requestShutdown(code ?? 1);
    }

    console.log("\x1b[33m[serve] Server requested restart, consuming its prepared frontend snapshot...\x1b[0m");

    // The live server builds and validates this candidate before it exits. A
    // missing or invalid handoff must fail closed: launching current backend
    // code against the previous frontend would create an unsupported pair.
    let nextFrontend: ValidatedFrontendBuildCandidate;
    try {
      nextFrontend = await consumeFrontendRestartHandoff({
        runtimeRoot: supervisedRuntimeRoot,
        validate: async (frontendRoot) => {
          const availability = await checkFrontendAvailability({ required: true, frontendRoot });
          if (!availability.ready) {
            throw new Error(`Prepared frontend is not ready (${availability.reason})`);
          }
        },
      });
    } catch (error) {
      console.error(
        `\x1b[31m[serve] Prepared frontend handoff failed: ${error instanceof Error ? error.message : String(error)}\x1b[0m`,
      );
      await requestShutdown(1);
    }

    const previousFrontendRoot = activeFrontend.frontendRoot;
    activeFrontend = nextFrontend;
    await rm(previousFrontendRoot, { recursive: true, force: true }).catch((error) => {
      console.error(`[serve] Failed to remove retired frontend snapshot at ${previousFrontendRoot}:`, error);
    });

    // Brief pause to let the port be released.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
}

process.on("SIGINT", () => void requestShutdown(0));
process.on("SIGTERM", () => void requestShutdown(0));

void run().catch(async (error) => {
  if (shuttingDown) return;
  console.error("[serve] Fatal error:", error);
  await requestShutdown(1);
});
