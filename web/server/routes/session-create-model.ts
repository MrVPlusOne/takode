import { getDefaultModelForBackend } from "../../shared/backend-defaults.js";
import {
  resolveModelAuthority,
  type ModelAuthorityCandidate,
  type ModelAuthorityDecision,
} from "../model-identity-contract.js";
import type { SessionBackend } from "./sessions-helpers.js";

type SessionCreateModelLauncher = {
  getSession: (sessionId: string) => { backendType?: SessionBackend; model?: string } | undefined;
  resolveSessionId: (raw: string) => string | null;
};

type ResolveSessionCreateModelOptions = {
  backend: SessionBackend;
  createdBy?: unknown;
  getClaudeUserDefaultModel: () => Promise<string>;
  launcher: SessionCreateModelLauncher;
  configuredDefaultModel?: unknown;
  requestedModel?: unknown;
};

export interface ResolvedSessionCreateModel {
  model?: string;
  modelAuthority?: ModelAuthorityDecision;
}

export async function resolveSessionCreateModel({
  backend,
  createdBy,
  configuredDefaultModel,
  getClaudeUserDefaultModel,
  launcher,
  requestedModel,
}: ResolveSessionCreateModelOptions): Promise<ResolvedSessionCreateModel> {
  const explicitModel = typeof requestedModel === "string" ? requestedModel.trim() : "";
  const creatorId =
    typeof createdBy === "string" && createdBy.trim() ? launcher.resolveSessionId(createdBy.trim()) : null;
  const creator = creatorId ? launcher.getSession(creatorId) : null;
  const creatorModel = typeof creator?.model === "string" ? creator.model.trim() : "";

  if (backend === "codex") {
    const configuredModel = typeof configuredDefaultModel === "string" ? configuredDefaultModel.trim() : "";
    const candidates: ModelAuthorityCandidate[] = [];
    if (explicitModel) candidates.push({ source: "explicit_request", model: explicitModel, precedence: 400 });
    if (configuredModel) candidates.push({ source: "session_default", model: configuredModel, precedence: 300 });
    if (creatorModel && creator?.backendType === backend) {
      candidates.push({ source: "inherited_session", model: creatorModel, precedence: 200 });
    }
    candidates.push({
      source: "managed_fallback",
      model: getDefaultModelForBackend("codex"),
      precedence: 100,
    });
    const modelAuthority = resolveModelAuthority(candidates);
    return { model: modelAuthority.model, modelAuthority };
  }

  if (explicitModel) return { model: explicitModel };
  if (creatorModel && creator?.backendType === backend) return { model: creatorModel };

  if (backend === "claude" || backend === "claude-sdk") {
    return { model: (await getClaudeUserDefaultModel()) || undefined };
  }

  return {};
}
