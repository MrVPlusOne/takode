import type { BackendType } from "./session-types.js";
import type { LaunchOptions } from "./cli-launcher-options.js";
import { resolveModelAuthority, type ModelAuthorityDecision } from "./model-identity-contract.js";
import { getDefaultModelForBackend } from "../shared/backend-defaults.js";

export interface LaunchModelSelection {
  model?: string;
  modelAuthority?: ModelAuthorityDecision;
}

/** Resolve and validate the model authority before launch state is created. */
export function resolveLaunchModelSelection(backendType: BackendType, options: LaunchOptions): LaunchModelSelection {
  if (backendType !== "codex") return { model: options.model };

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
