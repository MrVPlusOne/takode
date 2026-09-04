import type { LeaderAnswerRouteDiagnostic } from "./thread-routing-reminder.js";

/** Persisted routing failure metadata for leader text, shell commands, and explicit answers. */
export interface ThreadRoutingError {
  reason: "missing" | "invalid" | "missing_role" | "invalid_role" | "invalid_answer_route";
  expected: string;
  source?: "visible_text" | "shell_command" | "answer_marker";
  answerRouteDiagnostic?: LeaderAnswerRouteDiagnostic;
  rawContent?: string;
  marker?: string;
}
