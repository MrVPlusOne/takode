export type CodexReasoningRuntimeStatus = "unreported" | "reported" | "mismatch";

export interface CodexReasoningAuthorityDisplay {
  selectedLabel: string;
  effectiveLabel: string;
  triggerSuffix: string;
  runtimeStatus: CodexReasoningRuntimeStatus;
  warningLabel: string | null;
  title: string;
}

export function buildCodexReasoningAuthorityDisplay(options: {
  requested: string | null | undefined;
  effective: string | null | undefined;
  effectiveReported: boolean;
  runtimeConnected: boolean;
  defaultRequested?: string;
  defaultRequestedLabel?: string;
  labelForEffort: (effort: string) => string;
}): CodexReasoningAuthorityDisplay {
  const requested = options.requested?.trim().toLowerCase() || "";
  const effective = options.effective?.trim().toLowerCase() || "";
  const defaultRequested = options.defaultRequested?.trim().toLowerCase() || "";
  const selectedValue = requested || defaultRequested;
  const selectedBaseLabel = selectedValue ? options.labelForEffort(selectedValue) : "Default";
  const selectedLabel = requested
    ? selectedBaseLabel
    : options.defaultRequestedLabel
      ? `${options.defaultRequestedLabel} (default)`
      : "Default";
  const triggerSuffix = selectedValue ? selectedBaseLabel : "";

  if (!options.effectiveReported) {
    return {
      selectedLabel,
      effectiveLabel: "Unknown",
      triggerSuffix,
      runtimeStatus: "unreported",
      warningLabel: null,
      title: `Selected: ${selectedLabel}; runtime effort: not reported`,
    };
  }

  const effectiveBase = effective ? options.labelForEffort(effective) : "Default";
  const effectiveLabel = options.runtimeConnected ? effectiveBase : `${effectiveBase} (last reported)`;
  const runtimeStatus = selectedValue && selectedValue !== effective ? "mismatch" : "reported";
  const runtimePrefix = options.runtimeConnected ? "Runtime" : "Last runtime";
  const warningLabel =
    runtimeStatus === "mismatch"
      ? `${runtimePrefix} ${options.runtimeConnected ? "is using" : "used"} ${effectiveBase} instead of ${selectedBaseLabel}.`
      : null;

  return {
    selectedLabel,
    effectiveLabel,
    triggerSuffix,
    runtimeStatus,
    warningLabel,
    title: `Selected: ${selectedLabel}; ${runtimePrefix.toLowerCase()}: ${effectiveBase}`,
  };
}
