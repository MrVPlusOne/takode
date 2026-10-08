#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import {
  isMemoryServerCommand,
  memoryCommandInputFile,
  runMemoryCommand,
  splitMemoryCommand,
  type MemoryCommandResult,
} from "../server/memory-command.js";
import { getServerSlug, initWithPort } from "../server/settings-manager.js";
import { COMPANION_MEMORY_SPACE_SLUG_ENV } from "../server/memory-session-space.js";
import {
  MEMORY_SERVER_COMMAND_TIMEOUT_MS,
  type MemoryServerCommandRequest,
} from "../shared/memory-command-transport.js";
import { getCodexQuestInvocationContext } from "./quest-codex-invocation.js";
import { resolveTakodeSidecarConnection } from "./takode-sidecar-client.js";
import { trackCliLatency } from "./cli-latency.js";

const args = process.argv.slice(2);
const { command, rest } = splitMemoryCommand(args);
trackCliLatency("memory", command, rest);

/**
 * Commands run on the Takode server that owns the repo, so they work the same
 * on machines without a copy of it. Reading commands fall back to the local
 * repo when no server is named or reachable; writing commands never do.
 */
async function main(): Promise<void> {
  const origin = await serverOrigin();
  const result = origin ? await runOnServer(origin) : isMemoryServerCommand(args) ? noServer() : await runLocally();
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

/** Reads run here without creating, migrating or indexing any repo. */
async function runLocally(): Promise<MemoryCommandResult> {
  await scopeSettingsFromEnv();
  return runMemoryCommand(args, { readOnly: true, readTextFile: readInputFile });
}

function noServer(): MemoryCommandResult {
  return failure(
    "No Takode server is configured for this command. Memory changes are written by the Takode server: " +
      "run it from a Takode session or set COMPANION_PORT to the server's port.",
  );
}

/**
 * The Takode server is the only writer of memory data and the only machine
 * guaranteed to hold the repo. Values the command would otherwise take from
 * this process's environment, and files it names, travel with it.
 */
async function runOnServer(origin: string): Promise<MemoryCommandResult> {
  const inputFile = memoryCommandInputFile(args);
  const request: MemoryServerCommandRequest = {
    args,
    context: {
      // The server slug is the server's own, as it was for local runs that knew the port.
      defaults: definedValues({
        root: process.env.COMPANION_MEMORY_DIR,
        serverId: process.env.COMPANION_SERVER_ID,
        sessionSpaceSlug: process.env[COMPANION_MEMORY_SPACE_SLUG_ENV],
      }),
      ...definedValues({
        session: process.env.COMPANION_SESSION_ID || process.env.COMPANION_SESSION_NUM,
        catalogSessionKey:
          process.env.COMPANION_SESSION_ID || process.env.COMPANION_SESSION_NUM || process.env.TAKODE_SESSION_ID,
      }),
    },
    ...(inputFile ? { files: { [inputFile]: await readInputFile(inputFile) } } : {}),
  };
  const server = `the Takode server at ${origin}`;
  let response: Response;
  try {
    response = await fetch(`${origin}/api/memory/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(MEMORY_SERVER_COMMAND_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (!isMemoryServerCommand(args) && name !== "TimeoutError" && name !== "AbortError") return runLocally();
    return failure(
      name === "TimeoutError" || name === "AbortError"
        ? `The Takode server at ${origin} did not answer within ${MEMORY_SERVER_COMMAND_TIMEOUT_MS / 1000}s. ` +
            "The change may still have been applied: check with `memory lock status` and `memory status` before retrying."
        : `Cannot reach ${server}. Memory changes are written by the server: start Takode (or correct COMPANION_PORT) and retry.`,
    );
  }
  const value = (await response.json().catch(() => ({}))) as Partial<MemoryCommandResult> & { error?: unknown };
  if (!response.ok) {
    return failure(typeof value.error === "string" ? value.error : `Takode returned HTTP ${response.status}`);
  }
  if (!Number.isInteger(value.exitCode) || typeof value.stdout !== "string" || typeof value.stderr !== "string") {
    return failure("Takode returned an invalid memory command result");
  }
  return { exitCode: value.exitCode!, stdout: value.stdout, stderr: value.stderr };
}

/**
 * The server named by COMPANION_PORT, or for a standalone Codex task the server
 * whose integration file lives in this HOME. Never a guessed default: a wrong
 * guess would write into a server whose data does not belong to this caller.
 */
async function serverOrigin(): Promise<string | undefined> {
  const port = validPort(process.env.COMPANION_PORT);
  if (port) return `http://localhost:${port}`;
  if (!getCodexQuestInvocationContext()) return undefined;
  const sidecar = await resolveTakodeSidecarConnection(process.env);
  return sidecar ? new URL(sidecar.baseUrl).origin : undefined;
}

function authHeaders(): Record<string, string> {
  const sessionId = process.env.COMPANION_SESSION_ID?.trim();
  const authToken = process.env.COMPANION_AUTH_TOKEN?.trim();
  if (!sessionId || !authToken) return {};
  return { "x-companion-session-id": sessionId, "x-companion-auth-token": authToken };
}

async function readInputFile(path: string): Promise<string> {
  if (path !== "-") return readFile(path, "utf-8");
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function failure(message: string): MemoryCommandResult {
  return { exitCode: 1, stdout: "", stderr: `Error: ${message}\n` };
}

function definedValues<T extends Record<string, string | undefined>>(values: T): Partial<Record<keyof T, string>> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value?.trim())) as Partial<
    Record<keyof T, string>
  >;
}

function validPort(raw: string | undefined): number | undefined {
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

async function scopeSettingsFromEnv(): Promise<void> {
  const port = validPort(process.env.COMPANION_PORT);
  if (!port) return;
  await initWithPort(port);
  if (!args.includes("--server-slug")) {
    process.env.COMPANION_SERVER_SLUG = getServerSlug();
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
