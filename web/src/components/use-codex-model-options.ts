import { useEffect, useState } from "react";
import { api } from "../api.js";
import { getModelsForBackend, toModelOptions, type ModelOption } from "../utils/backends.js";
import { sendToSession } from "../ws.js";

const EMPTY_SERVICE_TIERS: NonNullable<ModelOption["serviceTiers"]> = [];

export function useCodexModelOptions(options: {
  isCodex: boolean;
  model: string | undefined;
  codexServiceTier: string | null | undefined;
  sessionId: string;
  loadPersistedSettings: () => unknown;
}): {
  codexModelOptions: ModelOption[];
  codexFastServiceTier: NonNullable<ModelOption["serviceTiers"]>[number] | null;
} {
  const { isCodex, model, codexServiceTier, sessionId, loadPersistedSettings } = options;
  const [dynamicCodexModels, setDynamicCodexModels] = useState<ModelOption[] | null>(null);
  const codexModelOptions = dynamicCodexModels || getModelsForBackend("codex");
  const selectedCodexModelOption = codexModelOptions.find((option) => option.value === model);
  const selectedCodexServiceTiers = selectedCodexModelOption?.serviceTiers ?? EMPTY_SERVICE_TIERS;
  const codexFastServiceTier =
    selectedCodexServiceTiers.find((tier) => tier.name.toLowerCase() === "fast") ??
    selectedCodexServiceTiers[0] ??
    null;

  useEffect(() => {
    if (!isCodex) return;
    let cancelled = false;
    void loadPersistedSettings();
    api
      .getBackendModels("codex")
      .then((models) => {
        if (cancelled || models.length === 0) return;
        setDynamicCodexModels(toModelOptions(models));
      })
      .catch(() => {
        // Fall back to static model list silently.
      });
    return () => {
      cancelled = true;
    };
  }, [isCodex, loadPersistedSettings]);

  useEffect(() => {
    if (!isCodex || !codexServiceTier || !dynamicCodexModels || !model) return;
    const selectedModel = dynamicCodexModels.find((option) => option.value === model);
    if (!selectedModel) return;
    const supportsSelectedTier = selectedModel.serviceTiers?.some((tier) => tier.id === codexServiceTier) === true;
    if (!supportsSelectedTier) sendToSession(sessionId, { type: "set_codex_service_tier", serviceTier: null });
  }, [codexServiceTier, dynamicCodexModels, isCodex, model, sessionId]);

  return { codexModelOptions, codexFastServiceTier };
}
