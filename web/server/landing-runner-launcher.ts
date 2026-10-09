import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LandingTarget } from "../shared/landing-queue.js";
import { REMOTE_HOST_ENV } from "../shared/remote-host-env.js";
import { getEnrichedPath } from "./path-resolver.js";

/** The Takode CLI of the code this process runs, so a runner matches its machine's build. */
const TAKODE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "takode.ts");

let apiPort: number | undefined;

/**
 * The port runners on this machine reach the Takode API on: the server's own
 * port on the coordinator, the node's API proxy on a host.
 */
export function setLandingRunnerApiPort(port: number): void {
  apiPort = port;
}

export interface StartLandingRunnerInput {
  launchId: string;
  target: LandingTarget;
  baseCheckout: string;
  /** The runner's credentials. */
  sessionId: string;
  token: string;
}

/**
 * Start a landing runner (`takode land run --foreground`) in the background on
 * this machine, with the runner's own credentials and a log under
 * ~/.companion/landing/logs. Resolves once the process has spawned; `onExit`
 * (only for runners started by the coordinator itself) hears when it ends.
 */
export async function startLandingRunner(
  input: StartLandingRunnerInput,
  options: { onExit?: (detail: string) => void; forRemoteCoordinator?: boolean } = {},
): Promise<{ pid?: number; logPath: string }> {
  if (!apiPort) throw new Error("this machine has no Takode API port configured for landing runners");
  await access(join(input.baseCheckout, ".git")).catch(() => {
    throw new Error(`there is no Git checkout at ${input.baseCheckout} on this machine`);
  });
  const logDir = join(homedir(), ".companion", "landing", "logs");
  await mkdir(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const branch = input.target.branch.replace(/[^A-Za-z0-9._-]/g, "_");
  const logPath = join(logDir, `${stamp}-${input.target.repo}-${branch}-${input.launchId}.log`);
  const log = await open(logPath, "a");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: getEnrichedPath(),
    COMPANION_PORT: String(apiPort),
    COMPANION_SESSION_ID: input.sessionId,
    COMPANION_AUTH_TOKEN: input.token,
  };
  // The CLI prefers an orchestrator port over COMPANION_PORT; a runner must use the one set here.
  delete env.TAKODE_API_PORT;
  // Like every process a node starts for a coordinator on another machine, it must not answer from local files.
  if (options.forRemoteCoordinator) env[REMOTE_HOST_ENV] = "1";
  try {
    const child = spawn(
      process.execPath,
      [TAKODE_CLI, "land", "run", "--foreground", "--branch", input.target.branch, "--log", logPath],
      { cwd: input.baseCheckout, detached: true, stdio: ["ignore", log.fd, log.fd], env },
    );
    await Promise.race([
      once(child, "spawn"),
      once(child, "error").then(([error]) => {
        throw error;
      }),
    ]);
    child.once("exit", (code, signal) => options.onExit?.(signal ? `signal ${signal}` : `exit code ${code}`));
    child.unref();
    return { ...(child.pid ? { pid: child.pid } : {}), logPath };
  } finally {
    await log.close();
  }
}
