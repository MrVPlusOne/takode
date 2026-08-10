export interface ResultInterruptionInput {
  is_error?: boolean;
  result?: string;
  errors?: string[];
  stop_reason?: string | null;
}

export interface ResultInterruptionContext {
  explicitInterrupted?: boolean;
  sessionInterrupted?: boolean;
}

export function isResultStopReasonInterrupted(msg: Pick<ResultInterruptionInput, "stop_reason">): boolean {
  const stopReason = typeof msg.stop_reason === "string" ? msg.stop_reason.toLowerCase() : "";
  return stopReason.includes("interrupt") || stopReason.includes("cancel");
}

export function isClaudeUserControlDiagnostic(msg: ResultInterruptionInput): boolean {
  if (!msg.is_error) return false;
  const candidates = [msg.result, ...(Array.isArray(msg.errors) ? msg.errors : [])];
  return candidates.some(
    (candidate) =>
      typeof candidate === "string" && candidate.includes("[ede_diagnostic]") && candidate.includes("result_type=user"),
  );
}

export function isTerminalResultInterrupted(
  msg: ResultInterruptionInput,
  context: ResultInterruptionContext = {},
): boolean {
  return (
    context.explicitInterrupted === true ||
    context.sessionInterrupted === true ||
    isResultStopReasonInterrupted(msg) ||
    isClaudeUserControlDiagnostic(msg)
  );
}
