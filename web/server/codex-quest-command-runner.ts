import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CodexSidecarActor } from "./codex-sidecar-auth.js";
import { QUEST_COMMAND_RUNNER_TIMEOUT_MS } from "../shared/quest-command-transport.js";

const QUEST_CLI_PATH = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
const TAKODE_MANAGED_CONTEXT_ENV = [
  "COMPANION_SESSION_ID",
  "COMPANION_SESSION_NUMBER",
  "COMPANION_AUTH_TOKEN",
  "COMPANION_PORT",
  "COMPANION_SERVER_ID",
  "COMPANION_SERVER_SLUG",
  "COMPANION_MEMORY_SPACE_SLUG",
  "TAKODE_ROLE",
  "TAKODE_API_PORT",
] as const;
const CODEX_IDENTITY_ENV = [
  "TAKODE_CODEX_SESSION_ID",
  "TAKODE_CODEX_TURN_ID",
  "TAKODE_CODEX_TOOL_USE_ID",
  "TAKODE_CODEX_CWD",
] as const;

/** Canonical Quest CLI invocation attributed to one authenticated Codex actor. */
export interface CodexQuestCommandRequest {
  args: string[];
  stdin?: string;
  actor: CodexSidecarActor;
}

/** Exact observable result of one Quest CLI process. */
export interface CodexQuestCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Injectable command process boundary used by the Codex sidecar route. */
export type CodexQuestCommandRunner = (request: CodexQuestCommandRequest) => Promise<CodexQuestCommandResult>;

/** Run the bundled Quest CLI without inheriting a spoofable Takode-managed session identity. */
export async function runCodexQuestCommand(request: CodexQuestCommandRequest): Promise<CodexQuestCommandResult> {
  if (request.actor.kind !== "codex_session") {
    throw new Error("The Codex Quest command runner accepts only Codex session actors");
  }

  const cwd = request.actor.cwd ?? process.cwd();
  const env = questCommandEnvironment(request.actor, cwd);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [QUEST_CLI_PATH, ...request.args], {
      cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Quest CLI timed out after ${QUEST_COMMAND_RUNNER_TIMEOUT_MS}ms`));
    }, QUEST_COMMAND_RUNNER_TIMEOUT_MS);
    timeout.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (exitCode === null) {
        reject(new Error(`Quest CLI exited without a status code${signal ? ` after signal ${signal}` : ""}`));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE" || settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    });
    child.stdin.end(request.stdin);
  });
}

function questCommandEnvironment(actor: CodexSidecarActor, cwd: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of TAKODE_MANAGED_CONTEXT_ENV) delete env[name];
  for (const name of CODEX_IDENTITY_ENV) delete env[name];

  env.TAKODE_QUEST_SERVER_EXECUTION = "1";
  env.TAKODE_CODEX_SESSION_ID = actor.sessionId;
  env.TAKODE_CODEX_CWD = cwd;
  if (actor.turnId) env.TAKODE_CODEX_TURN_ID = actor.turnId;
  if (actor.toolUseId) env.TAKODE_CODEX_TOOL_USE_ID = actor.toolUseId;
  return env;
}
