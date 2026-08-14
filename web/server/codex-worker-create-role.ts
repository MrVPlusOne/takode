import type { CodexMultiAgentVersion } from "../shared/codex-multi-agent-version.js";

interface CreatorSession {
  isOrchestrator?: boolean;
  archived?: boolean;
  hidden?: boolean;
  publicSessionNumber?: boolean;
}

export interface CodexCreateRoleLaunchSettings {
  codexMultiAgentVersion?: CodexMultiAgentVersion;
  createdBySessionRef?: string;
}

export function isActivePublicOrchestratorCreator(
  creator: CreatorSession | null | undefined,
): creator is CreatorSession & { isOrchestrator: true } {
  return (
    creator?.isOrchestrator === true &&
    creator.archived !== true &&
    creator.hidden !== true &&
    creator.publicSessionNumber !== false
  );
}

export function resolveCodexCreateRoleLaunchSettings(
  body: Record<string, unknown>,
  backend: string,
  resolveCreator: (createdBy: string) => CreatorSession | undefined,
): CodexCreateRoleLaunchSettings {
  if (backend !== "codex") return {};
  const createdBySessionRef = typeof body.createdBy === "string" ? body.createdBy.trim() : "";
  const excludedTarget =
    body.role === "orchestrator" ||
    body.assistantMode === true ||
    typeof body.reviewerOf === "number" ||
    body.hidden === true ||
    (typeof body.resumeCliSessionId === "string" && body.resumeCliSessionId.trim().length > 0);
  const version =
    !excludedTarget && createdBySessionRef && isActivePublicOrchestratorCreator(resolveCreator(createdBySessionRef))
      ? "v2"
      : "v1";
  return {
    codexMultiAgentVersion: version,
    ...(createdBySessionRef ? { createdBySessionRef } : {}),
  };
}

export function resolveCodexMultiAgentVersionForCreate(
  body: Record<string, unknown>,
  backend: string,
  resolveCreator: (createdBy: string) => CreatorSession | undefined,
): CodexMultiAgentVersion | undefined {
  return resolveCodexCreateRoleLaunchSettings(body, backend, resolveCreator).codexMultiAgentVersion;
}
