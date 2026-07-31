import type { CLIResultMessage } from "./session-types.js";

type ResultInterruptionInput = Pick<CLIResultMessage, "is_error" | "result" | "stop_reason">;

export interface ResultInterruptionContext {
  explicitInterrupted?: boolean;
  sessionInterrupted?: boolean;
}

export function isResultStopReasonInterrupted(msg: Pick<CLIResultMessage, "stop_reason">): boolean {
  const stopReason = typeof msg.stop_reason === "string" ? msg.stop_reason.toLowerCase() : "";
  return stopReason.includes("interrupt") || stopReason.includes("cancel");
}

export function isTerminalResultInterrupted(
  msg: ResultInterruptionInput,
  context: ResultInterruptionContext = {},
): boolean {
  const userControlDiagnostic =
    msg.is_error &&
    typeof msg.result === "string" &&
    msg.result.includes("[ede_diagnostic]") &&
    msg.result.includes("result_type=user");
  return (
    context.explicitInterrupted === true ||
    context.sessionInterrupted === true ||
    isResultStopReasonInterrupted(msg) ||
    userControlDiagnostic
  );
}
