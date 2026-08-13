export interface CodexReasoningAuthorityDisplay {
  requestedLabel: string;
  effectiveLabel: string;
  triggerSuffix: string;
  title: string;
}

export function buildCodexReasoningAuthorityDisplay(options: {
  requested: string | null | undefined;
  effective: string | null | undefined;
  effectiveReported: boolean;
  runtimeConnected: boolean;
  defaultRequestedLabel?: string;
  labelForEffort: (effort: string) => string;
}): CodexReasoningAuthorityDisplay {
  const requested = options.requested?.trim().toLowerCase() || "";
  const effective = options.effective?.trim().toLowerCase() || "";
  const requestedLabel = requested
    ? options.labelForEffort(requested)
    : options.defaultRequestedLabel
      ? `${options.defaultRequestedLabel} (default)`
      : "Default";

  if (!options.effectiveReported) {
    const triggerSuffix = requested ? `${options.labelForEffort(requested)} requested` : "";
    return {
      requestedLabel,
      effectiveLabel: "Unknown",
      triggerSuffix,
      title: `Requested: ${requestedLabel}; effective runtime effort: unknown`,
    };
  }

  const effectiveBase = effective ? options.labelForEffort(effective) : "Default";
  const effectiveLabel = options.runtimeConnected ? effectiveBase : `${effectiveBase} (last effective)`;
  const requestedDiffers = requested !== effective;
  const triggerSuffix = requestedDiffers ? `${effectiveLabel} · ${requestedLabel} requested` : effectiveLabel;
  return {
    requestedLabel,
    effectiveLabel,
    triggerSuffix,
    title: requestedDiffers
      ? `Effective: ${effectiveLabel}; requested: ${requestedLabel}`
      : `Effective: ${effectiveLabel}`,
  };
}
