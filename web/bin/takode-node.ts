#!/usr/bin/env bun
/**
 * `takode node`: run Takode sessions on this machine for a coordinator elsewhere.
 *
 * The helper dials out to the coordinator (no inbound ports on this machine),
 * runs the session processes the coordinator asks for, buffers their output
 * across link drops, and serves the coordinator's API on a loopback port so
 * agent CLIs here work unchanged.
 *
 * Usage:
 *   takode-node --coordinator <url> (--token-file <path> | TAKODE_HOST_TOKEN=...) [--api-port <n>] [--claude <path>] [--codex <path>] [--allow-insecure]
 *
 * Register the host on the coordinator first (POST /api/hosts) to obtain its token.
 */
import { readFile } from "node:fs/promises";
import { HostAgent, insecureCoordinatorUrlProblem, startApiProxy } from "../server/remote-host/host-agent.js";

const args = process.argv.slice(2);

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
    console.log(
      "Usage: takode-node --coordinator <url> (--token-file <path> | TAKODE_HOST_TOKEN=...) [--api-port <n>] [--claude <path>] [--codex <path>] [--allow-insecure]",
    );
    return;
  }
  const coordinatorUrl = option("coordinator") ?? process.env.TAKODE_COORDINATOR_URL;
  if (!coordinatorUrl) fail("--coordinator <url> (or TAKODE_COORDINATOR_URL) is required");
  const urlProblem = insecureCoordinatorUrlProblem(coordinatorUrl, args.includes("--allow-insecure"));
  if (urlProblem) fail(urlProblem);
  const tokenFile = option("token-file");
  const token = (tokenFile ? await readFile(tokenFile, "utf-8") : process.env.TAKODE_HOST_TOKEN)?.trim();
  if (!token) fail("A host token is required: --token-file <path> or TAKODE_HOST_TOKEN");
  const apiPort = Number(option("api-port") ?? 0);
  if (!Number.isInteger(apiPort) || apiPort < 0 || apiPort > 65_535) fail("--api-port must be a port number");
  // Programs the coordinator names by role; each host may point them at its own installation.
  const commands: Record<string, string> = {};
  const claude = option("claude");
  const codex = option("codex");
  if (claude) commands.claude = claude;
  if (codex) commands.codex = codex;

  const proxy = startApiProxy({ coordinatorUrl, port: apiPort });
  const agent = new HostAgent({
    coordinatorUrl,
    token,
    apiProxyPort: proxy.port,
    commands,
  });
  agent.start();
  console.log(`[takode node] Serving the coordinator API on 127.0.0.1:${proxy.port}; connecting to ${coordinatorUrl}`);

  const shutdown = () => {
    agent.stop();
    proxy.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
