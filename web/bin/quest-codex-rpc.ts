import { CODEX_SIDECAR_BINDING_HEADER, CODEX_SIDECAR_CAPABILITY_HEADER } from "../server/codex-sidecar-auth.js";
import { QUEST_COMMAND_CLIENT_TIMEOUT_MS } from "../shared/quest-command-transport.js";
import type { CodexQuestInvocationContext } from "./quest-codex-invocation.js";
import {
  bindTakodeCodexActor,
  resolveTakodeSidecarConnection,
  takodeSidecarPort,
  type SidecarEnvironment,
} from "./takode-sidecar-client.js";

export interface QuestCommandRpcResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Run one Quest mutation through the live Takode server's canonical command endpoint. */
export async function runCodexQuestCommandRpc(args: {
  argv: string[];
  context: CodexQuestInvocationContext;
  stdin?: string;
  environment?: SidecarEnvironment;
}): Promise<QuestCommandRpcResult> {
  const environment = args.environment ?? process.env;
  const connection = await resolveTakodeSidecarConnection(environment);
  if (!connection) {
    throw new Error(
      `Takode sidecar capability is unavailable for port ${takodeSidecarPort(environment)}. ` +
        "Start or update the Takode server, then retry.",
    );
  }

  const actor = {
    kind: "codex_session" as const,
    sessionId: args.context.sessionId,
    ...(args.context.turnId ? { turnId: args.context.turnId } : {}),
    ...(args.context.toolUseId ? { toolUseId: args.context.toolUseId } : {}),
    ...(args.context.cwd ? { cwd: args.context.cwd } : {}),
  };
  const capabilityHeaders = { [CODEX_SIDECAR_CAPABILITY_HEADER]: connection.capability };
  const bindingId = await bindTakodeCodexActor(connection, actor);

  const response = await fetch(new URL(`${connection.baseUrl}/quest-command`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...capabilityHeaders,
      [CODEX_SIDECAR_BINDING_HEADER]: bindingId,
    },
    body: JSON.stringify({
      args: args.argv,
      ...(args.stdin !== undefined ? { stdin: args.stdin } : {}),
      actor,
    }),
    signal: AbortSignal.timeout(QUEST_COMMAND_CLIENT_TIMEOUT_MS),
  });
  const value = (await response.json().catch(() => ({}))) as Partial<QuestCommandRpcResult> & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof value.error === "string" ? value.error : `Takode returned HTTP ${response.status}`);
  }
  if (!Number.isInteger(value.exitCode) || typeof value.stdout !== "string" || typeof value.stderr !== "string") {
    throw new Error("Takode returned an invalid Quest command result");
  }
  return { exitCode: value.exitCode!, stdout: value.stdout, stderr: value.stderr };
}
