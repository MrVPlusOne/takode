#!/usr/bin/env bun
/**
 * `takode node`: run Takode sessions on this machine for a coordinator elsewhere.
 *
 * The helper dials out to the coordinator (no inbound ports on this machine),
 * runs the session processes the coordinator asks for, buffers their output
 * across link drops and coordinator restarts, and serves the coordinator's API
 * on a loopback port so agent CLIs here work unchanged.
 *
 * Usage:
 *   takode-node --coordinator <url> (--token-file <path> | TAKODE_HOST_TOKEN=...) [--api-port <n>] [--claude <path>] [--codex <path>] [--allow-insecure] [--auto-update] [--shared-checkout]
 *
 * It reports the Git commit of this machine's Takode checkout, so the
 * coordinator can show hosts that run another build. With `--auto-update`, the
 * coordinator also switches the checkout to its own commit when none of this
 * host's sessions is in a turn: the node checks out that commit (fetching it
 * if needed, and never over uncommitted changes), runs a frozen install and
 * restarts, which ends its session processes; their sessions relaunch.
 *
 * `--shared-checkout` is how a coordinator starts its own machine's node (see
 * `local-node.ts`): the node runs from the coordinator's checkout, so it leaves
 * installing the agent CLI wrappers and skills to the coordinator, and an
 * update restarts it on that checkout's current code instead of switching the
 * checkout; the coordinator starts it again.
 *
 * Which Claude Code and Codex programs it runs comes from this host's settings
 * on the coordinator (Settings > Hosts). `--claude` and `--codex` override
 * them for this node.
 *
 * Before connecting it installs the agent CLI wrappers, skills and Quest
 * Journey phase briefs from this machine's Takode checkout, as the server does
 * at startup.
 *
 * Register the host on the coordinator first (`takode host add <name>`) to obtain its token.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parentClaudeSessionWarning } from "../server/cli-launcher-env.js";
import { HostAgent, insecureCoordinatorUrlProblem, startApiProxy } from "../server/remote-host/host-agent.js";
import { readMachineName, saveMachineName } from "../server/machine-identity.js";
import {
  NODE_RESTART_EXIT_CODE,
  readCheckoutCommit,
  switchCheckoutToCommit,
} from "../server/remote-host/host-update.js";
import { ensureBuiltInQuestJourneyPhaseData } from "../server/quest-journey-phases.js";
import { ensureQuestmasterIntegration } from "../server/quest-integration.js";
import { ensureSkillSymlinks } from "../server/skill-symlink.js";
import { ensureTakodeIntegration } from "../server/takode-integration.js";
import { setLandingRunnerApiPort } from "../server/landing-runner-launcher.js";
import { runPreListenStartupReadiness, STARTUP_SKILL_SYMLINKS } from "../server/startup-readiness.js";

const args = process.argv.slice(2);
const USAGE =
  "Usage: takode-node --coordinator <url> (--token-file <path> | TAKODE_HOST_TOKEN=...) [--api-port <n>] [--claude <path>] [--codex <path>] [--allow-insecure] [--auto-update] [--shared-checkout]";
/** Set in the worker process an auto-updating node runs, so it does not supervise itself again. */
const SUPERVISED_ENV = "TAKODE_NODE_SUPERVISED";

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const autoUpdate = args.includes("--auto-update");
  if (autoUpdate && !process.env[SUPERVISED_ENV]) return supervise();
  const parentSessionWarning = parentClaudeSessionWarning(process.env);
  if (parentSessionWarning) console.warn(`[takode node] ${parentSessionWarning}`);
  const coordinatorUrl = option("coordinator") ?? process.env.TAKODE_COORDINATOR_URL;
  if (!coordinatorUrl) fail("--coordinator <url> (or TAKODE_COORDINATOR_URL) is required");
  const urlProblem = insecureCoordinatorUrlProblem(coordinatorUrl, args.includes("--allow-insecure"));
  if (urlProblem) fail(urlProblem);
  const tokenFile = option("token-file");
  const token = (tokenFile ? await readFile(tokenFile, "utf-8") : process.env.TAKODE_HOST_TOKEN)?.trim();
  if (!token) fail("A host token is required: --token-file <path> or TAKODE_HOST_TOKEN");
  const apiPort = Number(option("api-port") ?? 0);
  if (!Number.isInteger(apiPort) || apiPort < 0 || apiPort > 65_535) fail("--api-port must be a port number");
  // Per-node overrides of the Claude/Codex programs this machine's settings on the coordinator name.
  const commands: { claude?: string; codex?: string } = {};
  const claude = option("claude");
  const codex = option("codex");
  if (claude) commands.claude = claude;
  if (codex) commands.codex = codex;

  const sharedCheckout = args.includes("--shared-checkout");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let agent: HostAgent | null = null;
  // Agent CLIs wait while the coordinator is away (e.g. restarting) instead of failing.
  const proxy = startApiProxy({ coordinatorUrl, port: apiPort, coordinatorConnected: () => agent?.connected ?? false });
  // Landing runners the coordinator starts here reach it through the same proxy.
  setLandingRunnerApiPort(proxy.port);
  // Agents here need the same CLI wrappers, skills and phase briefs as on the
  // coordinator, installed from this machine's own Takode checkout.
  if (!sharedCheckout) {
    await runPreListenStartupReadiness(
      {
        ensureQuestmasterIntegration,
        ensureTakodeIntegration,
        ensureBuiltInQuestJourneyPhaseData,
        ensureSkillSymlinks,
      },
      { port: proxy.port, packageRoot, startupSkillSlugs: STARTUP_SKILL_SYMLINKS },
    );
  }
  const build = await readCheckoutCommit(packageRoot);
  const restart = () => {
    agent?.stop();
    proxy.stop();
    process.exit(NODE_RESTART_EXIT_CODE);
  };
  agent = new HostAgent({
    coordinatorUrl,
    token,
    apiProxyPort: proxy.port,
    commands,
    build,
    machineName: await readMachineName(),
    saveMachineName: (name) => saveMachineName(name),
    ...(sharedCheckout
      ? {
          update: async () => {
            const current = await readCheckoutCommit(packageRoot);
            if (current === build) {
              throw new Error("It already runs the checkout's current code; restart the server to match it");
            }
            console.log(`[takode node] Restarting to run ${current ?? "the checkout's current code"}`);
            restart();
          },
        }
      : autoUpdate
        ? {
            update: async (commit: string) => {
              await switchCheckoutToCommit(packageRoot, commit);
              console.log(`[takode node] Switched to ${commit}; restarting`);
              restart();
            },
          }
        : {}),
  });
  agent.start();
  console.log(
    `[takode node] Serving the coordinator API on 127.0.0.1:${proxy.port}; connecting to ${coordinatorUrl}` +
      ` (Takode ${build ?? "build unknown"}${autoUpdate || sharedCheckout ? ", auto-update on" : ""})`,
  );

  const shutdown = () => {
    agent?.stop();
    proxy.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Run the node as a child process and start it again whenever it exits to
 * apply an update, so the new checkout's code is loaded. Any other exit ends
 * the supervisor with the same code.
 */
async function supervise(): Promise<void> {
  const script = fileURLToPath(import.meta.url);
  let child: ReturnType<typeof spawn> | null = null;
  // Ctrl-C reaches the child directly; a signal sent only to this process is passed on.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => child?.kill("SIGTERM"));
  for (;;) {
    child = spawn(process.execPath, [script, ...args], {
      stdio: "inherit",
      env: { ...process.env, [SUPERVISED_ENV]: "1" },
    });
    const code = await new Promise<number>((done) => {
      child!.once("error", (error) => {
        console.error(`[takode node] Could not start: ${error.message}`);
        done(1);
      });
      child!.once("exit", (exitCode, signal) => done(exitCode ?? (signal ? 1 : 0)));
    });
    if (code !== NODE_RESTART_EXIT_CODE) process.exit(code);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
