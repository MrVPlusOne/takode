import type { QuestInvocationProvenance } from "../server/quest-types.js";
import type { QuestOwnerRef } from "../shared/quest-owner.js";

export interface CodexQuestInvocationContext {
  sessionId: string;
  turnId?: string;
  toolUseId?: string;
  cwd?: string;
}

type QuestEnvironment = Record<string, string | undefined>;

/** Read Codex invocation identity injected by the Takode plugin hook. */
export function getCodexQuestInvocationContext(
  environment: QuestEnvironment = process.env,
): CodexQuestInvocationContext | null {
  const sessionId = environment.TAKODE_CODEX_SESSION_ID?.trim();
  if (!sessionId) return null;
  return {
    sessionId,
    ...optionalContextField("turnId", environment.TAKODE_CODEX_TURN_ID),
    ...optionalContextField("toolUseId", environment.TAKODE_CODEX_TOOL_USE_ID),
    ...optionalContextField("cwd", environment.TAKODE_CODEX_CWD),
  };
}

/** Return whether Takode already supplied its authoritative managed-session identity. */
export function hasManagedCompanionIdentity(environment: QuestEnvironment = process.env): boolean {
  return !!environment.COMPANION_SESSION_ID?.trim() && !!environment.COMPANION_AUTH_TOKEN?.trim();
}

/** Return whether this process is the live server's in-process Quest command worker. */
export function isQuestServerExecution(environment: QuestEnvironment = process.env): boolean {
  return environment.TAKODE_QUEST_SERVER_EXECUTION === "1";
}

/** Build the provider-aware owner represented by a Codex invocation. */
export function codexQuestOwner(context: CodexQuestInvocationContext): QuestOwnerRef {
  return { kind: "codex", sessionId: context.sessionId };
}

/** Build durable Quest mutation provenance for a Codex invocation. */
export function codexQuestProvenance(
  context: CodexQuestInvocationContext,
  recordedAt = Date.now(),
): QuestInvocationProvenance {
  return {
    owner: codexQuestOwner(context),
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.toolUseId ? { toolUseId: context.toolUseId } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
    recordedAt,
  };
}

function optionalContextField<Key extends "turnId" | "toolUseId" | "cwd">(
  key: Key,
  raw: string | undefined,
): Partial<Pick<CodexQuestInvocationContext, Key>> {
  const value = raw?.trim();
  return value ? ({ [key]: value } as Pick<CodexQuestInvocationContext, Key>) : {};
}
