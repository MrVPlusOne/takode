import { isSafeCodexReasoningEffort } from "./session-defaults.js";

export interface CodexReasoningEffortReport {
  reported: boolean;
  value: string | null;
}

export interface CodexReasoningModelSupport {
  value: string;
  supportedReasoningLevels?: Array<{ effort: string }>;
}

export interface CodexReasoningEffortSupportIssue {
  model: string;
  effort: string;
  supported: string[];
}

export const UNREPORTED_CODEX_REASONING_EFFORT: CodexReasoningEffortReport = {
  reported: false,
  value: null,
};

export function normalizeCodexReasoningEffortValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized && isSafeCodexReasoningEffort(normalized) ? normalized : null;
}

export function readCodexReasoningEffortReport(
  value: unknown,
  keys: readonly string[] = ["reasoningEffort", "reasoning_effort", "effort"],
): CodexReasoningEffortReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return UNREPORTED_CODEX_REASONING_EFFORT;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    if (record[key] === null || record[key] === "") return { reported: true, value: null };
    const normalized = normalizeCodexReasoningEffortValue(record[key]);
    return normalized ? { reported: true, value: normalized } : UNREPORTED_CODEX_REASONING_EFFORT;
  }
  return UNREPORTED_CODEX_REASONING_EFFORT;
}

export function codexEffectiveReasoningEffortPatch(report: CodexReasoningEffortReport) {
  return {
    codex_effective_reasoning_effort: report.value,
    codex_effective_reasoning_effort_reported: report.reported,
  };
}

export function findCodexReasoningEffortSupportIssue(
  models: readonly CodexReasoningModelSupport[] | null | undefined,
  model: string | null | undefined,
  effort: string | null | undefined,
): CodexReasoningEffortSupportIssue | null {
  const normalizedModel = model?.trim().toLowerCase();
  const normalizedEffort = normalizeCodexReasoningEffortValue(effort);
  if (!normalizedModel || !normalizedEffort || !models?.length) return null;
  const modelInfo = models.find((candidate) => candidate.value.trim().toLowerCase() === normalizedModel);
  const supported = modelInfo?.supportedReasoningLevels
    ?.map((level) => normalizeCodexReasoningEffortValue(level.effort))
    .filter((level): level is string => !!level);
  if (!supported?.length || supported.includes(normalizedEffort)) return null;
  return { model: modelInfo!.value, effort: normalizedEffort, supported: [...new Set(supported)] };
}

export function formatCodexReasoningEffortSupportIssue(issue: CodexReasoningEffortSupportIssue): string {
  return `Codex reasoning effort "${issue.effort}" is not supported by model "${issue.model}" (supported: ${issue.supported.join(", ")})`;
}
