import type { BackendType } from "./session-types.js";
import type { LaunchOptions } from "./cli-launcher-options.js";
import {
  normalizeCanonicalModelId,
  resolveModelAuthority,
  type ModelAuthorityDecision,
  type ModelProvenanceMigration,
  type ModelProvenanceMigrationSource,
} from "./model-identity-contract.js";
import { getDefaultModelForBackend } from "../shared/backend-defaults.js";
import { createModelProvenanceMigrationEventId } from "./model-provenance-migration.js";

export interface LaunchModelSelection {
  model?: string;
  modelAuthority?: ModelAuthorityDecision;
  modelProvenanceMigration?: ModelProvenanceMigration;
  migratedParent?: boolean;
}

export interface MutableModelAuthorityState {
  model?: string;
  modelAuthority?: ModelAuthorityDecision;
  modelProvenanceMigration?: ModelProvenanceMigration;
}

export function isTrustworthyModelAuthority(model: unknown, authority: unknown): authority is ModelAuthorityDecision {
  if (typeof model !== "string" || !model.trim() || !authority || typeof authority !== "object") return false;
  const decision = authority as Partial<ModelAuthorityDecision>;
  try {
    return (
      normalizeCanonicalModelId(model) === decision.model &&
      typeof decision.source === "string" &&
      typeof decision.policyVersion === "string" &&
      decision.policyVersion.length > 0 &&
      Array.isArray(decision.overrideTrace) &&
      decision.overrideTrace.some(
        (entry) => entry?.status === "selected" && entry.model === decision.model && entry.source === decision.source,
      )
    );
  } catch {
    return false;
  }
}

export function resolveUnknownModelProvenanceAuthority(configuredDefaultModel?: unknown): ModelAuthorityDecision {
  const configured = typeof configuredDefaultModel === "string" ? configuredDefaultModel.trim() : "";
  return resolveModelAuthority([
    ...(configured ? [{ source: "session_default" as const, model: configured, precedence: 300 }] : []),
    { source: "managed_fallback", model: getDefaultModelForBackend("codex"), precedence: 100 },
  ]);
}

export function createModelProvenanceMigration(
  authority: ModelAuthorityDecision,
  source: ModelProvenanceMigrationSource,
  migratedAt = Date.now(),
): ModelProvenanceMigration {
  return {
    eventId: createModelProvenanceMigrationEventId(),
    code: "model_provenance_unavailable",
    source,
    selectedModel: authority.model,
    authority,
    migratedAt,
    warning:
      `Original model provenance was unavailable. Takode selected ${authority.model} using the current configured ` +
      "default policy and persisted this exact choice for future relaunch, recovery, and child sessions.",
  };
}

export function ensureModelAuthority(
  state: MutableModelAuthorityState,
  configuredDefaultModel: unknown,
  source: ModelProvenanceMigrationSource,
  migratedAt = Date.now(),
): { migrationCreated: boolean; stateChanged: boolean; migration?: ModelProvenanceMigration } {
  if (isTrustworthyModelAuthority(state.model, state.modelAuthority)) {
    return { migrationCreated: false, stateChanged: false, migration: state.modelProvenanceMigration };
  }

  const historical = state.modelProvenanceMigration;
  if (historical && isTrustworthyModelAuthority(historical.selectedModel, historical.authority)) {
    state.model = historical.selectedModel;
    state.modelAuthority = historical.authority;
    return { migrationCreated: false, stateChanged: true, migration: historical };
  }

  const authority = resolveUnknownModelProvenanceAuthority(configuredDefaultModel);
  const migration = createModelProvenanceMigration(authority, source, migratedAt);
  state.model = authority.model;
  state.modelAuthority = authority;
  state.modelProvenanceMigration = migration;
  return { migrationCreated: true, stateChanged: true, migration };
}

/** Resolve and validate the model authority before launch state is created. */
export function resolveLaunchModelSelection(
  backendType: BackendType,
  options: LaunchOptions,
  context?: { parent?: MutableModelAuthorityState; configuredDefaultModel?: unknown },
): LaunchModelSelection {
  if (backendType !== "codex") return { model: options.model };

  if (context?.parent) {
    const ensured = ensureModelAuthority(context.parent, context.configuredDefaultModel, "legacy_parent");
    return {
      model: context.parent.model,
      modelAuthority: context.parent.modelAuthority,
      modelProvenanceMigration: context.parent.modelProvenanceMigration,
      migratedParent: ensured.migrationCreated,
    };
  }

  if (options.modelProvenanceMigration) {
    if (
      !isTrustworthyModelAuthority(options.model, options.modelAuthority) ||
      !isTrustworthyModelAuthority(
        options.modelProvenanceMigration.selectedModel,
        options.modelProvenanceMigration.authority,
      ) ||
      options.modelProvenanceMigration.authority.model !== options.modelAuthority.model
    ) {
      throw new Error("model_default_conflict: migration record does not match the launch model authority");
    }
    return {
      model: options.modelAuthority.model,
      modelAuthority: options.modelAuthority,
      modelProvenanceMigration: options.modelProvenanceMigration,
    };
  }

  const modelAuthority =
    options.modelAuthority ??
    resolveModelAuthority([
      options.model
        ? { source: "launch_option", model: options.model, precedence: 400 }
        : {
            source: "managed_fallback",
            model: getDefaultModelForBackend("codex"),
            precedence: 100,
          },
    ]);
  if (options.model && modelAuthority.model !== options.model.trim()) {
    throw new Error(
      `model_default_conflict: launch model ${options.model} does not match authority winner ${modelAuthority.model}`,
    );
  }
  return { model: modelAuthority.model, modelAuthority };
}
