import type { LaunchOptions } from "../cli-launcher.js";
import { getCachedCodexModelCatalog } from "../codex-model-catalog.js";
import {
  findCodexReasoningEffortSupportIssue,
  formatCodexReasoningEffortSupportIssue,
} from "../../shared/codex-reasoning-effort.js";
import { resolveCodexSandboxForPermissionMode } from "./session-permission-mode.js";
import { type SessionBackend, throwPreparationError } from "./sessions-helpers.js";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export function buildSessionBackendLaunchSettings(
  body: Record<string, unknown>,
  backend: SessionBackend,
  permissionMode: string,
  model: string | undefined,
): Partial<LaunchOptions> {
  if (backend !== "codex") {
    return {
      claudeReasoningEffort: optionalString(body.claudeReasoningEffort),
      claudeMaxContextLength: body.claudeMaxContextLength as number | undefined,
    };
  }

  const codexReasoningEffort = optionalString(body.codexReasoningEffort);
  const supportIssue = findCodexReasoningEffortSupportIssue(
    getCachedCodexModelCatalog()?.models,
    model,
    codexReasoningEffort,
  );
  if (supportIssue) throwPreparationError(formatCodexReasoningEffortSupportIssue(supportIssue), 400);
  return {
    codexInternetAccess: body.codexInternetAccess === true,
    codexSandbox: resolveCodexSandboxForPermissionMode(permissionMode),
    codexReasoningEffort,
    codexServiceTier:
      typeof body.codexServiceTier === "string" || body.codexServiceTier === null ? body.codexServiceTier : undefined,
    codexMaxContextLength: body.codexMaxContextLength as number | undefined,
  };
}
