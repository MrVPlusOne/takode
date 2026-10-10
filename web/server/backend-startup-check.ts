import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEPENDENCY_INSTALL_COMMAND = "bun install --cwd web --frozen-lockfile";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
const MAX_REPORTED_OUTPUT_CHARS = 2_000;
const DEPENDENCY_INSTALL_TIMEOUT_MS = 5 * 60_000;

/**
 * Lists direct dependencies and devDependencies of `webRoot/package.json` that
 * are missing from `webRoot/node_modules` or installed at a different version
 * than their exact pin. Non-exact specs are only checked for presence.
 */
export async function findOutdatedDependencies(webRoot: string): Promise<string[]> {
  const manifest = JSON.parse(await readFile(join(webRoot, "package.json"), "utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const pins = { ...manifest.dependencies, ...manifest.devDependencies };
  const problems = await Promise.all(
    Object.entries(pins).map(async ([name, spec]) => {
      const installed = await readInstalledVersion(webRoot, name);
      if (installed === null) return `${name} is not installed`;
      if (EXACT_VERSION.test(spec) && installed !== spec) return `${name} is ${installed}, expected ${spec}`;
      return null;
    }),
  );
  return problems.filter((problem): problem is string => problem !== null);
}

/**
 * Verifies, without starting a server, that the backend code now on disk can
 * load with the installed dependencies: direct dependencies must match
 * package.json, and Bun must resolve the backend's whole static import graph.
 * Throws an actionable error otherwise. Restart runs this while the current
 * server is still live, because there is no previous backend to fall back to.
 */
export async function checkBackendStartup(webRoot: string): Promise<void> {
  const outdated = await findOutdatedDependencies(webRoot);
  if (outdated.length > 0) {
    throw new Error(
      `Dependencies are out of date (${outdated.join("; ")}). Run \`${DEPENDENCY_INSTALL_COMMAND}\`, then restart again.`,
    );
  }
  const importFailure = await resolveBackendImports(webRoot);
  if (importFailure) throw new Error(`The backend code on disk cannot load:\n${importFailure}`);
}

/**
 * Installs `webRoot`'s dependencies exactly as its lockfile pins them, the
 * same as {@link DEPENDENCY_INSTALL_COMMAND}. A no-op install takes a few
 * milliseconds. Throws with the end of the install's output when it fails.
 */
export function installDependencies(webRoot: string, timeoutMs = DEPENDENCY_INSTALL_TIMEOUT_MS): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["install", "--frozen-lockfile"], {
      cwd: webRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: string) => {
      output = (output + chunk).slice(-MAX_REPORTED_OUTPUT_CHARS);
    };
    child.stdout.setEncoding("utf-8").on("data", collect);
    child.stderr.setEncoding("utf-8").on("data", collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      // Once stopped, the install counts as failed even if it finished meanwhile.
      if (timedOut) reject(new Error(`${output.trim()}\nStopped after ${Math.round(timeoutMs / 1000)} s.`.trim()));
      else if (code === 0) resolvePromise();
      else reject(new Error(output.trim() || `bun install exited with ${code ?? signal}`));
    });
  });
}

async function readInstalledVersion(webRoot: string, name: string): Promise<string | null> {
  try {
    const installed = JSON.parse(await readFile(join(webRoot, "node_modules", name, "package.json"), "utf-8"));
    return typeof installed.version === "string" ? installed.version : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Bundles the backend entry in a child process, discarding the output. Bundling
 * resolves every static import (packages included) and parses every module
 * without executing any of them. Returns the failure output, or null on success.
 */
function resolveBackendImports(webRoot: string): Promise<string | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["build", "server/index.ts", "--target=bun"], {
      cwd: webRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let output = "";
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => {
      output = (output + chunk).slice(-MAX_REPORTED_OUTPUT_CHARS);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolvePromise(null);
      else resolvePromise(output.trim() || `bun build exited with ${code ?? signal}`);
    });
  });
}
